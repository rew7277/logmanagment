# ObserveX V40 — Apple-style SaaS Landing + Auth/Admin Polish

## What changed

### Landing page
- Rebuilt `/landing.html` with a modern Apple-style cinematic SaaS experience.
- Added sticky premium header with Product, Security, Pricing, Docs, Sign In, Create Account.
- Added animated hero, floating gradient orbs, product-story stage, dashboard preview, security, how-it-works, pricing, FAQ and final CTA.
- Added dark/light theme toggle on the landing page.

### Auth pages
- Rebuilt:
  - `/signin.html`
  - `/org-signup.html`
  - `/invite-signup.html`
  - `/forgot-password.html`
  - `/reset-password.html`
- Added dark/light theme toggle on all auth pages.
- Added branded, premium, enterprise-ready UI with polished forms and error/success states.
- Organization signup is clearly Admin-only.
- User signup is invitation-code based only.

### Admin / Organization dashboard
- Rebuilt `/admin.html` with a dedicated Admin sidebar.
- Added visible Settings button and Sign Out button.
- Added Organization Settings panel:
  - Organization name
  - Timezone
  - Currency
  - Basic branding / color picker
  - Logo preview input
  - Default invite role
  - Organization-level data controls
- Added Users, Roles & Permissions, Invitation Codes, Audit Logs, Security and Billing sections.
- Audit logs include a lock/eye indicator for ADMIN/OPS visibility.

### Main app shell
- Added Settings shortcut in the product sidebar.
- Added Sign Out button in the product sidebar.
- Added Settings shortcut in the topbar.

### Backend/database
- Added organization settings columns:
  - timezone
  - currency
  - primary_color
  - default_invite_role
  - logo_url
- Added `/api/auth/admin/settings` route protected by `settings:manage` permission.
- Organization settings update is audited as `organization.settings_updated`.

## Deployment
- Redeploy normally on Railway.
- No DB reset is required. The migration uses `ADD COLUMN IF NOT EXISTS`.

## Recommended next upgrades
1. Persist uploaded organization logo to S3 or Railway volume and render it in the workspace sidebar.
2. Add admin-configurable retention policies per environment.
3. Add environment access matrix by role: PROD read-only for VIEWER, DEV upload enabled for TESTER, etc.
4. Add SCIM/SAML/SSO for enterprise readiness.
5. Add tamper-evident audit log hash chain for compliance-grade auditability.
6. Add a public marketing demo video or animated product mockup on the landing hero.
7. Add billing usage meters: logs/day, retention days, AI RCA usage, users, workspaces.
