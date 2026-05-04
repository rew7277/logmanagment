# ObserveX — Environment-First Observability Platform

Production-deployable starter for Railway.app with GitHub.

## What this version fixes

1. **Railway build instability**
   - Uses an explicit `Dockerfile` instead of Nixpacks auto-generated npm install.
   - Pins runtime to `node:20-bookworm-slim`.
   - Uses `npm install --omit=dev --no-audit --no-fund --legacy-peer-deps`.

2. **Healthcheck failures**
   - `/health` is now fast and does not wait for PostgreSQL migration/seed.
   - App starts first, then database startup tasks run asynchronously.
   - `/ready` validates PostgreSQL connection and migration status.

3. **PostgreSQL persistence**
   - Stores organizations, workspaces, environments, services, endpoints, logs, traces, alerts, deployments, ingestion jobs and security events.
   - All operational data is environment-scoped.

## Architecture

```text
Organization
 └── Workspace
      └── Environment: PROD / UAT / DEV / DR
           ├── Services / APIs
           ├── Endpoints
           ├── Logs
           ├── Traces
           ├── Alerts
           ├── Deployments
           ├── Ingestion Jobs
           └── Security Events
```

## Railway deployment

1. Push this folder to GitHub.
2. Create a new Railway project from the GitHub repo.
3. Add a PostgreSQL service in Railway.
4. Add environment variables:

```env
NODE_ENV=production
AUTO_MIGRATE=true
SEED_DEMO_DATA=true
JSON_LIMIT=5mb
```

Railway normally injects `DATABASE_URL` automatically when PostgreSQL is attached. If not, manually copy the PostgreSQL connection URL into `DATABASE_URL`.

5. Deploy.

## Health endpoints

```text
/health  -> App liveness. Railway should use this.
/ready   -> App + PostgreSQL readiness.
```

## API examples

```bash
GET /api/workspaces
GET /api/fsbl-prod-ops/PROD/overview
GET /api/fsbl-prod-ops/PROD/services
GET /api/fsbl-prod-ops/PROD/endpoints
GET /api/fsbl-prod-ops/PROD/logs
POST /api/fsbl-prod-ops/PROD/logs/upload
POST /api/fsbl-prod-ops/PROD/rca
```

## Upload logs

Plain text upload:

```bash
curl -X POST "https://your-app.railway.app/api/fsbl-prod-ops/PROD/logs/upload" \
  -H "Content-Type: text/plain" \
  --data-binary @app.log
```

JSON log event:

```bash
curl -X POST "https://your-app.railway.app/api/fsbl-prod-ops/PROD/logs" \
  -H "Content-Type: application/json" \
  -d '{"severity":"ERROR","trace_id":"TR-100","service_name":"payment-engine-api","path":"/payment/status","message":"Backend timeout"}'
```

## Important product rule

Never merge environments. Every log, trace, alert, deployment and RCA result must include `environment_id`.


## Updated SaaS Enhancements

This package now includes:

- Light/dark theme toggle.
- Sidebar open/close toggle.
- Toast notifications instead of browser alerts.
- Drag-and-drop log upload UI.
- Environment-scoped log search using `GET /api/:workspace/:environment/logs?q=`.
- PostgreSQL full-text search indexes for logs.
- Database-derived endpoint metrics instead of misleading hardcoded values.
- In-app ingestion API documentation.
- Improved RCA evidence summary based on selected environment logs.

See `SAAS_AUDIT_AND_ROADMAP.md` for the full product/security/architecture checklist.
