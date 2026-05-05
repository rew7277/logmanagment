# V27 Alerts + Ops Upgrade

## Added
- Workspace/environment scoped Alerts command center.
- Built-in alert templates for:
  - Error-rate critical spike
  - Error-rate warning
  - High P95 latency
  - No logs received
  - Parser rejection spike
  - Fatal events present
  - Masking coverage below policy
- Custom alert rule creation UI.
- `POST /alerts/evaluate` to evaluate alert rules immediately.
- `GET/POST /alert-rules` API endpoints.
- Alert cards with severity, metric value, threshold, service scope, and one-click investigation.
- Ops page now includes Deployments, Ingestion Jobs, Security & Masking, Environment Policies, and AI RCA investigation starters.
- RCA page has quick prompt chips.

## Database
Run:

```bash
npm run db:migrate
```

This adds `alert_rules` and alert metadata columns.
