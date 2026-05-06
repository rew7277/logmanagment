# ObserveX V39 — Premium SaaS Landing + Authentication + Admin Onboarding

## What changed

### Premium SaaS website
- Added a cinematic landing website at `/`.
- Added hero animation, product story, feature showcase, dashboard preview, security/compliance, how-it-works, customer logo placeholders, pricing, FAQ, and final CTA.
- Added light, investor-demo-ready visual system using `/public/site.css`.

### Authentication and onboarding pages
- `/signin.html` — branded sign-in screen with invalid credential state.
- `/org-signup.html` — organization-admin-only signup.
- `/invite-signup.html` — regular user signup via invitation code only.
- `/forgot-password.html` — secure reset request.
- `/reset-password.html` — reset password using token.
- `/admin.html` — Admin Settings panel.

### Backend APIs
New APIs under `/api/auth`:
- `POST /api/auth/org-signup`
- `POST /api/auth/invite-signup`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`
- `GET /api/auth/admin/bootstrap`
- `POST /api/auth/admin/invitations`
- `POST /api/auth/admin/users/:publicId/disable`
- `POST /api/auth/admin/users/:publicId/role`

### Database schema added
New/expanded tables:
- `roles`
- `permissions`
- `role_permissions`
- `users_v2`
- `invitation_codes`
- `password_reset_tokens`
- `sessions`
- `audit_logs_v2`

Existing tables reused:
- `organizations`
- `workspaces`
- `audit_logs`

### RBAC permission map
Default roles:
- `ADMIN`: all permissions
- `OPS`: dashboard, logs, APIs, AI RCA, API delete, audit view
- `DEVELOPER`: dashboard, upload/view logs, view APIs, AI RCA
- `TESTER`: dashboard, upload/view logs, view APIs
- `VIEWER`: dashboard, view logs, view APIs

Permission keys:
- `dashboard:view`
- `logs:upload`
- `logs:view`
- `logs:delete`
- `apis:view`
- `apis:delete`
- `ai:rca`
- `users:manage`
- `roles:manage`
- `audit:view`
- `billing:manage`
- `settings:manage`
- `invites:manage`

### Audit logging strategy
Sensitive actions are written to `audit_logs_v2` with:
- timestamp
- actor
- action
- target
- IP address
- status
- details JSON

Tracked actions include:
- organization created
- login success/failure
- logout
- invitation created/used
- user disabled
- role updated
- password reset requested/completed

### Security checklist
Implemented:
- Password hashing with `bcryptjs`.
- JWT-style signed session token.
- HttpOnly cookie session storage.
- Server-side invitation code validation.
- One-time invitation support.
- Expiring password reset tokens.
- Public IDs exposed instead of internal UUIDs where possible.
- API JSON error responses.
- RBAC permission guard for admin APIs.
- Audit trail for sensitive actions.

Recommended production next steps:
- Configure strong `JWT_SECRET` in Railway.
- Add SMTP provider and email actual password reset links.
- Add CSRF protection for cookie-authenticated POST APIs.
- Add invitation download as CSV/PDF from UI.
- Add Stripe billing integration.
- Add organization domain allowlist and SSO/SAML.
- Add field-level encryption for phone and other sensitive fields.
