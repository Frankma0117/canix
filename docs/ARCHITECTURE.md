# Architecture

Canix is one Node.js process (backend/) plus an optional Python process (vision-service/). The Node
process holds the WhatsApp session, runs the LLM agent, serves the REST API and the built web
assets, and runs the scheduler. All state is in one SQLite file.

```
                ┌──────────────────────── backend (Node 20, one process) ─────────────────────────┐
WhatsApp ◄────► │ channels/whatsapp/wa-manager ──► bot-manager (per-chat queue)                      │
                │                                   ├─ fixed commands (/menu, /reset, demo codes…)  │
                │                                   ├─ services/fashion  (state machine, reactions)  │
                │                                   ├─ agent/modes       (sections)                  │
                │                                   ├─ designed views    (no AI turn)                │
                │                                   └─ agent/agent ─► LLM ─► agent/tools/* ─┐        │
Browser ◄─────► │ api/server ─► middleware ─► api/routes/*.routes.ts ───────────────────────┤        │
                │ jobs/task-scheduler (every 30 s) ─────────────────────────────────────────┤        │
                │                                              services/* ─► models/* ─► SQLite      │
                └───────────────────────────────────────────────────────────────────────────────────┘
                     │ HTTP (localhost)                 │ HTTPS
              vision-service (CLIP)        LLM provider, Fish Audio, Twilio, DO Spaces, fal.ai
```

## Backend layers

| Layer | Folder | Responsibility | May import |
| --- | --- | --- | --- |
| Entities | `entities/` | The TypeScript shape of each persisted record (one file per aggregate). Types only. | nothing |
| Models | `models/` | Data access: SQL for one table group, always scoped by `user_id`. | entities, database |
| Services | `services/<domain>/` | Business rules: scheduling a routine, recommending an outfit, saving to the library, building the calendar… | models, entities, shared, other services |
| Agent | `agent/` | The LLM loop, system prompt, tools (thin adapters over services), WhatsApp views. | services, models |
| API | `api/` | HTTP: middleware (auth, security, limits) and `routes/<resource>.routes.ts` (thin adapters over services/models). | services, models |
| Channels | `channels/whatsapp/` | The WhatsApp session and the incoming-message pipeline. | agent, services |
| Jobs | `jobs/` | The scheduler loop. | services, models |
| Config / shared | `config/`, `shared/utils/` | Settings and pure helpers. | nothing app-specific |

Rule of thumb: **tools and routes stay thin**. If the same behavior is needed from WhatsApp and
from the portal, it lives in a service and both call it (e.g. `services/library/library.service.ts`
backs both `save_media` and `POST /api/library`).

`index.ts` boots in this order: database connection → schema migration (`database/migrate.ts`) →
permission catalog sync and one-time grant migrations → tool registry → scheduler → HTTP server →
WhatsApp connection. A lock file (`data/canix.lock`) refuses to start a second instance on the same
database.

## An incoming WhatsApp message

`wa-manager.ts` receives Baileys events, de-duplicates redeliveries, transcribes voice notes
(Vosk, local), learns `@lid` ↔ phone mappings, and hands a normalized message to `bot-manager.ts`.
Reactions arrive separately as `onReaction`.

`bot-manager.ts` runs **one turn at a time per chat** (a promise queue per jid; different chats run
concurrently) and tries, in order - the first that answers ends the turn:

1. **Identity and access** - resolve the person by jid/lid; unknown numbers get a generic reply;
   the first ever sender becomes the admin; demo codes activate demo accounts.
2. **Quick answers** - a bare number answering a numbered question, or "sí"/"no" quoted on a
   reminder (see *Quick answers* below).
3. **Admin-only** - sticker pack uploads and naming; test mode commands.
4. **Fixed commands** - `/menu`, `/ayuda`, `/reset…`, shared contact cards. No AI.
5. **Fashion Mode** (`services/fashion/fashion.router.ts`) - a state machine; only the outfit
   request parsing and recommendation may call a model, and only when the local reading isn't enough.
6. **Sections** (`agent/modes.ts`) - "rutinas", "notas"… show what can be done there.
7. **Designed answers without a model** - appointment commands, "mis links"/"mis listas"/"qué
   tengo hoy" render the view straight from the data (`agent/views.ts`, `services/agenda`).
8. **The agent** (`agent/agent.ts`) - everything else.

Replies go out with a short human-like delay (reading pause + typing time) and, when the person
sent a voice note, as a voice note (Piper locally, or Fish Audio for the paid voice).

## The agent

`agent/agent.ts` builds a system prompt (persona, rules, current date/time and the next 14 days
spelled out, the person's categories, pending tasks, today's routines, stickers, enabled sections),
sends the recent history (`AI_HISTORY_TURNS`, cleared every day at `DAILY_RESET_TIME`) and loops
over tool calls (OpenAI-compatible API; any provider with tool calling works).

- **Tools** live in `agent/tools/<domain>/*.tool.ts` and are registered in `agent/tools/index.ts`.
  Each is `{ name, description, parameters (JSON Schema), execute(args, ctx) }` and returns text for
  the model. The set offered each turn is filtered by the person's permissions
  (`services/permissions/catalog.ts` maps permission → tools).
- **Guards** in the loop catch the model claiming it did something without calling a tool, or
  answering about saved data without looking it up, and force a retry with `tool_choice=required`.
  A per-turn time budget and per-tool timeouts keep a turn from hanging.
- **Views** (`agent/views.ts`): every "show me my …" list has one designed WhatsApp layout. Tools
  return it and the model is told to pass it through unchanged; `preferDesigned()` replaces a
  reply where the model rewrote or invented list rows.

### Internal refs

People never see database ids. Views and tool results carry each item's id as an **internal ref**
`⟦12⟧` (`internalRef()` in `shared/utils/wa-format.ts`). The model sees them (so "borra la
segunda" resolves to the right row, also in later turns, since the history keeps them), and
`stripInternalRefs()` removes them - plus legacy `#12` / `(#12)` forms - from every outgoing
WhatsApp text, image caption and voice note, and from API error messages.

### Quick answers

WhatsApp normal numbers have no buttons, so closed questions are answered by **reaction** or by
**number** (`agent/choices.ts`): the model appends `[[opciones: A | B]]`, the system strips it and
shows 👍/👎 (yes/no) or numbered options; the message id is stored in `choice_prompts`, and a
reaction or number later is fed back into the pipeline as if typed. Reminder and routine notices
are confirmed the same way (👍 done / 👎 not done, `services/reminders/reminder-prompts.service.ts`).
Polls are not used anywhere.

## Fashion Mode

`services/fashion/` is self-contained:

- `fashion.router.ts` - entry words ("outfit", "armario"…), session timeout, dispatch by state
  (`fashion_sessions.state`).
- `flows/` - one file per screen: add garment (photo or PDF), wardrobe list, garment detail/edit,
  delete, outfit, saved outfits, profile photo.
- `vision/` - `http-vision.service.ts` (the local CLIP service) or `llm-vision.service.ts` (a vision
  LLM via fal.ai, which also leaves questions for the portal); `taxonomy.ts` is the closed
  vocabulary both must answer in.
- `outfit/` - the recommendation pipeline:
  1. `request.ts` reads the request locally (occasion, formality, weather, garments to include,
     garments or colors to avoid - "que no tenga camiseta blanca" becomes *no white top*);
     `intent.ts` calls a model only when words are left over.
  2. `candidate-filter.ts` filters and scores the wardrobe (hard excludes, fixed garments,
     excluded garments, worn-this-week), capped per role.
  3. `recommendation.service.ts` asks the model to pick among the candidates (optional), validates
     every id against the pool (`rules.ts`), enforces required garments, and remembers shown
     combinations so "otra opción" differs. `replaceGarment()` swaps one piece locally, no model.
  4. `edit-commands.ts` reads edits in words ("cambia la camiseta", "deja solo el pantalón").
- `flows/outfit.flow.ts` presents an outfit as **one photo per garment, then the summary**. Each
  sent message is stored in `fashion_message_refs` with the outfit it belongs to, and
  `fashion-reactions.ts` turns a reaction into an action (👎 swap · ❤️ keep only · 🗑️ delete ·
  👍 pin · on the summary 👍 save / 👎 another option / 👕 worn) - even after the session timed out.

## Media library

The special lists (kinds `peliculas`, `series`, `musica`, `libros`, `juegos`, `podcasts`) are the
library. Their items carry `creator`, `genre`, `year`, `summary`, `url`, `link_id`, `rating`,
`notes`, `done_at`. `services/library/library.service.ts` saves an item (de-duplicated by title
within the kind, into the named list or the kind's main list) and, when it comes with a URL, the
same link into the link library under the kind's category. Views show related notes (notes that
mention the title).

## Medications and meal notices

Both own their reminders instead of being reminders: `medications` rows (times JSON, weekdays,
start/end date, active) and `meal_plans.meal_time`/`prep_minutes`. `syncMedicationReminders()`
(`services/medications/`) and `syncMealReminders()` (`services/meals/meal-reminders.service.ts`)
delete and rebuild the owned rows - kind `medication` (one per time, `medication_id`) and kinds
`meal`/`meal_prep` (`meal_plan_id`) - on every create/edit/pause; ON DELETE CASCADE removes them
with their owner. The scheduler asks `nextMedicationRunAt()` for the next due day (weekdays and end
date), so a finished treatment just stops. Dose answers are `reminder_prompts` with
`medication_id` (reaction, chat `log_medication` or `POST /api/medications/:id/log`).
These kinds are not in `USER_REMINDER_KINDS`: they never show up as "reminders"; the agenda and
the calendar show them as doses and meals.

## Scheduler

`jobs/task-scheduler.ts` ticks every 30 s:

- due reminders (all kinds, including routine notices and silent maintenance rows such as the daily
  history reset, the duplicate cleanup and the weekly report), with recurrence, pauses,
  confirmation tracking (unanswered recurring notices suspend themselves) and the send governor;
- call reminders (Twilio) and appointment reminders/expiry.

On boot it reconciles what was missed while the process was down: recurring rows move to their
next occurrence silently, one-off rows are marked `missed` - never a burst of late messages.

`channels/whatsapp/send-guard.ts` caps proactive and cold sends per day (persisted, with a warm-up
ramp for new numbers) - see [OPERATIONS.md](OPERATIONS.md).

## Portal and public site

`api/server.ts` assembles Express: security headers, rate limit and timeout on `/api`, the Twilio
webhook (form-encoded, signature-checked), public routes (site, demo requests, analytics), static
files, then `resolvePanelUser` (Bearer session token) and every resource router. Each router gates
itself with `requirePermission(...)`; `/api/admin` and `/api/connection` need the administrator.

`frontend/` is a React SPA with a hash router (`App.tsx`, sections in `config/sections.tsx`) built
with atomic design:

| Level | Folder | Examples |
| --- | --- | --- |
| Atoms | `components/atoms/` | Button, Input, Badge, Card, StarRating, Sticker |
| Molecules | `components/molecules/` | Tabs, Notice, EmptyState, StatCard, `lists/ItemRow`, `wardrobe/FilterChip` |
| Organisms | `components/organisms/` | Modal, GroupedTable, `calendar/WeekCalendar`, `library/MediaItemForm`, `medications/MedicationForm`, `medications/MedicationCard`, `routines/RoutineCard`, `layout/Sidebar` |
| Templates | `components/templates/` | Page, AuthLayout |
| Pages | `pages/` | one per section; compose organisms, own data loading |

Supporting folders: `services/` (API client, auth context), `config/` (sections, kind labels),
`types/`, `utils/` (dates in the bot's time zone, text helpers), `hooks/`.

`frontend/landing/` is the public site: static HTML pages with shared partials, built by Vite into
`public/landing/` and served by `services/growth/site.service.ts` with server-side values (canonical
URLs, contact number, verification tags) filled in.

## External services

| Service | Used for | Required |
| --- | --- | --- |
| OpenAI-compatible LLM | the agent, outfit intent/picks | yes |
| Vosk + Piper (local) | voice-note transcription and voice replies | no |
| vision-service (local CLIP) / fal.ai vision LLM | garment classification | no (manual fallback) |
| DigitalOcean Spaces | garment photos | only for Fashion Mode |
| Twilio | phone-call reminders | only for calls |
| Fish Audio | natural voice (paid extra) | no |
