import { pool, query } from '../../config/db';
import { NormalizedEvent } from '../../adapters/types';
import { LEYTE_BBOX } from '../../config/env';
import { io } from '../../realtime/socket-gateway';
import { computeAffectedSchools } from './geo.service';
import { dispatchEventNotification } from '../notifications/notification-dispatch.service';

function isLeytePriority(point?: { lon: number; lat: number }): boolean {
  if (!point) return false;
  return (
    point.lon >= LEYTE_BBOX.minLon &&
    point.lon <= LEYTE_BBOX.maxLon &&
    point.lat >= LEYTE_BBOX.minLat &&
    point.lat <= LEYTE_BBOX.maxLat
  );
}

export async function ingestEvents(events: NormalizedEvent[]): Promise<{ inserted: number; updated: number }> {
  let inserted = 0;
  let updated = 0;

  for (const ev of events) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const sourceResult = await client.query('SELECT id FROM data_sources WHERE name = $1', [ev.dataSourceName]);
      if (sourceResult.rows.length === 0) {
        await client.query('ROLLBACK');
        continue;
      }
      const dataSourceId = sourceResult.rows[0].id;

      const geomExpr = ev.point
        ? `ST_SetSRID(ST_MakePoint(${ev.point.lon}, ${ev.point.lat}), 4326)`
        : ev.polygon
        ? `ST_SetSRID(ST_GeomFromGeoJSON('${JSON.stringify({ type: 'Polygon', coordinates: ev.polygon })}'), 4326)`
        : 'NULL';

      const existing = await client.query(
        'SELECT id, last_updated_at FROM disaster_events WHERE data_source_id = $1 AND external_id = $2',
        [dataSourceId, ev.externalId]
      );

      const leytePriority = isLeytePriority(ev.point);
      let eventId: string;

      if (existing.rows.length === 0) {
        const insertResult = await client.query(
          `INSERT INTO disaster_events
             (external_id, data_source_id, disaster_type, official_title, source_agency,
              warning_level, description, area, status, issued_at, last_updated_at,
              official_source_url, is_leyte_priority, track)
           VALUES ($1,$2,$3,$4,$5,$6,$7, ${geomExpr}, 'active', $8, now(), $9, $10, $11)
           RETURNING id`,
          [
            ev.externalId,
            dataSourceId,
            ev.disasterType,
            ev.officialTitle,
            ev.sourceAgency,
            ev.warningLevel ?? null,
            ev.description ?? null,
            ev.issuedAt,
            ev.officialSourceUrl ?? null,
            leytePriority,
            ev.track ? JSON.stringify(ev.track) : null
          ]
        );
        eventId = insertResult.rows[0].id;
        inserted++;
        await client.query('COMMIT');
        io.emit('disaster:new', { id: eventId, disasterType: ev.disasterType, officialTitle: ev.officialTitle, isLeytePriority: leytePriority });
        await dispatchEventNotification({
          eventId,
          disasterType: ev.disasterType,
          officialTitle: ev.officialTitle,
          sourceAgency: ev.sourceAgency,
          isLeytePriority: leytePriority,
          isUpdate: false
        });
      } else {
        eventId = existing.rows[0].id;
        await client.query(
          `UPDATE disaster_events SET warning_level = $1, description = $2, status = 'updated', last_updated_at = now(), track = COALESCE($4, track)
           WHERE id = $3`,
          [ev.warningLevel ?? null, ev.description ?? null, eventId, ev.track ? JSON.stringify(ev.track) : null]
        );
        await client.query(
          `INSERT INTO disaster_event_updates (disaster_event_id, update_text, warning_level)
           VALUES ($1, $2, $3)`,
          [eventId, ev.description ?? null, ev.warningLevel ?? null]
        );
        updated++;
        await client.query('COMMIT');
        io.emit('disaster:updated', { id: eventId, disasterType: ev.disasterType, officialTitle: ev.officialTitle });
      }

      // Geo impact runs after commit so it operates on durable data.
      const affected = await computeAffectedSchools(eventId);
      if (affected.length > 0) {
        io.emit('school:affected', { eventId, affectedCount: affected.length });
      }
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      // eslint-disable-next-line no-console
      console.error(`Failed to ingest event ${ev.externalId} from ${ev.dataSourceName}:`, err);
    } finally {
      client.release();
    }
  }

  return { inserted, updated };
}

export async function markSourceSynced(sourceName: string, eventsRetrieved: number, errorMessage?: string, responseTimeMs?: number) {
  const { rows } = await query('SELECT id FROM data_sources WHERE name = $1', [sourceName]);
  if (rows.length === 0) return;
  const sourceId = rows[0].id;

  await query(
    `UPDATE data_sources SET status = $1, last_sync_at = now() WHERE id = $2`,
    [errorMessage ? 'degraded' : 'online', sourceId]
  );
  await query(
    `INSERT INTO data_sync_logs (data_source_id, finished_at, events_retrieved, error_message, response_time_ms)
     VALUES ($1, now(), $2, $3, $4)`,
    [sourceId, eventsRetrieved, errorMessage ?? null, responseTimeMs ?? null]
  );
}
