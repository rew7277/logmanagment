# V12 Mule Parser + Analytics Fix

## What was wrong
- Mule XML files such as `generate-otp.xml` were being treated as services.
- Historical uploaded logs were excluded from overview because overview used only the last 24 hours.
- Endpoint analytics showed `Calls/hr`, which was misleading for uploaded historical log files.
- A few Mule exception blocks did not carry the API name on the first line, so enrichment was needed from FlowStack / event correlation.

## What changed
- Service detection now prefers the Mule application name, for example `s-gupshup-api`.
- XML files are ignored as service names because they are implementation artifacts, not APIs.
- FlowStack lines are parsed to enrich service, method and endpoint for exception logs.
- Logs with the same Mule event ID are enriched from each other during upload.
- Overview log count and service error rate now use all ingested logs for the selected environment.
- Endpoint Analytics now shows total `Calls` from ingested logs instead of misleading `Calls/hr`.

## Important
After deploying V12, delete old uploaded logs from Overview and re-upload the log file. Existing bad rows in PostgreSQL cannot be corrected automatically unless re-ingested.
