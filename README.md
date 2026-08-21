# DepEd Leyte DRRM — Backend

Node.js + TypeScript API for the DepEd Leyte Division DRRM Monitoring System.
Pairs with a separately-deployed Angular frontend (see the companion
`deped-leyte-drrm-frontend` repo).

## Stack

Express, `pg` (raw SQL), PostgreSQL + PostGIS, Socket.IO, Argon2, JWT, node-cron.

## Local development

```bash
createdb deped_leyte_drrm
psql deped_leyte_drrm -f src/db/migrations/001_init.sql

cp .env.example .env   # fill in DB credentials, JWT secrets, FIRMS_MAP_KEY
npm install
npm run dev            # http://localhost:4000
```

Seed the first DRRM Administrator (required so someone can approve later registrations):

```bash
npm run seed:admin -- --email=admin@deped.gov.ph --password=ChangeMe123!
```

## Deploying to Render

This repo includes a `render.yaml` blueprint (New → Blueprint in the Render
dashboard, point it at this repo) that provisions:

- A **Web Service** running this API (`npm install && npm run build` / `npm start`)
- A **Render PostgreSQL** database

Steps:

1. Push this repo to GitHub/GitLab and create a Render Blueprint from it.
2. Once the database is up, open its `psql` shell (from the Render dashboard)
   and run the contents of `src/db/migrations/001_init.sql` — this creates
   the schema and enables the PostGIS extension. Render Postgres supports
   `CREATE EXTENSION postgis;` directly.
3. In the web service's environment variables, set `WEB_ORIGIN` to your
   deployed Netlify frontend URL (comma-separate multiple origins if needed,
   e.g. `https://your-site.netlify.app,http://localhost:4200`).
4. Set `FIRMS_MAP_KEY` (free key from https://firms.modaps.eosdis.nasa.gov/api/map_key/).
5. Once deployed, run the admin seed script against the live database — either
   via Render's shell for the service, or by temporarily running
   `npm run seed:admin -- --email=... --password=...` locally with
   `DATABASE_URL` pointed at the Render database's external connection string.
6. Confirm `https://your-service.onrender.com/health` returns `{"status":"ok"}`.

**Cross-origin notes:** since the frontend and backend are on different
domains, the refresh-token cookie is issued with `sameSite: 'none'` and
`secure: true` whenever `NODE_ENV=production` — this requires HTTPS on both
ends, which Render and Netlify provide by default.

**Free-tier note:** Render's free web services spin down after inactivity;
the first request after idling will be slow while it wakes up, and the sync
scheduler won't run while the service is asleep. A paid instance keeps it
always-on, which matters for timely disaster-event ingestion.
