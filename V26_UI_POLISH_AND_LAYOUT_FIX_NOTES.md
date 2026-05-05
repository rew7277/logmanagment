# V26 UI Polish and Layout Fixes

Implemented based on screenshot review:

## APIs & Endpoints
- Removed Deploy / Upload Impact from APIs & Endpoints page.
- Moved Deploy / Upload Impact to Upload History, where upload comparison belongs.
- Reworked API header metric layout to prevent Status / Observed collision.
- Added fixed metric columns for 7-day volume, status, error, P95, and health.
- Replaced fake-looking 7-day volume with a safe renderer:
  - Shows real sparkline only when there are at least two active days with different counts.
  - Otherwise shows `No trend` instead of decorative/static bars.
- Added cleaner status dot + badge alignment.
- Added smoother API-card hover polish.

## Log Search
- Rebuilt large filter area into a compact single-row toolbar.
- Converted Save Search and Run Anomaly Check into compact icon actions.
- Reduced pinned-search height.
- Hidden Error Groups section when no grouped errors are available.
- Reduced vertical spacing so logs start much higher on the page.
- Improved log viewport height to use available screen space.
- Collapsed long log messages by default with hover expansion.

## Functional Fixes Preserved
- API selection still filters endpoint dropdown.
- Endpoint selection resets correctly when API changes.
- Search, pinned filters, anomaly check, trace modal, upload history, and deploy impact continue using existing APIs.
