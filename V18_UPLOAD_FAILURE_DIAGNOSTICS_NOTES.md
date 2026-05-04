# V18 Upload Failure Diagnostics

Fixes:
- Upload card now shows the exact failure reason instead of only "Upload failed".
- Upload History stores and displays the backend/parser error in the file row.
- Async upload route now marks failed upload records correctly when the upload stream fails before parsing.
- UI refreshes Upload History and Overview after a failed upload.

Important Railway checks:
- Open `/ready` after deploy. It must show `migration: completed`.
- If migration failed, set `AUTO_MIGRATE=true` or run `npm run db:migrate`.
