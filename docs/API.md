# REST API

The portal (`frontend/`) and the public site talk to the backend over a JSON API on the same
origin. The full reference is **[api/openapi.yaml](api/openapi.yaml)** (OpenAPI 3.1, 134
operations). To browse it:

```bash
npx @redocly/cli preview-docs docs/api/openapi.yaml     # or paste the file into editor.swagger.io
```

The reference is generated from `docs/api/build-openapi.py`; after adding or changing a route,
update that file and run `npm run docs:api` (both files are committed).

## Conventions

- **Auth**: `POST /api/auth/login` with `{ phone, password }` returns a session token; send it as
  `Authorization: Bearer <token>` on every other `/api` call. `GET /api/auth/me` returns the person,
  their permissions and modules. Public endpoints: `/api/public/*`, the login itself and the Twilio
  webhook.
- **Scoping**: every row belongs to the signed-in person. Ids of other people's rows behave as if
  they didn't exist (404).
- **Permissions**: each resource prefix is gated by a permission (listed per operation in the
  reference). Missing it answers `403 { error }`. `/api/admin/*` and `/api/connection/*` are for the
  administrator only.
- **Errors**: `{ "error": "<message>", "code"?: "<CODE>" }`. Messages are Spanish because the
  portal shows them as they come. `code` is set for flows the client reacts to
  (`MUST_CHANGE_PASSWORD`, `NO_PORTAL`).
- **Dates**: `'YYYY-MM-DD'` and local wall-clock times `'YYYY-MM-DD HH:mm:ss'` in the bot's time
  zone (America/Bogota) - no offsets, no UTC conversion.
- **Writes** return `{ id }` (201) on create and `{ ok: true }` otherwise, unless the reference says
  otherwise. `PATCH` endpoints change only the fields sent; `null` clears a field.
- **Limits**: 240 requests/minute per IP on `/api`, 30 s per request, 200 KB JSON bodies; stricter
  limits on login, password changes and voice samples. File uploads (appointment attachments):
  JPG/PNG/WEBP/PDF checked by content, 10 MB each, 5 per request, 200 MB per person.

## Main resources

| Prefix | Permission | What |
| --- | --- | --- |
| `/api/calendar` | any (filtered per kind) | dated items of a range as calendar events |
| `/api/library` | `library.manage` | movies, series, music, books, games, podcasts |
| `/api/reminders`, `/api/call-reminders` | `reminders.manage`, `reminders.calls` | reminders, phone calls |
| `/api/todos`, `/api/routines`, `/api/reminder-responses` | `todos.manage` / `routines.manage` | to-dos, routines, check-ins, answers |
| `/api/notes`, `/api/links`, `/api/categories`, `/api/lists` | `notes.manage`, `links.manage`, `todos.manage` | information modules |
| `/api/medications` | `medications.manage` | Medicamentos y belleza: CRUD, pause, `POST /:id/log` (dose taken) |
| `/api/meals`, `/api/recipes`, `/api/rewards`, `/api/contacts` | per module | meals with `meal_time`/`prep_minutes` schedule their notices (`PUT /api/meals/:id` edits) |
| `/api/garments`, `/api/garment-questions` | `fashion.use` | wardrobe |
| `/api/scheduling/pro/*`, `/api/scheduling/client/*` | `scheduling.professional`, `scheduling.client` | appointments |
| `/api/voices` | `voice.premium` | natural voice |
| `/api/admin/*`, `/api/connection/*` | administrator | people, permissions, usage, analytics, WhatsApp session |
| `/api/public/*` | none | public site: config, demo requests, analytics events |
| `/webhooks/twilio/call-status` | Twilio signature | call status callbacks |

Non-API routes served by the same app: the portal (`/app`, `/`), the public pages, `robots.txt`,
`sitemap.xml`, `llms.txt`, and `/media/call-audio/<file>.mp3` (natural-voice audio Twilio fetches).

## Example

```bash
TOKEN=$(curl -s -X POST localhost:3000/api/auth/login -H 'Content-Type: application/json' \
  -d '{"phone":"573001234567","password":"..."}' | jq -r .token)

curl -s localhost:3000/api/library?kind=peliculas\&status=pending -H "Authorization: Bearer $TOKEN"

curl -s -X POST localhost:3000/api/library -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"kind":"peliculas","title":"Dune","creator":"Denis Villeneuve","url":"https://...","summary":"..."}'
# -> {"itemId":7,"listName":"Películas","created":true,"link":{"id":31,"categoryName":"Películas","reused":false}}

curl -s "localhost:3000/api/calendar?from=2026-10-19&to=2026-10-25" -H "Authorization: Bearer $TOKEN"
```
