# V33 Splunk/Datadog Trace + Batch Upload Upgrade

## Implemented

- Fixed trace waterfall drilldown so each trace step is clickable and opens the full log event payload inside the modal.
- Added trace summary metrics: event count, error count, services touched, duration and max latency support.
- Made trace chips in Log Search clickable without opening the normal log detail first.
- Hardened the frontend API wrapper to detect HTML/non-JSON backend responses and show a useful error instead of `Unexpected token <`.
- Enabled multi-file upload from the Overview drop zone and file picker using `<input multiple>`.
- Added batch upload orchestration with per-file status, background ingestion polling, final refresh and success/failure summary.
- Kept each file as a separate ingestion record so Upload History can delete/view files independently.
- Added premium trace UI styling for clickable waterfall steps and inline full-event drilldown.

## How to test

1. Start the app.
2. Open Overview.
3. Select 2+ `.log`, `.txt`, `.json`, or `.jsonl` files together.
4. Confirm Upload History shows each file separately.
5. Open Log Search and click a `Trace` chip, or open a log and click `Trace this log`.
6. In the trace waterfall popup, click any step to view the full message and raw JSON payload.

## Next enterprise upgrades recommended

- Replace in-process background jobs with Redis/BullMQ or a worker service for production-scale ingestion.
- Add OpenSearch/ClickHouse for high-volume log indexing.
- Add websocket/SSE job progress for live upload telemetry.
- Add RBAC enforcement on every API route.
- Add alert notification channels: email, Teams, Slack, webhook.
- Add retention/archive policies to S3 per workspace/environment.
