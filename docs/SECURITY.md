# Security

## Who can do what

- **WhatsApp access** is closed: an unknown number gets a generic reply and nothing else. The first
  sender becomes the administrator; everyone else is granted by the administrator (chat or portal)
  or through a demo code they send themselves.
- **Features are permissions** (`services/permissions/catalog.ts`). The agent is only offered the
  tools of the person's permissions, and tools re-check `ctx.isAdmin` for admin actions (defense in
  depth). HTTP routes are gated by `requirePermission(...)`; `/api/admin/*` and `/api/connection/*`
  require the administrator.
- **Data isolation**: every model query is scoped by `user_id`. Ids that arrive from the client or
  the model are always resolved with the scoped lookup; ids of other people's rows behave as
  missing (404). References inside a write (a category, a routine, a garment) are checked to belong
  to the same person (`ownCategoryId()` in `api/http-helpers.ts`, model lookups in services).
- The administrator acting **on behalf** of someone (`target_user` in tools) is explicit and
  admin-only.

## Portal authentication

- Login = WhatsApp number + password, hashed with **scrypt**; a dummy hash keeps timing equal for
  unknown numbers.
- Sessions: random token, only its SHA-256 is stored (`web_sessions`); 24 h idle / 7 days max;
  "log out everywhere" for the admin.
- Brute force: lockout after 5 failed attempts for 15 minutes, plus per-IP and per-IP+number rate
  limits on `/api/auth/login`.
- Passwords are never sent through the model: temporary passwords go straight to WhatsApp, and
  the portal forces a change on first use.
- The legacy admin token (`ADMIN_TOKEN` / `auth_info/admin-token.txt`) only works until the
  administrator sets a password.

## HTTP hardening

- Security headers on every response: CSP (`script-src 'self'`, `frame-ancestors 'none'`,
  `object-src 'none'`…), `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`;
  `x-powered-by` off. No CORS - the portal is same-origin.
- `/api`: 240 requests/min per IP, 30 s timeout, 200 KB JSON bodies; `trust proxy` = 1 hop (the
  nginx in front), so the per-IP limits can't be spoofed with `X-Forwarded-For`.
- Errors: known business errors become 4xx with their message; anything else is logged and answered
  with a generic 500 (no stack traces leave the server). Internal refs are stripped from messages.
- Links are stored only when they are `http(s)` URLs (`shared/utils/urls.ts`) and the portal only
  renders `http(s)` hrefs (`utils/url.ts`).
- Uploads (appointment attachments): type checked by content (magic bytes), size and count limits,
  per-person quota, limited concurrency, stored outside the web root and served only to the
  owner/the other party of the appointment.

## Webhooks and external services

- Twilio's call-status webhook verifies `X-Twilio-Signature` (403 otherwise).
- The vision service listens on `127.0.0.1` only.
- Secrets live only in `.env` (gitignored): LLM key, Twilio, DigitalOcean Spaces, Fish Audio, fal.ai.
  They are never logged; `.env.example` holds names and defaults only.

## WhatsApp account safety

Abuse limits that protect the number (send governor, cold-message caps and spacing, suspension of
unanswered recurring notices, single instance) are described in [OPERATIONS.md](OPERATIONS.md).

## Reporting

Security problems: write to the administrator privately (not in an issue).
