# V38 - Light Theme, Save View, Operational Pulse Routing Fixes

## Fixed
- Fixed white theme cards where KPI values were not visible because button styling inherited white text.
- Fixed Operational Pulse routing by wiring pulse actions to the same metric router used by top KPI cards.
- Fixed Save view button layout in Log Search so it no longer gets squeezed or overlaps.
- Added desktop/tablet/mobile responsive Log Search toolbar grid.
- Improved light theme contrast for Operational Pulse cards, gauge rings, AI insight hint, and top error text.

## Behaviour
- Error rate / Error spike / Top error pulse cards route to filtered ERROR logs.
- P95 latency routes to latency-related log search.
- Throughput routes to latest 1-hour log stream.
- Save view remains visible as a professional CTA across screen sizes.

## Additional Recommendations
1. Add a 15-minute error spike timeline below Operational Pulse.
2. Add deploy/release markers on the spike timeline to correlate incidents.
3. Add API x Error Severity heatmap for quick API-level hotspot detection.
4. Add trace latency waterfall grouped by API endpoint.
5. Add SLO/Error-budget dashboard per environment.
6. Add WebSocket-based live tail for production logs.
7. Add “compare PROD vs UAT” view for release validation.
