import { Pool, QueryResultRow } from 'pg';
import dotenv from 'dotenv';
dotenv.config();

// Render (and most managed Postgres providers) require SSL for external
// connections but use a self-signed certificate chain, so we skip strict
// verification. Local development (localhost/127.0.0.1) doesn't need SSL at all.
const connectionString = process.env.DATABASE_URL ?? '';
const isLocal = connectionString.includes('localhost') || connectionString.includes('127.0.0.1');

export const pool = new Pool({
  connectionString,
  ssl: isLocal ? false : { rejectUnauthorized: false }
});

pool.on('error', (err) => {
  // eslint-disable-next-line no-console
  console.error('Unexpected error on idle Postgres client', err);
});

export async function query<T extends QueryResultRow = any>(text: string, params?: any[]) {
  const start = Date.now();
  const res = await pool.query<T>(text, params);
  const duration = Date.now() - start;
  if (process.env.NODE_ENV !== 'production' && duration > 200) {
    // eslint-disable-next-line no-console
    console.warn(`[slow query ${duration}ms] ${text}`);
  }
  return res;
}
