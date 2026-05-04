# V16 Premium UI + Fast Ingestion Upgrade

## What changed

### Ingestion performance
- Added async upload endpoint: `POST /api/{workspace}/{environment}/logs/upload-async`.
- File is received once, queued, then parsed/indexed in background.
- Added job progress endpoint: `GET /api/{workspace}/{environment}/ingestion/{jobId}`.
- UI now polls progress and shows processing stage, parsed count, inserted count and logs/sec.
- Optimized trace rollup: one bulk trace upsert per trace instead of one trace DB call per log row.
- Existing synchronous upload endpoint remains for compatibility.

### Premium UI
- Added real ingestion progress card.
- Added animated upload zone and premium gradient/glass treatment.
- Replaced confusing static upload feedback with clear stages: Receiving file → Queued → Parsing Mule logs → Indexing → Completed.
- Improved hover states, progress bar, and professional visual polish.

## Why uploads felt slow before
- The previous flow waited for upload + parsing + DB inserts + trace upserts before the UI got a final response.
- Trace creation was happening per log, which is expensive for large Mule log files.
- There was no visible progress, so even normal processing felt stuck.

## Deployment notes
- No `node_modules` included.
- Run `npm install` locally or let Railway install dependencies.
- Run `npm run db:migrate` after deployment if PostgreSQL schema is new.
