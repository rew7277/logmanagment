# V30 Topology Stability + Flow Clarity Fix

## Fixed
- Stopped topology canvas animation when navigating away from Topology, preventing UI jitter/shaking on AI RCA, API Docs, Topology, and Settings navigation.
- Added stable scrollbar gutter and fixed canvas height to prevent layout width/height jumps.
- Rebuilt topology backend as an endpoint-only model.
- Removed fake sequential chains between unrelated endpoints when trace/correlation data is missing.
- Edges are now created only when logs explicitly mention a downstream API/URL/endpoint.
- Topology layout is now a clean left-to-right dependency map:
  - Left: observed API endpoints
  - Right: downstream API dependencies
- Improved downstream extraction from messages and raw fields such as target_url, backend_url, downstream_url, request_url, host, hostname.
- Added noise filtering to avoid Mule flow names, logger/transform/choice steps, validation text, and other non-endpoint data.

## Expected log patterns for downstream detection
- `before request to https://host/path`
- `request to https://host/path`
- `outbound call to https://host/path`
- `calling salesforce api`
- `GET /endpoint`, `POST /endpoint`
- raw fields: `target_url`, `backend_url`, `downstream_url`, `target_endpoint`, `request_url`, `host`, `hostname`
