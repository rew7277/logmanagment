# ObserveX V10 Cleanup + Re-ingestion Fix

## What changed

- Added environment-level log cleanup API:
  - `DELETE /api/{workspace}/{environment}/logs`
  - Deletes bad parsed logs, discovered services/endpoints, traces, alerts and ingestion records for the selected environment.
- Added **Delete uploaded logs** button on Log Search.
- Removed the top global log search from the header. Search is now only inside Log Search.
- Kept upload only on Overview.
- Improved professional sidebar collapse button placement.
- Search icon is now beside the Log Search input and animates on focus.
- Existing parser still supports both Mule runtime logs and generic JSON/text logs.

## Important

If the previous V8/V9 bad upload created split `{` / `}` logs, you must delete the old environment logs once from Log Search, then re-upload the file. The old bad rows are already in PostgreSQL, so a parser fix alone cannot magically rewrite them.

## Mule parser validation

Tested against the supplied `s-gupshup-api-4(1).log` sample. It extracts:

- Service/API: `s-gupshup-api`
- Endpoints: `/generate-otp`, `/verify-otp`, `/crif/sms`
- Method: GET / POST
- Event/trace ID from `event: ...`
- Multi-line JSON payloads stay inside the same log event.
