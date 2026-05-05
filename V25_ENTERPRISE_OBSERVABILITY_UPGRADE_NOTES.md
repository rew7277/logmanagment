# ObserveX v25 Enterprise Observability Upgrade

## Backend
- Added latency extraction into parsed raw analytics and trace rollups.
- P95 now uses stored trace latency and displays `—` when latency is genuinely unavailable instead of showing misleading `0ms`.
- Added service and endpoint top-error aggregation.
- Added last-seen and 24h traffic delta fields for API/service rows.
- Added error grouping endpoint: `GET /api/{workspace}/{environment}/error-groups`.
- Added trace waterfall endpoint: `GET /api/{workspace}/{environment}/traces/{traceId}`.
- Added upload/deploy impact endpoint: `GET /api/{workspace}/{environment}/deploy-impact`.
- Added HTTP status and flow name filters in log search backend.
- Preserved strict service detection so XML/flow names are not treated as API/services.

## Frontend
- Added Error Groups panel in Log Search.
- Added top-error chips inside API accordion.
- Added Last Seen and traffic delta in API headers.
- Added trace waterfall modal from log details.
- Added Upload/Deploy Impact comparison panel.
- Improved sparkline tooltip with day-wise 7-day volume.
- Improved P95 display to avoid false `0ms` metrics.
- Retained API → endpoint dependent dropdown behavior.

## Deployment
Run:

```bash
npm install
npm run db:migrate
npm start
```

No destructive migration is required.
