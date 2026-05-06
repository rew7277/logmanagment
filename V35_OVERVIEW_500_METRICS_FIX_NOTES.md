# V35 Overview 500 + Metrics Fix

## Fixed
- `/api/:workspace/:environment/overview` 500 error caused by querying missing `log_events.error_type` column.
- Top error now reads from `log_events.raw->>'error_type'`, `raw->>'exception'`, payload errorType, HTTP status, then normalized message.
- Added defensive defaults so overview does not fail when metrics are empty.

## Added overview metrics
- Success rate
- P99 latency estimate
- Error budget burn
- APDEX
- Throughput per minute
- Recent errors 1h
- Previous errors 1h
- Error spike percentage
- Operational pulse bars for error rate, spike growth, P95 latency, and throughput
- AI investigation hint based on spike/error/latency status

## Deployment
Redeploy this ZIP to Railway. No DB reset is required.
