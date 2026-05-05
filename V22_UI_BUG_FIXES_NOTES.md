# V22 — UI Bug Fixes: Sidebar, Theme, Search Icon, Log Colors, APIs/Endpoints

## Bugs Fixed

### 1. Edge Toggle Colliding with Dark Mode Button
**Root cause:** Multiple conflicting `position/top` rules across 10+ CSS blocks all trying to place the toggle differently.  
**Fix:** One authoritative rule at bottom of CSS with `!important` overrides all others.  
- Toggle now sits at `top: 148px` (below brand + theme toggle)  
- Collapsed sidebar: toggle moves to `top: 96px`  
- Mobile: `position: fixed; left: 0`

### 2. Search Icon Appearing Twice  
**Root cause:** `.search-icon` was styled as a CSS circle via `border` + `::after` pseudo-element (drawing the search magnifier handle), while the HTML also contains an `<svg>` inside the span — so both rendered.  
**Fix:** CSS removes all border/animation/::after from `.search-icon`, leaving only the SVG visible. Single crisp icon.

### 3. Log Text Unreadable in Light Theme  
**Root cause:** V21 hardcoded dark-mode colors (`#e5e7eb`, `#9ca3af`, `#d1d5db`) as plain values instead of CSS variables. In light mode these are near-invisible gray-on-white.  
**Fix:** Added proper CSS custom properties:  
- `--log-text` / `--log-text-meta` / `--log-bg` / `--log-svc-color`  
- `:root` = light values (dark text on light bg)  
- `html.dark` = dark values (light text on dark bg)  
All log line, message, meta, analytics bar, modal elements now reference these vars.

### 4. APIs / Services Page Not Loading  
**Root cause:** `loadServices()` had no try/catch — any API error threw uncaught and left the page blank. Also `setPage('apis')` never called `loadServices()`.  
**Fix:**  
- Wrapped in try/catch with toast error  
- `setPage()` now calls page-specific loaders: `apis → loadServices()`, `endpoints → loadEndpoints()`, `logs → searchLogs() + loadServices() + loadEndpoints()`

### 5. Endpoints Page Not Loading  
Same fix as above — try/catch + called from `setPage('endpoints')`.

### 6. Logs Not Displaying After Upload  
**Root cause:** `refreshAll()` called after upload but `searchLogs()` inside `setPage` was not re-fetching with `range: 'all'` after the environment switch.  
**Fix:** `setPage('logs')` now also refreshes services + endpoints dropdown, and `loadServices/loadEndpoints` are robust to failure so they don't block log search.

## Files Changed
| File | Change |
|---|---|
| `public/styles.css` | V22 block: edge toggle placement, search icon dedup, light/dark log vars |
| `public/app.js` | `loadServices`, `loadEndpoints` try/catch + richer rows; `setPage` page-aware loading |
| `public/index.html` | Cache version bump `v22` |
