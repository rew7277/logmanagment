# V37 Operational Pulse Visualization + Log Search Button Fix

## Fixed
- Operational Pulse is now visual, not just horizontal bars.
- Added clickable circular gauges for Error Rate, Spike Growth, P95 latency, and Throughput.
- Added Previous 1h vs Latest 1h error comparison chart.
- Added Risk Compass based on error rate, spike, and latency pressure.
- Added Dominant Error visual card with safe text truncation.
- All visual pulse widgets route to the related Logs view when clicked.
- Save view button in Log Search is now aligned, wider, and professional.

## Suggested next upgrades
- Add 15-minute bucket charts for error spike and throughput.
- Add endpoint-level heatmap: API x error severity.
- Add incident timeline with deploy markers.
- Add SLO dashboard: availability, latency objective, error budget burn.
- Add RCA drilldown: Top error -> sample traces -> affected APIs -> suggested owner.
- Add WebSocket live tail for PROD/UAT logs.
