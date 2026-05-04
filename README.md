# ObserveX Environment-First Observability

Production-deployable starter for GitHub + Railway with PostgreSQL persistence.

## What was fixed from the Railway log

The attached Railway build failed during `npm ci` and Railway selected `nodejs_24, npm-9_x`. This project pins Node.js 20 and uses `npm install --omit=dev` through `nixpacks.toml`, avoiding the npm CLI failure seen during `npm ci`.

## Features

- Environment-first dashboard: PROD, UAT, DEV and DR are never merged.
- PostgreSQL persistence for:
  - organizations
  - workspaces
  - environments
  - services/APIs
  - endpoints
  - log events
  - traces
  - alerts
  - deployments
  - ingestion jobs
  - security events
- Upload raw logs or JSON lines into the selected environment.
- API-level, endpoint-level, trace-level and log-level views.
- Environment-scoped AI RCA mock endpoint.
- Railway health check at `/health`.

## Local run

```bash
npm install
cp .env.example .env
npm run dev
```

Without `DATABASE_URL`, the app runs with fallback demo data. For persistence, add PostgreSQL and set `DATABASE_URL`.

## Railway deployment

1. Push this folder to GitHub.
2. Create a new Railway project from the GitHub repo.
3. Add a Railway PostgreSQL database.
4. Ensure these variables exist in the app service:

```env
DATABASE_URL=${{Postgres.DATABASE_URL}}
AUTO_MIGRATE=true
SEED_DEMO_DATA=true
NODE_ENV=production
```

5. Deploy.

The app will automatically run migrations and seed demo data on first boot.

## API examples

### Get environment overview

```bash
GET /api/fsbl-prod-ops/PROD/overview
```

### Insert one log event

```bash
POST /api/fsbl-prod-ops/PROD/logs
Content-Type: application/json

{
  "severity": "ERROR",
  "trace_id": "TR-1001",
  "service_name": "payment-engine-api",
  "method": "POST",
  "path": "/payment/status",
  "message": "Backend timeout after 800ms"
}
```

### Upload raw logs

```bash
POST /api/fsbl-prod-ops/PROD/logs/upload
Content-Type: text/plain

2026-05-04 11:20:01 ERROR TR-1001 payment-engine-api timeout
2026-05-04 11:20:02 WARN TR-1001 retry policy triggered
```

## Important product rule

Every table includes `environment_id`. Do not store logs, traces, alerts or deployments without environment context.

Recommended future scale path:

- PostgreSQL: metadata, users, workspaces, environments, alerts, deployments.
- S3: raw log archive by `org/workspace/environment/date/service`.
- ClickHouse or OpenSearch: high-volume searchable logs.
- Redis: live counters, rate limits and dashboard cache.
- Queue workers: async ingestion and parsing.

## Folder structure

```text
public/              Frontend HTML/CSS/JS
src/server.js        Express app
src/routes/api.js    Environment-scoped APIs
src/services/        Repository/data access logic
src/db/migrate.js    PostgreSQL schema
src/db/seed.js       Demo data
railway.json         Railway deploy config
nixpacks.toml        Pins Node.js 20 and install command
```
