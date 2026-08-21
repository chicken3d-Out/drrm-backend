import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../config/db';
import { requireAuth, AuthedRequest } from '../../middleware/auth.middleware';

const router = Router();

router.get('/', requireAuth, async (req: AuthedRequest, res) => {
  const { unread_only } = req.query;
  const clauses = ['user_id = $1'];
  const params: any[] = [req.user!.id];
  if (unread_only === 'true') clauses.push('read = false');

  const { rows } = await query(
    `SELECT id, disaster_event_id, title, body, priority, type, read, created_at
     FROM notifications
     WHERE ${clauses.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT 100`,
    params
  );
  res.json(rows);
});

router.patch('/:id/read', requireAuth, async (req: AuthedRequest, res) => {
  await query(`UPDATE notifications SET read = true WHERE id = $1 AND user_id = $2`, [req.params.id, req.user!.id]);
  res.json({ message: 'Marked as read.' });
});

router.post('/mark-all-read', requireAuth, async (req: AuthedRequest, res) => {
  await query(`UPDATE notifications SET read = true WHERE user_id = $1 AND read = false`, [req.user!.id]);
  res.json({ message: 'All notifications marked as read.' });
});

router.get('/preferences', requireAuth, async (req: AuthedRequest, res) => {
  const { rows } = await query(`SELECT * FROM notification_preferences WHERE user_id = $1`, [req.user!.id]);
  if (rows.length === 0) {
    // Should exist from registration, but create with defaults if missing.
    const inserted = await query(
      `INSERT INTO notification_preferences (user_id) VALUES ($1) RETURNING *`,
      [req.user!.id]
    );
    return res.json(inserted.rows[0]);
  }
  res.json(rows[0]);
});

const preferencesSchema = z.object({
  earthquake: z.boolean().optional(),
  tsunami: z.boolean().optional(),
  volcano: z.boolean().optional(),
  rainfall: z.boolean().optional(),
  tropicalCyclone: z.boolean().optional(),
  thunderstorm: z.boolean().optional(),
  otherHazards: z.boolean().optional(),
  leyteAlerts: z.boolean().optional(),
  nearbyAlerts: z.boolean().optional(),
  schoolAlerts: z.boolean().optional()
  // critical_alerts is intentionally not editable via the API — always on, per spec section 20.
});

router.patch('/preferences', requireAuth, async (req: AuthedRequest, res) => {
  const parsed = preferencesSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
  const d = parsed.data;

  const colMap: Record<string, string> = {
    earthquake: 'earthquake',
    tsunami: 'tsunami',
    volcano: 'volcano',
    rainfall: 'rainfall',
    tropicalCyclone: 'tropical_cyclone',
    thunderstorm: 'thunderstorm',
    otherHazards: 'other_hazards',
    leyteAlerts: 'leyte_alerts',
    nearbyAlerts: 'nearby_alerts',
    schoolAlerts: 'school_alerts'
  };

  const fields: string[] = [];
  const params: any[] = [];
  for (const [key, col] of Object.entries(colMap)) {
    if ((d as any)[key] !== undefined) {
      params.push((d as any)[key]);
      fields.push(`${col} = $${params.length}`);
    }
  }
  if (fields.length === 0) return res.json({ message: 'No changes.' });

  params.push(req.user!.id);
  await query(`UPDATE notification_preferences SET ${fields.join(', ')} WHERE user_id = $${params.length}`, params);
  res.json({ message: 'Preferences updated.' });
});

export default router;
