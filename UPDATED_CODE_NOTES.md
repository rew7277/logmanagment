# Updated Code Notes

## Changes completed

1. Topology no longer uses dummy/demo nodes.
   - Added `GET /api/:workspace/:environment/topology`.
   - Builds nodes and edges from successful Flow Analytics traces only.
   - Uses trace/event correlation, FlowName, service, endpoint path, HTTP 2xx/3xx status, and latency fields.
   - Shows empty-state guidance when successful flow data is not available.

2. Removed Live Logs from the product UI.
   - Removed the Live Logs navigation item.
   - Removed the Live Logs page from `index.html`.
   - Removed active Live Logs JavaScript wiring and demo streaming simulation.
   - Removed Live Log Streaming marketing pill from the login page.

3. Create Account page now fits the display better.
   - Auth screen now supports scroll instead of clipping.
   - Auth card has max-height and internal scroll for smaller displays.
   - Reduced form spacing and card padding.

4. Invite code is now optional for admin organisation creation.
   - Signup requires first name, work email, workspace, and password only.
   - Invite code is validated only when entered.
   - Create Account is restricted to Admin account creation.
   - Admin can later create invite codes from Settings -> Invite Codes for organisation users.

## Files changed

- `public/index.html`
- `public/app.js`
- `public/login.html`
- `src/routes/api.js`
- `src/services/repository.js`
