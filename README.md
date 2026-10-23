# Canix

Canix is a personal assistant that lives in WhatsApp. People talk to it in plain Spanish (text or
voice notes) and it keeps their reminders, routines, to-dos, notes, links, lists, media library,
meals, recipes, contacts and wardrobe - and books appointments for professionals. A web portal
shows and edits the same data, and a public site sells the product.

It is **multi-user and closed**: the administrator decides who gets access and to which features
(permission packages). Every person's data is fully separate.

```
WhatsApp ──► Baileys ──► bot-manager ──► fixed commands / Fashion Mode / sections ──► LLM agent + tools
                                                                                        │
Portal (React) ──► REST API (Express) ──────────────────────────► services ──► models ──► SQLite
Scheduler (every 30 s) ─► reminders, routines, calls, appointments ─┘
```

## Highlights

- **Reminders** of every kind (one-off, recurring, important dates, flexible windows, intervals,
  "sometime when I'm free"), confirmed with a 👍/👎 reaction - and **phone-call reminders** (Twilio).
- **Routines** with schedules, streaks, weekly progress and rewards/punishments.
- **Media library**: send a link and say "es una película sobre…" - it lands in the link library
  *and* in the movies list; ask "¿qué película puedo ver?" and Canix suggests from what you haven't
  seen, with its summary, link and related notes. Music, series, books, games and podcasts too.
- **Fashion Mode**: a wardrobe built from photos (local CLIP model or a vision LLM). Outfits arrive
  as one photo per garment; react 👎 to change just that piece, ❤️ to build another outfit around
  it, 🗑️ when it's no longer yours. "Un outfit con polo azul", "uno que no tenga camiseta blanca".
- **Scheduling** for professionals (psychologists, dentists…): availability, booking, confirmations.
- **Portal**: every module, plus an hour-by-hour **calendar** of the whole agenda.
- Ids are never shown to people: the assistant references items internally (see
  [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#internal-refs)).

## Quick start (development)

Requirements: Node.js 20+ (`better-sqlite3` is pinned to 12.x on purpose - see docs/DEVELOPMENT.md), Git. Optional: Python 3.11
for the vision service.

```bash
cp .env.example .env            # fill in AI_API_KEY at least
npm run install:all             # backend + frontend dependencies
npm run build                   # builds the portal and public site into /public
npm run dev                     # backend in watch mode (http://localhost:3000)
npm run dev:frontend            # optional: portal with hot reload (proxies /api to :3000)
```

On the first run a QR code appears in the console: scan it with the WhatsApp of the number the bot
will use (Linked devices). The first person to write to it becomes the administrator. Windows
helpers live in `scripts/windows/`.

> Use a **separate `WA_SESSION`** (and ideally a separate number) for local development. Two
> processes on the same WhatsApp session break each other - see
> [docs/OPERATIONS.md](docs/OPERATIONS.md).

## Repository layout

```
backend/          Node.js + TypeScript: WhatsApp channel, LLM agent, REST API, scheduler
  src/
    agent/        the LLM agent: loop, prompts, quick-answer choices, views, tools/<domain>/
    api/          Express server, middleware, routes/<resource>.routes.ts
    channels/     whatsapp/ (Baileys session, message pipeline, send governor)
    config/       env.ts (all settings), paths.ts (repo-rooted paths)
    database/     connection, schema/, migrations/, migrate.ts
    entities/     TypeScript shape of every persisted record
    jobs/         task-scheduler.ts (reminders, routines, calls, appointments)
    models/       data access, one file per table group
    services/     business logic by domain (fashion, library, calendar, routines, scheduling…)
    shared/utils/ dates, WhatsApp formatting, jids, icons…
frontend/         React 19 + Vite + Tailwind 4, atomic design
  src/components/ atoms/ molecules/ organisms/ templates/
  src/pages/      one page per portal section
  landing/        the public sales site (multi-page, static HTML)
vision-service/   Python microservice: CLIP garment classification and PDF image extraction
deploy/           server setup scripts and systemd units (used by deploy.sh)
docs/             developer documentation and the API reference (docs/api/openapi.yaml)
scripts/windows/  .cmd helpers for local development on Windows
```

Runtime folders (never versioned): `data/` (SQLite, uploads), `auth_info/` (WhatsApp session),
`models/` and `bin/` (speech models), `public/` (built web assets).

## Documentation

| Document | What's in it |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How a message flows, the layers, the agent, the scheduler, the portal |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | Setup, commands, conventions, how to add a tool / permission / route / page |
| [docs/FEATURES.md](docs/FEATURES.md) | Every feature as the person uses it (WhatsApp and portal) |
| [docs/API.md](docs/API.md) + [docs/api/openapi.yaml](docs/api/openapi.yaml) | REST API conventions and the full reference |
| [docs/DATABASE.md](docs/DATABASE.md) | Tables, scoping rules and how migrations work |
| [docs/SECURITY.md](docs/SECURITY.md) | Auth, sessions, data isolation, secrets, abuse limits |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Server setup, `deploy.sh`, nginx/HTTPS, audio, vision |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | Keeping the WhatsApp number healthy, reconnecting, troubleshooting |
| [docs/VISION_SERVICE.md](docs/VISION_SERVICE.md) | The Python vision microservice |
| [docs/SEO.md](docs/SEO.md) | Off-site checklist for the public site |
