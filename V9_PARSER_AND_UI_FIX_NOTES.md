# ObserveX V9 - Parser + Product UX Fixes

## Core fixes
- Added dedicated `src/services/logParser.js` parser engine.
- Mule runtime parser groups multi-line Mule logs into one event using severity + timestamp boundaries.
- Generic parser supports JSON, JSON arrays, JSONL-style payloads, and timestamped text logs.
- Pretty JSON payloads inside Mule log messages are preserved in the same log event instead of becoming separate `{` / `}` rows.
- Extracts API/service, method, endpoint, event/trace ID, transaction ID, processor, message, and raw payload.
- Business error payloads such as `status: error` are promoted to ERROR severity for filtering.

## Upload / ingestion
- `/logs/upload` now uses streaming multi-line parsing for raw logs.
- UI uploads do not require API key; direct API `/logs` still uses `INGEST_AUTH_MODE` and `INGEST_API_KEY`.
- Upload result returns parser type `mule+generic`, parsed count, inserted count, rejected count, and bytes.

## Search / analytics
- Log Search now uses API and endpoint dropdowns populated from uploaded/ingested data.
- Endpoint Analytics is updated from parsed API/method/path information.
- Trace investigation remains available from log popup only.
- Upload stays only on Overview to avoid duplicate ingestion UX.

## UI cleanup
- Sidebar collapse button changed to a professional compact control inside the sidebar edge area.
- Cache-busted CSS/JS version updated to V9.
- Log Search input keeps animated search icon and no trace-ID input field.

## Validated with sample Mule file
- `s-gupshup-api-4(1).log` sample parsed into multi-line log events.
- Extracted service: `s-gupshup-api`.
- Extracted endpoints include `/generate-otp`, `/verify-otp`, and `/crif/sms`.
- Multi-line JSON response blocks are stored as part of the same log event.
