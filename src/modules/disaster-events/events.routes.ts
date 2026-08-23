import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../config/db';
import { requireAuth, requireRole, AuthedRequest } from '../../middleware/auth.middleware';
import { writeAudit } from '../../common/audit';
import { io } from '../../realtime/socket-gateway';
import { computeAffectedSchools } from './geo.service';
import { dispatchEventNotification } from '../notifications/notification-dispatch.service';

const router = Router();
const STAFF_ROLES = ['DRRM_ADMIN', 'DIVISION_DRRM_STAFF'];

router.get('/active', requireAuth, async (_req, res) => {
  const { rows } = await query(
    `SELECT id, disaster_type, official_title, source_agency, warning_level, description,
            status, issued_at, last_updated_at, official_source_url, is_leyte_priority, track,
            ST_Y(area::geometry) AS latitude, ST_X(area::geometry) AS longitude
     FROM disaster_events
     WHERE status IN ('active','updated')
     ORDER BY is_leyte_priority DESC, issued_at DESC
     LIMIT 200`
  );
  res.json(rows);
});

// Aggregate count of distinct schools affected by any currently active event —
// used for the dashboard's "Affected Schools" summary card.
router.get('/affected-schools/summary', requireAuth, async (_req, res) => {
  const { rows } = await query(
    `SELECT COUNT(DISTINCT af.school_id) AS count
     FROM affected_schools af
     JOIN disaster_events de ON de.id = af.disaster_event_id
     WHERE de.status IN ('active','updated')`
  );
  res.json({ count: parseInt(rows[0].count, 10) });
});

router.get('/history', requireAuth, async (req, res) => {
  const { from, to, disaster_type, municipality, page = '1' } = req.query;
  const clauses: string[] = [];
  const params: any[] = [];
  if (from) {
    params.push(from);
    clauses.push(`issued_at >= $${params.length}`);
  }
  if (to) {
    params.push(to);
    clauses.push(`issued_at <= $${params.length}`);
  }
  if (disaster_type) {
    params.push(disaster_type);
    clauses.push(`disaster_type = $${params.length}`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = 50;
  const offset = (parseInt(String(page), 10) - 1) * limit;
  params.push(limit, offset);

  const { rows } = await query(
    `SELECT id, disaster_type, official_title, source_agency, warning_level, status,
            issued_at, last_updated_at, is_leyte_priority
     FROM disaster_events
     ${where}
     ORDER BY issued_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  res.json(rows);
});

router.get('/:id/affected-schools', requireAuth, async (req, res) => {
  const { rows } = await query(
    `SELECT s.id, s.name, s.municipality, s.district, af.priority, af.distance_km,
            sc.name AS coordinator_name, sc.phone AS coordinator_phone
     FROM affected_schools af
     JOIN schools s ON s.id = af.school_id
     LEFT JOIN school_contacts sc ON sc.school_id = s.id AND sc.contact_type = 'drrm_coordinator'
     WHERE af.disaster_event_id = $1
     ORDER BY af.priority, af.distance_km`,
    [req.params.id]
  );
  res.json(rows);
});

router.get('/:id', requireAuth, async (req, res) => {
  const { rows } = await query(
    `SELECT de.*, ST_Y(area::geometry) AS latitude, ST_X(area::geometry) AS longitude
     FROM disaster_events de WHERE id = $1`,
    [req.params.id]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'Event not found.' });
  const updates = await query(
    `SELECT update_text, warning_level, recorded_at FROM disaster_event_updates
     WHERE disaster_event_id = $1 ORDER BY recorded_at DESC`,
    [req.params.id]
  );
  res.json({ ...rows[0], history: updates.rows });
});

// Manual entry — for official PAGASA/PHIVOLCS bulletins that don't come through
// a structured feed. Verbatim wording is the staff member's responsibility to
// transcribe accurately from the official source.
const trackPointSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  date: z.string().datetime()
});

const manualEventSchema = z.object({
  disasterType: z.enum([
    'rainfall',
    'tropical_cyclone',
    'earthquake',
    'tsunami',
    'volcano',
    'flood',
    'landslide',
    'wildfire',
    'storm_surge',
    'other'
  ]),
  officialTitle: z.string().min(3),
  sourceAgency: z.string().min(2), // e.g. "PAGASA", "PHIVOLCS", "JTWC"
  warningLevel: z.string().optional(), // verbatim, e.g. "Signal No. 2", "Orange Rainfall Warning"
  description: z.string().optional(),
  officialSourceUrl: z.string().url().optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  // Optional storm track — lets staff plot a developing typhoon's known/
  // forecast path manually (e.g. from a JTWC or PAGASA bulletin) while it's
  // still too new for NASA EONET/GDACS to have cataloged automatically.
  // Ordered oldest-to-newest, same shape as the automated adapters produce.
  track: z.array(trackPointSchema).min(2).optional()
});

router.post('/manual', requireAuth, requireRole(...STAFF_ROLES), async (req: AuthedRequest, res) => {
  const parsed = manualEventSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
  const d = parsed.data;

  const sourceResult = await query(`SELECT id FROM data_sources WHERE name = 'MANUAL_ENTRY'`);
  const dataSourceId = sourceResult.rows[0].id;

  const geomExpr =
    d.latitude !== undefined && d.longitude !== undefined
      ? `ST_SetSRID(ST_MakePoint(${d.longitude}, ${d.latitude}), 4326)`
      : 'NULL';

  const trackJson = d.track
    ? JSON.stringify(d.track.map((t) => ({ lon: t.longitude, lat: t.latitude, date: t.date })))
    : null;

  const { rows } = await query(
    `INSERT INTO disaster_events
       (external_id, data_source_id, disaster_type, official_title, source_agency,
        warning_level, description, area, status, issued_at, official_source_url, is_leyte_priority, track)
     VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, ${geomExpr}, 'active', now(), $7, true, $8)
     RETURNING id`,
    [
      dataSourceId,
      d.disasterType,
      d.officialTitle,
      d.sourceAgency,
      d.warningLevel ?? null,
      d.description ?? null,
      d.officialSourceUrl ?? null,
      trackJson
    ]
  );
  const eventId = rows[0].id;

  if (d.latitude !== undefined && d.longitude !== undefined) {
    await computeAffectedSchools(eventId);
  }

  await writeAudit(req, { userId: req.user!.id, action: 'CREATE_MANUAL_EVENT', entity: 'disaster_events', entityId: eventId });
  io.emit('disaster:new', { id: eventId, disasterType: d.disasterType, officialTitle: d.officialTitle, isLeytePriority: true });
  await dispatchEventNotification({
    eventId,
    disasterType: d.disasterType,
    officialTitle: d.officialTitle,
    sourceAgency: d.sourceAgency,
    isLeytePriority: true,
    isUpdate: false
  });

  res.status(201).json({ id: eventId });
});

export default router;
