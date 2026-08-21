import { query } from '../../config/db';
import { io } from '../../realtime/socket-gateway';
import { NormalizedEvent } from '../../adapters/types';

const HAZARD_PREF_COLUMN: Record<NormalizedEvent['disasterType'], string> = {
  earthquake: 'earthquake',
  tsunami: 'tsunami',
  volcano: 'volcano',
  rainfall: 'rainfall',
  tropical_cyclone: 'tropical_cyclone',
  flood: 'other_hazards',
  landslide: 'other_hazards',
  wildfire: 'other_hazards',
  storm_surge: 'other_hazards',
  other: 'other_hazards'
};

// CRITICAL priority applies to high-severity hazard types regardless of user
// preference toggles (critical_alerts is always on, per spec section 20).
function priorityFor(disasterType: NormalizedEvent['disasterType']): 'CRITICAL' | 'HIGH' | 'MODERATE' | 'INFORMATION' {
  if (disasterType === 'earthquake' || disasterType === 'tsunami' || disasterType === 'volcano') return 'CRITICAL';
  if (disasterType === 'tropical_cyclone' || disasterType === 'storm_surge') return 'HIGH';
  if (disasterType === 'rainfall' || disasterType === 'flood' || disasterType === 'landslide') return 'MODERATE';
  return 'INFORMATION';
}

/**
 * Dispatches a notification to every APPROVED user whose preferences match
 * this event's hazard type and Leyte/nearby scope. Critical hazard types
 * always notify, since notification_preferences.critical_alerts cannot be
 * disabled by users.
 */
export async function dispatchEventNotification(params: {
  eventId: string;
  disasterType: NormalizedEvent['disasterType'];
  officialTitle: string;
  sourceAgency: string;
  isLeytePriority: boolean;
  isUpdate: boolean;
}) {
  const prefCol = HAZARD_PREF_COLUMN[params.disasterType];
  const priority = priorityFor(params.disasterType);
  const isCritical = priority === 'CRITICAL';

  const scopeClause = params.isLeytePriority
    ? '(np.leyte_alerts = true OR np.nearby_alerts = true)'
    : 'np.nearby_alerts = true';

  const hazardClause = isCritical ? 'true' : `np.${prefCol} = true`;

  const { rows: users } = await query(
    `SELECT u.id FROM users u
     JOIN notification_preferences np ON np.user_id = u.id
     WHERE u.status = 'APPROVED' AND ${hazardClause} AND ${scopeClause}`
  );

  const title = params.isUpdate ? `Updated: ${params.officialTitle}` : params.officialTitle;
  const body = `${params.sourceAgency}${params.isLeytePriority ? ' — Leyte' : ''}`;

  for (const u of users) {
    const { rows } = await query(
      `INSERT INTO notifications (user_id, disaster_event_id, title, body, priority, type)
       VALUES ($1,$2,$3,$4,$5,'official_alert') RETURNING id`,
      [u.id, params.eventId, title, body, priority]
    );
    io.to(`user:${u.id}`).emit('notification:new', {
      id: rows[0].id,
      title,
      body,
      priority,
      eventId: params.eventId
    });
  }
}
