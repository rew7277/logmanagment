# V32 API-Scoped Topology Fix

## Fixed
- `View Topology` now scopes the topology to the selected API/service only.
- Endpoint nodes now carry `service` / `api_name` from the backend.
- Endpoint IDs now include the service name, so the same endpoint path under two APIs will not merge.
- Removed the bad UI fallback that showed all topology edges when a selected API had no downstream edges.
- Scoped view now shows: selected API endpoints → detected downstream/third-party dependency.

## Expected Flow
- API Docs → click `View Topology` on `s-paymentengine-api`
- Topology page shows only `s-paymentengine-api` endpoints and its downstream systems.
- Request animation flows left to right.
- Response is visually represented by reverse/return packet animation on the same dependency path.
