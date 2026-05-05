# V24 – Anomaly, Saved Search, Endpoint UX & Metric Accuracy Fixes

## Added
- Server-side anomaly detection endpoint: `POST /api/:workspace/:environment/anomalies/run`
  - Computes rolling Z-score on service error rates.
  - Auto-creates P2 alerts when current error rate is >2σ above baseline.
  - Runs automatically after upload completion.
- Optional alert webhook sink using `POST_ALERT_WEBHOOK_URL`.
- Saved search APIs:
  - `GET /api/:workspace/:environment/saved-searches`
  - `POST /api/:workspace/:environment/saved-searches`
- Pinned saved searches in Log Search.
- 7-day service log volume sparklines in APIs & Endpoints.
- Per-endpoint **View errors →** action that opens Log Search pre-filtered by service + endpoint + ERROR + last 24h.

## Fixed
- API/service and endpoint metric aggregation now avoids multi-join multiplication between logs and traces.
- Calls, error rate, and P95 are calculated using isolated LATERAL subqueries for cleaner, production-grade numbers.
- Log Search endpoint dropdown is now dependent on selected API/service, so selecting one API displays only its related endpoints.
- APIs & Endpoints layout now has a cleaner action column and better aligned metrics.

## Database migration
Run:

```bash
npm run db:migrate
```

This creates `saved_searches` and keeps existing data intact.
