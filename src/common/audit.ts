import { Request } from 'express';
import { query } from '../config/db';

export async function writeAudit(
  req: Request,
  params: { userId: string | null; action: string; entity: string; entityId?: string | null }
) {
  await query(
    `INSERT INTO audit_logs (user_id, action, entity, entity_id, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      params.userId,
      params.action,
      params.entity,
      params.entityId ?? null,
      req.ip,
      req.headers['user-agent'] ?? null
    ]
  );
}
