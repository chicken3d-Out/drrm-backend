import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { query, pool } from '../../config/db';
import {
  isDepedEmail,
  hashPassword,
  verifyPassword,
  signAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  getUserRoles
} from './auth.service';
import { writeAudit } from '../../common/audit';
import { env } from '../../config/env';

const router = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again later.' }
});

const REFRESH_COOKIE = 'drrm_refresh';

function setRefreshCookie(res: any, token: string) {
  const crossSite = env.nodeEnv === 'production';
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: crossSite, // must be true whenever sameSite is 'none'
    sameSite: crossSite ? 'none' : 'lax',
    maxAge: env.refreshTokenTtlDays * 24 * 60 * 60 * 1000,
    path: '/api/v1/auth'
  });
}

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(10, 'Password must be at least 10 characters'),
  fullName: z.string().min(2),
  designation: z.string().optional(),
  office: z.string().optional(),
  contactNumber: z.string().optional()
});

router.post('/register', authLimiter, async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
  }
  const { email, password, fullName, designation, office, contactNumber } = parsed.data;

  if (!isDepedEmail(email)) {
    return res.status(400).json({ error: 'Registration requires a valid @deped.gov.ph email address.' });
  }

  const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
  if (existing.rows.length > 0) {
    return res.status(409).json({ error: 'An account with this email already exists.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const passwordHash = await hashPassword(password);
    const userResult = await client.query(
      `INSERT INTO users (email, password_hash, status) VALUES ($1, $2, 'PENDING') RETURNING id`,
      [email, passwordHash]
    );
    const userId = userResult.rows[0].id;
    await client.query(
      `INSERT INTO user_profiles (user_id, full_name, designation, office, contact_number)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, fullName, designation ?? null, office ?? null, contactNumber ?? null]
    );
    await client.query(`INSERT INTO notification_preferences (user_id) VALUES ($1)`, [userId]);
    await client.query('COMMIT');

    await writeAudit(req, { userId, action: 'REGISTER', entity: 'users', entityId: userId });

    res.status(201).json({
      message: 'Registration received. Your account is pending review by a DRRM Administrator.'
    });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

router.post('/login', authLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid input' });
  }
  const { email, password } = parsed.data;

  const { rows } = await query(
    `SELECT id, password_hash, status FROM users WHERE email = $1`,
    [email]
  );
  // Constant-ish response regardless of whether the email exists, to avoid enumeration.
  const genericError = { error: 'Invalid email or password.' };
  if (rows.length === 0) return res.status(401).json(genericError);

  const user = rows[0];
  const ok = await verifyPassword(user.password_hash, password);
  if (!ok) {
    await writeAudit(req, { userId: user.id, action: 'LOGIN_FAILED', entity: 'users', entityId: user.id });
    return res.status(401).json(genericError);
  }

  if (user.status !== 'APPROVED') {
    return res.status(403).json({
      error:
        user.status === 'PENDING'
          ? 'Your account is still pending approval by a DRRM Administrator.'
          : user.status === 'SUSPENDED'
          ? 'Your account has been suspended. Contact your DRRM Administrator.'
          : 'Your account registration was not approved.'
    });
  }

  const roles = await getUserRoles(user.id);
  const accessToken = signAccessToken({ sub: user.id, roles });
  const refreshToken = await issueRefreshToken(user.id);
  setRefreshCookie(res, refreshToken);

  await query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [user.id]);
  await writeAudit(req, { userId: user.id, action: 'LOGIN', entity: 'users', entityId: user.id });

  res.json({ accessToken, roles });
});

router.post('/refresh', async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (!token) return res.status(401).json({ error: 'No refresh token provided.' });

  const result = await rotateRefreshToken(token);
  if (!result) {
    res.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
    return res.status(401).json({ error: 'Refresh token invalid or expired. Please log in again.' });
  }

  const roles = await getUserRoles(result.userId);
  const accessToken = signAccessToken({ sub: result.userId, roles });
  setRefreshCookie(res, result.newToken);
  res.json({ accessToken, roles });
});

router.post('/logout', async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (token) {
    await revokeRefreshToken(token);
  }
  res.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
  res.json({ message: 'Logged out.' });
});

export default router;
