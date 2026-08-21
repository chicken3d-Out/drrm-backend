import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../config/db';
import { requireAuth, requireRole, AuthedRequest } from '../../middleware/auth.middleware';
import { writeAudit } from '../../common/audit';

const router = Router();
const ADMIN_ROLES = ['DRRM_ADMIN', 'DIVISION_DRRM_STAFF'];

router.get('/', requireAuth, async (req, res) => {
  const { municipality, district, school_type } = req.query;
  const clauses: string[] = [];
  const params: any[] = [];
  if (municipality) {
    params.push(municipality);
    clauses.push(`s.municipality ILIKE $${params.length}`);
  }
  if (district) {
    params.push(district);
    clauses.push(`s.district ILIKE $${params.length}`);
  }
  if (school_type) {
    params.push(school_type);
    clauses.push(`s.school_type = $${params.length}`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const { rows } = await query(
    `SELECT s.id, s.school_id, s.name, s.school_type, s.district, s.municipality, s.barangay, s.status,
            ST_Y(sl.point::geometry) AS latitude, ST_X(sl.point::geometry) AS longitude
     FROM schools s
     LEFT JOIN school_locations sl ON sl.school_id = s.id
     ${where}
     ORDER BY s.municipality, s.name`,
    params
  );
  res.json(rows);
});

router.get('/:id', requireAuth, async (req, res) => {
  const { rows } = await query(
    `SELECT s.*, ST_Y(sl.point::geometry) AS latitude, ST_X(sl.point::geometry) AS longitude
     FROM schools s
     LEFT JOIN school_locations sl ON sl.school_id = s.id
     WHERE s.id = $1`,
    [req.params.id]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'School not found.' });

  const contacts = await query(`SELECT * FROM school_contacts WHERE school_id = $1`, [req.params.id]);
  res.json({ ...rows[0], contacts: contacts.rows });
});

const schoolSchema = z.object({
  schoolId: z.string().min(1),
  name: z.string().min(1),
  schoolType: z.enum(['Elementary', 'Junior High School', 'Senior High School', 'Integrated School', 'Other']),
  district: z.string().optional(),
  municipality: z.string().min(1),
  barangay: z.string().optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180)
});

router.post('/', requireAuth, requireRole(...ADMIN_ROLES), async (req: AuthedRequest, res) => {
  const parsed = schoolSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
  const d = parsed.data;

  const { rows } = await query(
    `INSERT INTO schools (school_id, name, school_type, district, municipality, barangay)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [d.schoolId, d.name, d.schoolType, d.district ?? null, d.municipality, d.barangay ?? null]
  );
  const schoolId = rows[0].id;
  await query(
    `INSERT INTO school_locations (school_id, point) VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326))`,
    [schoolId, d.longitude, d.latitude]
  );
  await writeAudit(req, { userId: req.user!.id, action: 'CREATE', entity: 'schools', entityId: schoolId });
  res.status(201).json({ id: schoolId });
});

router.patch('/:id', requireAuth, requireRole(...ADMIN_ROLES), async (req: AuthedRequest, res) => {
  const parsed = schoolSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
  const d = parsed.data;

  const fields: string[] = [];
  const params: any[] = [];
  const map: Record<string, string> = {
    schoolId: 'school_id',
    name: 'name',
    schoolType: 'school_type',
    district: 'district',
    municipality: 'municipality',
    barangay: 'barangay'
  };
  for (const [key, col] of Object.entries(map)) {
    if ((d as any)[key] !== undefined) {
      params.push((d as any)[key]);
      fields.push(`${col} = $${params.length}`);
    }
  }
  if (fields.length > 0) {
    params.push(req.params.id);
    await query(`UPDATE schools SET ${fields.join(', ')}, updated_at = now() WHERE id = $${params.length}`, params);
  }
  if (d.latitude !== undefined && d.longitude !== undefined) {
    await query(
      `INSERT INTO school_locations (school_id, point) VALUES ($1, ST_SetSRID(ST_MakePoint($2,$3),4326))
       ON CONFLICT (school_id) DO UPDATE SET point = EXCLUDED.point, updated_at = now()`,
      [req.params.id, d.longitude, d.latitude]
    );
  }
  await writeAudit(req, { userId: req.user!.id, action: 'UPDATE', entity: 'schools', entityId: req.params.id });
  res.json({ message: 'Updated.' });
});

export default router;
