import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../config/db';
import { requireAuth, requireRole, AuthedRequest } from '../../middleware/auth.middleware';
import { writeAudit } from '../../common/audit';

const router = Router();

router.get('/messages', requireAuth, async (req, res) => {
  const { before, limit = '50' } = req.query;
  const clauses: string[] = [];
  const params: any[] = [];
  if (before) {
    params.push(before);
    clauses.push(`cm.created_at < $${params.length}`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  params.push(Math.min(parseInt(String(limit), 10) || 50, 100));

  const { rows } = await query(
    `SELECT cm.id, cm.content, cm.created_at, cm.reported,
            u.id AS sender_id, u.email AS sender_email, p.full_name AS sender_name, p.profile_picture_url
     FROM chat_messages cm
     JOIN users u ON u.id = cm.sender_id
     LEFT JOIN user_profiles p ON p.user_id = u.id
     ${where}
     ORDER BY cm.created_at DESC
     LIMIT $${params.length}`,
    params
  );
  res.json(rows.reverse());
});

const messageSchema = z.object({ content: z.string().min(1).max(2000) });

// Only APPROVED, verified users can post — enforced by requireAuth (any
// non-approved account can't obtain an access token in the first place, per
// the login flow in auth.routes.ts).
router.post('/messages', requireAuth, async (req: AuthedRequest, res) => {
  const parsed = messageSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Message cannot be empty.' });

  const { rows } = await query(
    `INSERT INTO chat_messages (sender_id, content) VALUES ($1, $2) RETURNING id, created_at`,
    [req.user!.id, parsed.data.content]
  );
  res.status(201).json({ id: rows[0].id, createdAt: rows[0].created_at });
});

router.post('/messages/:id/report', requireAuth, async (req: AuthedRequest, res) => {
  await query(`UPDATE chat_messages SET reported = true WHERE id = $1`, [req.params.id]);
  await writeAudit(req, { userId: req.user!.id, action: 'REPORT', entity: 'chat_messages', entityId: req.params.id });
  res.json({ message: 'Message reported for administrator review.' });
});

// Moderation: DRRM Admins can view reported messages and remove them.
router.get('/moderation/reported', requireAuth, requireRole('DRRM_ADMIN'), async (_req, res) => {
  const { rows } = await query(
    `SELECT cm.id, cm.content, cm.created_at, u.email AS sender_email
     FROM chat_messages cm JOIN users u ON u.id = cm.sender_id
     WHERE cm.reported = true ORDER BY cm.created_at DESC`
  );
  res.json(rows);
});

router.delete('/moderation/:id', requireAuth, requireRole('DRRM_ADMIN'), async (req: AuthedRequest, res) => {
  await query(`DELETE FROM chat_messages WHERE id = $1`, [req.params.id]);
  await writeAudit(req, { userId: req.user!.id, action: 'DELETE', entity: 'chat_messages', entityId: req.params.id });
  res.json({ message: 'Message removed.' });
});

export default router;
