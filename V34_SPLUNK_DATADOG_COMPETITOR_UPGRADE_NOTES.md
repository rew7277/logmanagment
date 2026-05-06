# ObserveX V34 — Splunk / Datadog Competitor Upgrade

## Implemented changes

### 1. 10-file parallel ingestion
- Frontend batch upload now runs up to **10 files concurrently**.
- Upload progress now shows batch-level progress instead of blocking on one file.
- Backend ingestion now uses a bounded in-process queue with `MAX_CONCURRENT_INGESTIONS=10` by default.
- You can change the concurrency using:

```bash
MAX_CONCURRENT_INGESTIONS=10
```

### 2. API / endpoint UI cleanup
- Removed the **7-day volume** metric from API rows.
- Removed the large **Delete API** action from the expanded body.
- Added **Delete** beside the API-level Health metric.
- Endpoint-level **Delete** remains beside **View errors**.

### 3. Trace waterfall popup fix
- Trace waterfall step click now opens a sticky full payload popup inside the modal.
- Payload popup includes timestamp, endpoint, latency, trace id, message and raw JSON.
- Close button added for the trace payload popup.

### 4. Additional observability metrics
Overview now includes:
- Error spike count
- Throughput in the last hour
- Top error count and signature
- P95 latency
- Error rate
- Total logs
- Active alerts

### 5. Scalability next step foundation
- Added bounded async ingestion queue so large file batches do not start unlimited parsers.
- Existing async upload pipeline remains compatible with Railway and Docker.
- Recommended production next step: replace in-process queue with Redis/BullMQ workers when moving to multi-instance deployment.

## Files changed
- `public/app.js`
- `public/styles.css`
- `src/routes/api.js`
- `src/services/repository.js`

## Deployment
```bash
npm install
npm run migrate
npm start
```

