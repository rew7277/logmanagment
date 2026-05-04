# ObserveX Environment-First Observability

Production-deployable starter system for an environment-first log/API/trace observability platform.

## Product Rule

Every dashboard, API, endpoint, log, trace, alert, deployment and RCA is scoped to one selected environment.

```text
Workspace
 └── Environment
      ├── Overview
      ├── APIs / Services
      ├── Endpoints
      ├── Traces
      ├── Logs
      ├── Alerts
      ├── Deployments
      ├── Ingestion
      ├── Security
      └── AI RCA
```

## Tech Stack

- Node.js 20+
- Express.js backend
- Static HTML/CSS/JS frontend
- Railway-ready deployment
- Mock environment-scoped API layer included

## Local Setup

```bash
npm install
cp .env.example .env
npm run dev
```

Open:

```text
http://localhost:8080
```

Health check:

```text
http://localhost:8080/health
```

## API Examples

```text
GET /api/workspaces
GET /api/environments
GET /api/fsbl/PROD/overview
GET /api/fsbl/PROD/services
GET /api/fsbl/PROD/endpoints
GET /api/fsbl/PROD/traces
GET /api/fsbl/PROD/logs
GET /api/fsbl/PROD/alerts
GET /api/fsbl/PROD/rca
```

## Railway Deployment

1. Push this folder to GitHub.
2. Open Railway.app.
3. Create New Project → Deploy from GitHub repo.
4. Select this repo.
5. Railway will detect Node.js automatically.
6. Add environment variables from `.env.example`.
7. Deploy.

Railway health check path is configured as:

```text
/health
```

## Suggested Production Upgrade Path

### Phase 1
- Add authentication and roles.
- Add PostgreSQL metadata tables.
- Keep mock APIs but replace with database queries.

### Phase 2
- Add S3 log upload.
- Add queue-based ingestion worker.
- Store raw logs in S3 by environment/date/service.

### Phase 3
- Add ClickHouse or OpenSearch for log search.
- Add Redis for real-time counters.
- Add AI RCA using trace/log context.

## Recommended Data Model

Required fields for every log/trace/alert:

```text
org_id
workspace_id
environment
service_name
endpoint
trace_id
timestamp
severity
message
```

Never ingest logs without `environment`.
