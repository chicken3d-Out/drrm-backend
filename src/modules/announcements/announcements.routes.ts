import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../config/db';
import { requireAuth, requireRole, AuthedRequest } from '../../middleware/auth.middleware';
import { writeAudit } from '../../common/audit';
import { io } from '../../realtime/socket-gateway';

const router = Router();
const STAFF_ROLES = ['DRRM_ADMIN', 'DIVISION_DRRM_STAFF'];

router.get('/', requireAuth, async (_req, res) => {
  const { rows } = await query(
    `SELECT a.id, a.title, a.content, a.priority, a.attachment_url, a.published_at, a.expires_at,
            u.email AS author_email, p.full_name AS author_name
     FROM announcements a
     JOIN users u ON u.id = a.author_id
     LEFT JOIN user_profiles p ON p.user_id = u.id
     WHERE a.expires_at IS NULL OR a.expires_at > now()
     ORDER BY a.published_at DESC`
  );
  res.json(rows);
});

const announcementSchema = z.object({
  title: z.string().min(3),
  content: z.string().min(3),
  priority: z.enum(['CRITICAL', 'HIGH', 'MODERATE', 'LOW', 'INFORMATION']).default('INFORMATION'),
  attachmentUrl: z.string().url().optional(),
  expiresAt: z.string().datetime().optional()
});

router.post('/', requireAuth, requireRole(...STAFF_ROLES), async (req: AuthedRequest, res) => {
  const parsed = announcementSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
  const d = parsed.data;

  const { rows } = await query(
    `INSERT INTO announcements (author_id, title, content, priority, attachment_url, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [req.user!.id, d.title, d.content, d.priority, d.attachmentUrl ?? null, d.expiresAt ?? null]
  );
  const id = rows[0].id;
  await writeAudit(req, { userId: req.user!.id, action: 'CREATE', entity: 'announcements', entityId: id });
  io.emit('announcement:new', { id, title: d.title, priority: d.priority });
  res.status(201).json({ id });
});

export default router;
