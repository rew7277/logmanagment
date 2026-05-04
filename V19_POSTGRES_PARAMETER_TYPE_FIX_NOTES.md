# V19 Postgres Parameter Type Fix

Fixes Railway/Postgres upload failure:

`could not determine data type of parameter $8`

## Root cause
Postgres could not infer parameter types when nullable values were used inside bulk INSERT / COALESCE statements.

## Fix
Added explicit casts for upload/log/trace SQL parameters:
- UUID fields: `::uuid`
- timestamps: `::timestamptz`
- text fields: `::text`
- JSON payloads: `::jsonb`
- counters: `::int`

Redeploy this version and retry uploading the same log file.
