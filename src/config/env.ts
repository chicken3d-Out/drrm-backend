import dotenv from 'dotenv';
dotenv.config();

function required(name: string, fallback?: string): string {
  const val = process.env[name] ?? fallback;
  if (val === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return val;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '4000', 10),
  // Comma-separated list of allowed frontend origins, e.g.
  // "http://localhost:4200,https://your-site.netlify.app"
  webOrigins: (process.env.WEB_ORIGIN ?? 'http://localhost:4200').split(',').map((o) => o.trim()),
  jwtAccessSecret: required('JWT_ACCESS_SECRET'),
  jwtRefreshSecret: required('JWT_REFRESH_SECRET'),
  accessTokenTtl: process.env.ACCESS_TOKEN_TTL ?? '15m',
  refreshTokenTtlDays: parseInt(process.env.REFRESH_TOKEN_TTL_DAYS ?? '30', 10),
  firmsMapKey: process.env.FIRMS_MAP_KEY ?? '',
  syncIntervalMinutes: parseInt(process.env.SYNC_INTERVAL_MINUTES ?? '10', 10)
};

// Leyte-priority bounding box (also stored in system_settings for runtime tuning)
export const LEYTE_BBOX = {
  minLon: 124.0,
  minLat: 9.8,
  maxLon: 125.35,
  maxLat: 11.8
};

// Whole-Philippines bounding box — events are fetched at this scope, then flagged
// is_leyte_priority = true when they fall inside LEYTE_BBOX, per spec section 11.
export const PH_BBOX = {
  minLon: 116.0,
  minLat: 4.5,
  maxLon: 127.0,
  maxLat: 21.5
};
