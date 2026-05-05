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

## V29 configuration CRUD

Runtime does not require `.md` files. Only this README is documentation.

### AI RCA with OpenAI
1. Create an API key at the OpenAI Platform API Keys page.
2. Add these Railway variables:

```env
AI_PROVIDER=openai
AI_MODEL=gpt-4o-mini
OPENAI_API_KEY=sk-...
```

The browser never stores API keys. The server reads keys from environment variables only.

### Editable/deletable admin settings
The Ops page now supports workspace/environment scoped CRUD for:
- Custom environments: create, rename, delete non-PROD environments.
- Custom PII masking rules: create/update, edit, delete business-specific fields and regex patterns.
- Environment policy: update/reset retention, rate limits, max upload and allowed sources.
- RCA provider: local/OpenAI/Anthropic/Gemini per environment.

After deploy, run:

```bash
npm run db:migrate
```


## V31 changes
- Environment delete now performs explicit scoped cleanup before removing the environment, so custom environments disappear immediately from the UI and database.
- AI RCA Provider card layout was rebuilt to avoid cramped controls.
- API Docs now includes direct API ingest (`POST /logs`), async file upload, sync upload, search, error groups, and RCA test requests.
- For secured API ingest set `INGEST_AUTH_MODE=strict` and `INGEST_API_KEY`, then send either `Authorization: Bearer <key>` or `x-api-key: <key>`.
