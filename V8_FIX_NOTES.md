# ObserveX SaaS Pro V8 Fix Notes

## Fixed in this build

- Moved drag & drop upload to the Overview page only.
- Removed duplicate upload UI from Log Search.
- Removed Trace ID filter field from Log Search. Trace investigation now starts from a log detail popup.
- Added a cleaner professional sidebar collapse control attached to the sidebar edge.
- Added compact log-search UI with animated search icon and a single Search Logs action.
- Fixed pretty JSON upload parsing so one JSON object is not split into multiple broken log rows.
- Added stronger parser normalization for API/service name, endpoint/path, method, correlation ID, event ID, transaction ID and trace ID.
- Services and endpoints are auto-created from uploaded or API-ingested logs.
- Fixed endpoint de-duplication during bulk uploads to improve upload speed.
- Kept UI upload open without API key. API key security remains for direct `/logs` ingestion endpoint and can be enabled for strict machine-to-machine ingestion.

## Recommended production architecture

Upload / API Ingestion → Parser & Normalizer → Service + Endpoint Detection → Log Store → Search / RCA / Analytics.

For files above hundreds of MB, use S3 pre-signed upload or multipart chunked upload, then process asynchronously with a worker queue. The current backend supports streaming uploads, but a SaaS-grade product should not keep browser sessions waiting for long-running ingestion.
