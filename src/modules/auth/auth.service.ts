import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { query } from '../../config/db';
import { env } from '../../config/env';

const DEPED_EMAIL_RE = /^[a-zA-Z0-9._%+-]+@deped\.gov\.ph$/i;

export function isDepedEmail(email: string): boolean {
  return DEPED_EMAIL_RE.test(email);
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  return argon2.verify(hash, password);
}

export interface AccessTokenPayload {
  sub: string; // user id
  roles: string[];
}

export function signAccessToken(payload: AccessTokenPayload): string {
  const options: jwt.SignOptions = { expiresIn: env.accessTokenTtl as jwt.SignOptions['expiresIn'] };
  return jwt.sign(payload, env.jwtAccessSecret, options);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.jwtAccessSecret) as AccessTokenPayload;
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function issueRefreshToken(userId: string): Promise<string> {
  const token = crypto.randomBytes(48).toString('hex');
  const expiresAt = new Date(Date.now() + env.refreshTokenTtlDays * 24 * 60 * 60 * 1000);
  await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
    [userId, hashToken(token), expiresAt]
  );
  return token;
}

export async function rotateRefreshToken(oldToken: string): Promise<{ userId: string; newToken: string } | null> {
  const hashed = hashToken(oldToken);
  const { rows } = await query(
    `SELECT id, user_id FROM refresh_tokens
     WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`,
    [hashed]
  );
  if (rows.length === 0) return null;
  const record = rows[0];
  await query(`UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1`, [record.id]);
  const newToken = await issueRefreshToken(record.user_id);
  return { userId: record.user_id, newToken };
}

export async function revokeRefreshToken(token: string): Promise<void> {
  await query(`UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1`, [hashToken(token)]);
}

export async function getUserRoles(userId: string): Promise<string[]> {
  const { rows } = await query(
    `SELECT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = $1`,
    [userId]
  );
  return rows.map((r) => r.name);
}
