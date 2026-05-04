# V17 - Upload History + Professional Delete UX

## Added
- New sidebar page: **Upload History**.
- File-level upload tracking using `ingestion_jobs`.
- File-level log ownership using `log_events.upload_id`.
- Select all / delete selected / delete all upload history.
- Per-file delete that removes only logs from the selected uploaded file.
- Premium, subtle delete button styling to avoid the old aggressive red developer-style button.
- Upload history summary cards: files, completed, failed, stored logs.
- View logs action from upload history.

## Backend APIs
- `GET /api/:workspace/:environment/uploads`
- `DELETE /api/:workspace/:environment/uploads` with body `{ "ids": [...] }`
- `DELETE /api/:workspace/:environment/uploads` with body `{ "all": true }`
- `DELETE /api/:workspace/:environment/uploads/:uploadId`

## Database Changes
- Adds `log_events.upload_id UUID REFERENCES ingestion_jobs(id)`.
- Adds `idx_logs_upload` index.

## Behaviour
- Upload creates a history record immediately.
- Background ingestion updates the same upload history record.
- Deleting one uploaded file deletes only its log rows, then cleans orphan traces/endpoints/services.
- Deleting all upload history clears environment upload logs and derived data.
