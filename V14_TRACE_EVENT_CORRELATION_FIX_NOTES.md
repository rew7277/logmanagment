# V14 Trace/Event/Correlation Fix Notes

Implemented Mule-specific identity extraction and search improvements.

## Fixed
- Extracts Mule event ID from `[processor: ...; event: <id>]`.
- Normalizes Mule `event` into `trace_id`, `event_id`, and `correlation_id` so Log Search and Trace Investigation work even when logs do not explicitly contain `traceId` or `correlationId`.
- Prevents Mule XML files, flow names, subflows, and processor names from being treated as services.
- Keeps correct service/API as the Mule application name, for example `s-gupshup-api`.
- Keeps endpoint visibility as HTTP method + path, for example `GET /generate-otp`.
- Searches by trace ID, event ID, correlation ID, and transaction ID.
- Adds trace upsert from uploaded logs, so logs with Mule event IDs appear in the Trace view.
- Masks long `encrdata` and secret/token-like values before UI display/indexed message output.
- Improves log modal display with Trace/Event ID, Correlation ID, and Transaction ID.

## Validation using uploaded Mule log
- Service detected: `s-gupshup-api`
- Endpoint examples detected: `GET /generate-otp`, `GET /verify-otp`, `POST /crif/sms`
- Mule event IDs extracted from uploaded log lines and normalized into searchable trace/correlation fields.
