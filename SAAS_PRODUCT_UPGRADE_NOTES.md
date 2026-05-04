# ObserveX SaaS Product Upgrade Notes - V5

## What changed in this build

- UI upload no longer fails just because `INGEST_API_KEY` exists. Ingestion auth is now controlled by `INGEST_AUTH_MODE`:
  - `optional` = UI/demo uploads work without a key.
  - `strict` = production API uploads require `Authorization: Bearer <INGEST_API_KEY>` or `X-Api-Key`.
- Sidebar context is compact. Ingest API key is moved to Upload Settings instead of occupying permanent sidebar space.
- Log Search now has pagination and clickable log rows.
- Clicking a log opens a centered drill-down modal with timestamp, service, endpoint, trace ID, message, and raw JSON.
- Dashboard metrics are calculated from ingested data. If no logs are available, the app shows empty/live states instead of fake startup numbers.
- Bulk ingestion is optimized: unique services/endpoints are resolved once per batch and logs are inserted in one SQL statement per batch.

## Upload performance reality

The old implementation inserted one DB row at a time, so even a 10 MB file could feel extremely slow. V5 uses multi-row inserts and a larger batch size.

For true enterprise-scale 500 MB to multi-GB uploads, do not route huge files through the browser and Node process as a single request. The production design should be:

1. Browser requests a pre-signed S3 upload URL.
2. Browser uploads the file directly to S3 using multipart upload.
3. A background worker parses the S3 object in chunks.
4. Worker writes logs to PostgreSQL/ClickHouse/OpenSearch in batches.
5. UI shows job progress, accepted/rejected count, parser errors, and searchable status.

Recommended storage path for 100M+ logs/day:
- PostgreSQL: tenants, users, workspaces, API catalog, ingestion jobs, alerts, saved searches.
- ClickHouse/OpenSearch: high-volume log events and text search.
- S3: raw archive and replay source.
- Redis/BullMQ: ingestion worker queue, retry, progress tracking.

## Next enterprise features

- Real login, org/user/team/RBAC.
- API key management per workspace/environment.
- S3 connector and scheduled ingestion jobs.
- Saved searches and saved dashboards.
- Alert rules from log queries.
- Trace timeline/waterfall from trace/span data.
- PII masking rules before indexing.
- Audit logs for every upload/search/admin action.
- Tenant-aware billing and usage metering.
