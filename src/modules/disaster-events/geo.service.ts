import { query } from '../../config/db';

const HIGH_PRIORITY_KM = 10;
const POTENTIAL_KM = 30;

export interface AffectedSchoolRow {
  schoolId: string;
  priority: 'high' | 'potential';
  distanceKm: number;
}

/**
 * Computes which schools fall within the high-priority / potentially-affected
 * radius of a disaster event's geometry, using PostGIS ST_DWithin on geography
 * (accurate great-circle distance, not flat-earth approximation).
 */
export async function computeAffectedSchools(eventId: string): Promise<AffectedSchoolRow[]> {
  const eventResult = await query('SELECT area FROM disaster_events WHERE id = $1', [eventId]);
  if (eventResult.rows.length === 0 || !eventResult.rows[0].area) return [];

  const { rows } = await query(
    `SELECT s.id AS school_id,
            ST_Distance(sl.point, e.area) / 1000.0 AS distance_km
     FROM schools s
     JOIN school_locations sl ON sl.school_id = s.id
     CROSS JOIN (SELECT area FROM disaster_events WHERE id = $1) e
     WHERE ST_DWithin(sl.point, e.area, $2 * 1000)
     ORDER BY distance_km ASC`,
    [eventId, POTENTIAL_KM]
  );

  const affected: AffectedSchoolRow[] = rows.map((r) => ({
    schoolId: r.school_id,
    distanceKm: parseFloat(r.distance_km),
    priority: parseFloat(r.distance_km) <= HIGH_PRIORITY_KM ? 'high' : 'potential'
  }));

  for (const a of affected) {
    await query(
      `INSERT INTO affected_schools (disaster_event_id, school_id, priority, distance_km)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (disaster_event_id, school_id)
       DO UPDATE SET priority = EXCLUDED.priority, distance_km = EXCLUDED.distance_km, computed_at = now()`,
      [eventId, a.schoolId, a.priority, a.distanceKm]
    );
  }

  return affected;
}
