# ObserveX SaaS Pro V6 Fix Notes

This build fixes the main V5 blocker: when DATABASE_URL was missing or not connected, uploads returned success but logs were not retained/searchable. V6 adds an in-memory fallback store for local/demo mode and keeps PostgreSQL as the production source of truth.

## Tested
- App startup without DATABASE_URL
- /health
- Raw log upload
- Log search with pagination
- Service and endpoint derivation from uploaded logs
- RCA endpoint no longer crashes on paginated log response

## Railway required variables
For production persistence, set DATABASE_URL from Railway PostgreSQL. Without it, data is demo-only and will reset on restart.

Recommended:
- DATABASE_URL=<Railway Postgres URL>
- AUTO_MIGRATE=true
- SEED_DEMO_DATA=false
- INGEST_AUTH_MODE=strict during testing, strict in production
- INGEST_API_KEY=<strong random key> when strict
- MAX_UPLOAD_BYTES=786432000

## Large upload reality
Browser upload of 500MB+ through app server is not ideal for a $100M SaaS. Production design should use direct-to-S3 pre-signed multipart upload, then background parse via worker queue. This build supports streaming server upload, but S3 multipart is the correct enterprise architecture.
