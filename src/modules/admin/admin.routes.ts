import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../config/db';
import { requireAuth, requireRole, AuthedRequest } from '../../middleware/auth.middleware';
import { writeAudit } from '../../common/audit';

const router = Router();
const ADMIN_ONLY = ['DRRM_ADMIN'];

router.get('/users', requireAuth, requireRole(...ADMIN_ONLY), async (req, res) => {
  const { status } = req.query;
  const clauses: string[] = [];
  const params: any[] = [];
  if (status) {
    params.push(status);
    clauses.push(`u.status = $${params.length}`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const { rows } = await query(
    `SELECT u.id, u.email, u.status, u.created_at, u.last_login_at,
            p.full_name, p.designation, p.office,
            ARRAY_AGG(r.name) FILTER (WHERE r.name IS NOT NULL) AS roles
     FROM users u
     LEFT JOIN user_profiles p ON p.user_id = u.id
     LEFT JOIN user_roles ur ON ur.user_id = u.id
     LEFT JOIN roles r ON r.id = ur.role_id
     ${where}
     GROUP BY u.id, p.full_name, p.designation, p.office
     ORDER BY u.created_at DESC`,
    params
  );
  res.json(rows);
});

const decisionSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED', 'SUSPENDED']),
  roleNames: z.array(z.string()).optional() // required when APPROVED
});

router.patch('/users/:id/status', requireAuth, requireRole(...ADMIN_ONLY), async (req: AuthedRequest, res) => {
  const parsed = decisionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
  const { status, roleNames } = parsed.data;

  await query(`UPDATE users SET status = $1, updated_at = now() WHERE id = $2`, [status, req.params.id]);

  if (status === 'APPROVED' && roleNames && roleNames.length > 0) {
    const roleRows = await query(`SELECT id, name FROM roles WHERE name = ANY($1)`, [roleNames]);
    await query(`DELETE FROM user_roles WHERE user_id = $1`, [req.params.id]);
    for (const role of roleRows.rows) {
      await query(`INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`, [req.params.id, role.id]);
    }
  }

  await writeAudit(req, {
    userId: req.user!.id,
    action: `USER_${status}`,
    entity: 'users',
    entityId: req.params.id
  });

  res.json({ message: `User status updated to ${status}.` });
});

router.get('/sources', requireAuth, requireRole(...ADMIN_ONLY, 'DIVISION_DRRM_STAFF'), async (_req, res) => {
  const { rows } = await query(
    `SELECT ds.id, ds.name, ds.adapter_type, ds.endpoint_url, ds.status, ds.last_sync_at,
            (SELECT events_retrieved FROM data_sync_logs WHERE data_source_id = ds.id ORDER BY started_at DESC LIMIT 1) AS last_events_retrieved,
            (SELECT error_message FROM data_sync_logs WHERE data_source_id = ds.id ORDER BY started_at DESC LIMIT 1) AS last_error,
            (SELECT response_time_ms FROM data_sync_logs WHERE data_source_id = ds.id ORDER BY started_at DESC LIMIT 1) AS last_response_time_ms
     FROM data_sources ds
     ORDER BY ds.name`
  );
  res.json(rows);
});

router.get('/audit-logs', requireAuth, requireRole(...ADMIN_ONLY), async (req, res) => {
  const { page = '1' } = req.query;
  const limit = 100;
  const offset = (parseInt(String(page), 10) - 1) * limit;

  const { rows } = await query(
    `SELECT al.id, al.action, al.entity, al.entity_id, al.ip_address, al.created_at,
            u.email AS actor_email
     FROM audit_logs al
     LEFT JOIN users u ON u.id = al.user_id
     ORDER BY al.created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  res.json(rows);
});

router.get('/system-status', requireAuth, requireRole(...ADMIN_ONLY, 'DIVISION_DRRM_STAFF'), async (_req, res) => {
  const [users, events, schools] = await Promise.all([
    query(`SELECT status, COUNT(*) FROM users GROUP BY status`),
    query(`SELECT COUNT(*) FROM disaster_events WHERE status IN ('active','updated')`),
    query(`SELECT COUNT(*) FROM schools`)
  ]);
  res.json({
    usersByStatus: users.rows,
    activeEvents: parseInt(events.rows[0].count, 10),
    totalSchools: parseInt(schools.rows[0].count, 10),
    checkedAt: new Date().toISOString()
  });
});

export default router;
