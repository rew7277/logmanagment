# ObserveX SaaS Product Audit & Implementation Notes

## Implemented in this updated package

### UI / UX
- Added light/dark theme toggle with persisted preference.
- Added sidebar open/close behavior with persisted preference.
- Replaced blocking `alert()` messages with non-blocking toast notifications.
- Added drag-and-drop manual log upload area.
- Added search-as-you-type log filtering scoped to the selected environment.
- Added in-app ingestion API documentation section.
- Added safer HTML escaping for rendered log/service/API data.

### Backend / API
- Added PostgreSQL full-text search index for log messages.
- Updated `/logs` API to accept `q=` and search message, trace id, and service name.
- Replaced hardcoded endpoint metrics with database-derived calls/hour, endpoint error rate, P95 latency, and backend latency from trace metadata.
- Improved RCA response with evidence counts: matched logs, errors, warnings, and affected services.
- Kept ingest API key protection and rate limiting for upload/API ingestion endpoints.

### Database / Observability
- Added GIN index on `to_tsvector('simple', message)` for log search.
- Added GIN index on raw JSONB logs for future structured filtering.
- Maintained environment-first partitioning across org, workspace, environment, service, endpoint, traces, logs, alerts, deployments, ingestion jobs, and security events.

## High-priority SaaS gaps still recommended

### Authentication & tenancy
- Add real user authentication: email/password, password reset, email verification, JWT refresh tokens, secure cookies.
- Add RBAC: owner, admin, developer, tester, auditor, viewer.
- Enforce tenant/workspace/environment authorization on every read and write endpoint. Current read APIs are still public for demo simplicity.
- Add audit logs for login, invite, role changes, API key generation, uploads, and deletions.

### Production ingestion architecture
- Move large ingestion to async workers: API receives logs → queue → parser worker → storage/search.
- Store raw original files in S3-compatible object storage with retention policy.
- Use PostgreSQL for starter metadata, but move high-volume log analytics to ClickHouse/OpenSearch/Loki when volume grows.
- Add ingestion source management: API key per source, S3 connector, webhook connector, MuleSoft connector, parser profile, schedule, and retry policy.

### Security
- Require `INGEST_API_KEY` in production and fail startup if missing.
- Add per-tenant API keys and key rotation.
- Add request size limits per plan and per source.
- Add field masking rules before storage: Aadhaar, PAN, mobile, email, token, password, authorization headers.
- Add CORS allowlist using `APP_ORIGIN` instead of open CORS.
- Add CSP nonce/hash policy after frontend build tooling is introduced.

### Product features
- Saved dashboards per environment.
- Incident timeline: alert → deployment → trace → logs → RCA.
- Service ownership and escalation matrix.
- SLO/SLA definitions per service and endpoint.
- Alert rules and notification channels: email, Slack/Teams, webhook.
- API documentation page with copy buttons, SDK snippets, and API key management.
- Environment comparison as a separate explicit screen, never mixed by default.

### Commercial SaaS readiness
- Plans and usage metering: logs/day, retention days, users, environments, connectors, AI RCA credits.
- Billing integration and invoice history.
- Tenant custom branding and custom domain/subdomain routing.
- Data retention, export, and delete workflows.
- SOC2-style controls: audit logs, access reviews, encryption, backup, DR drill evidence.

## UI fixes added in this build

- Real SPA-style page navigation: Overview, APIs / Services, Endpoints, Traces, Logs, Alerts, Ops, AI RCA and API Docs now render as separate right-side pages instead of one long page.
- Sidebar collapse/open is now wired to JavaScript and persists in localStorage.
- Added a floating edge handle attached to the sidebar boundary for easy open/close.
- Light/dark theme is fully wired using `html[data-theme]` CSS variables and persists in localStorage.
- Log ingestion now has a proper drag-and-drop zone plus click-to-select file input.
- Upload UI supports protected ingestion by accepting an optional API key from the sidebar and sending it as `Authorization: Bearer <key>`.
- Search remains environment-scoped and refreshes the log stream without mixing environments.
