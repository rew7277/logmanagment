# ObserveX V11 Fix Notes

## Fixed in this build

- Moved **Delete uploaded logs for this environment** to the Overview upload card, directly below drag-and-drop upload.
- Removed delete action from Log Search.
- Fixed `Cannot set properties of null (setting 'innerHTML')` by making UI rendering null-safe and removing dependency on missing DOM containers.
- Fixed sidebar collapse control alignment: button is now positioned on the sidebar edge and no longer sits on top of sidebar icons.
- Added cache-busted assets: `app.js?v=20260504-pro-v11` and `styles.css?v=20260504-pro-v11`.
- Upload refresh now updates overview, services, endpoints, alerts/ops, and log search after successful parsing.

## Important operational note

If old split logs are already stored in PostgreSQL, use:

Overview → Environment Log Upload → **Delete uploaded logs for this environment**

Then re-upload the Mule log file. Parser fixes apply to new ingestion; previously saved bad rows cannot auto-correct without deletion/re-ingestion.
