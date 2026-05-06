# V29 Datadog-level Service Map Upgrade

## What changed

- Removed the header-level `🔗 Service Topology` button from the APIs & Endpoints page.
- Kept per-API `View Topology` routing so a selected API can still open the topology page with highlight.
- Rebuilt topology backend to create an endpoint-only service map.
- Internal nodes now represent API endpoints, for example `POST /htmltopdf`.
- External nodes are created only from downstream request/call patterns found in logs.
- Flow names and Mule internal flow data are no longer displayed as topology nodes.
- Added downstream detection for patterns like:
  - `before request to https://...`
  - `request to https://...`
  - `outbound call to https://...`
  - `calling Salesforce API`
  - `POST /some/downstream/path`
- Added Datadog-style animated traffic packets on edges.
- Added metrics overlay for observed endpoints, dependencies, traffic and average latency.
- Added p95 latency and error-rate aware node/edge coloring.
- Added node detail actions:
  - Open related logs
  - Run topology RCA
- Added topology RCA panel using the existing RCA API.
- Added caching to prevent repeated topology fetch spam; refresh button forces reload.

## Files changed

- `src/services/repository.js`
- `public/app.js`
- `public/index.html`
- `public/styles.css`

## Validation

Validated with:

```bash
node -c public/app.js
node -c src/services/repository.js
PORT=3819 DATABASE_URL= node src/server.js
curl http://localhost:3819/health
curl http://localhost:3819/api/fsbl-prod-ops/PROD/topology
```

The server starts successfully in fallback mode when `DATABASE_URL` is not configured.
