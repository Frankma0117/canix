# Development guide

## Setup

| Need | Version | Notes |
| --- | --- | --- |
| Node.js | 20.x (20.18+) | Baileys' preinstall refuses older. `better-sqlite3` is pinned to **12.11.1** on purpose: 13.x needs Node 22 and its native binding segfaults on 20. Don't bump one without the other. |
| Python | 3.11+ | Only for `vision-service/`. |
| ffmpeg | bundled | `ffmpeg-static` ships it. |

```bash
cp .env.example .env        # AI_API_KEY, AI_PROVIDER, AI_MODEL, AI_BASE_URL at least
npm run install:all         # npm ci in backend/ and frontend/
npm run build               # portal + public site -> /public (the backend serves it)
npm run dev                 # backend with reload on save
npm run dev:frontend        # Vite dev server on :5173, proxies /api to :3000
```

On Windows, `scripts/windows/*.cmd` do the same with the Node 20 install in
`C:\Users\Asus\node20` prepended to PATH (the machine's default node is older).

**Local WhatsApp safety.** Set `WA_SESSION` to something other than production's
(`local-test`, for example) and use `DB_PATH=./data/local-test.db`. Never point a local process at
the production session folder - two sockets on one WhatsApp session get the number flagged.

## Commands

All from the repo root (each delegates to the right package):

| Command | What it does |
| --- | --- |
| `npm run dev` / `npm start` | Backend in watch mode / normal mode |
| `npm run dev:frontend` | Portal with hot reload |
| `npm run build` | Build the portal and the public site into `public/` |
| `npm run db:migrate` | Create/upgrade the schema (also runs on every boot) |
| `npm run typecheck` | `tsc` on backend and frontend |
| `npm run deadcode` | knip: unused files, exports and dependencies |
| `npm run docs:api` | Regenerate `docs/api/openapi.yaml` from `docs/api/build-openapi.py` |

In `backend/`: `npm run stickers:audit [-- --export | --fix]` checks the sticker pack.

## Conventions

- **Code is English**: identifiers, file names, comments, log messages, docs. **What people read
  is Spanish**: bot replies, portal copy, API error messages, and the LLM prompts and tool
  descriptions (they are product copy addressed to a Spanish-speaking assistant). Stored enum
  values that are already in the database stay as they are (`desayuno`, `peliculas`, `camiseta`,
  section keys like `rutinas`) - they are data, not code.
- TypeScript `strict`, plus `noUnusedLocals` / `noUnusedParameters`: dead code doesn't compile.
- ESM everywhere; relative imports end in `.js` in the backend and `.ts`/`.tsx` in the frontend.
- File naming: `*.model.ts` (data access), `*.service.ts` (business logic), `*.tool.ts` (agent
  tools), `*.routes.ts` (HTTP), `*.entity.ts` (record types), `*.flow.ts` (Fashion Mode screens),
  `*.schema.ts` (DDL). React components are `PascalCase.tsx`.
- Comments explain *why* (the constraint, the incident that motivated it), not what the next line
  does. Keep them current when you change behavior.
- Times are **local wall-clock strings** `'YYYY-MM-DD HH:mm:ss'` in `TIMEZONE` - use
  `shared/utils/datetime.ts` (backend) and `utils/dates.ts` (frontend); never the system clock's zone.
- Every per-person query is scoped by `user_id` in the model. Never trust an id from the client
  or the model without the scoped lookup.
- Never show database ids to people: use `internalRef(id)` in model-facing text
  (see [ARCHITECTURE.md](ARCHITECTURE.md#internal-refs)).
- Closed questions are answered by reaction (👍/👎) or number - never WhatsApp polls.

## Recipes

### Add an agent tool

1. Create `backend/src/agent/tools/<domain>/<verb>-<thing>.tool.ts`:

   ```ts
   import type { Tool } from '../../tool-registry.js';
   import { resolveActingUser } from '../shared/act-on-behalf.js';

   export const archiveNoteTool: Tool = {
     name: 'archive_note',
     description: 'Archiva una nota... (Spanish: it is read by the model)',
     parameters: { type: 'object', properties: { note: { type: 'string' } }, required: ['note'], additionalProperties: false },
     async execute(args, ctx) {
       const acting = resolveActingUser(ctx, args.target_user ? String(args.target_user) : undefined);
       if ('error' in acting) return acting.error;
       // call a service; return text for the model (use internalRef(id) for ids)
       return 'Listo, ...';
     },
   };
   ```

2. Register it in `agent/tools/index.ts`.
3. Add the tool name to the permission that owns it in `services/permissions/catalog.ts` -
   a tool in no permission is only available to the administrator.
4. If people should learn about it, update the section help in `agent/menu.ts` and, when the
   model needs guidance on *when* to use it, the system prompt in `agent/agent.ts`.

### Add a feature with its own permission

1. Add the permission to `PERMISSIONS` in `catalog.ts` (`key`, `module`, `label`, `description`,
   `tools`; `billable: true` for anything that costs money per use - those never go in packages).
2. Add it to the default packages that should include it (`PERSONAL` / `DEFAULT_PACKAGES`). Existing
   packages are never overwritten; if current users must keep access, add a one-time grant like
   `grantLibraryToListUsers()` in `permissions.service.ts` (called from `index.ts`).
3. Gate the HTTP routes with `app.use('/api/<prefix>', requirePermission('<key>'))` and the
   portal section with `perms: ['<key>']` in `frontend/src/config/sections.tsx`.

### Add a table or a column

- New table: add `CREATE TABLE IF NOT EXISTS` to the right file in `database/schema/` (core tables
  in `core.schema.ts`, indexes in `createCoreIndexes`).
- New column on an existing table: add it to the `CREATE TABLE` **and** to `addMissingColumns()` in
  `database/migrations/core-upgrades.ts` (older databases get it from there). Data fixes and table
  rebuilds go in the same file; every step must be idempotent - it runs on every boot.
- Add the field to the entity in `entities/` and the queries in the model.
- Check fresh and upgraded databases end up identical (see [DATABASE.md](DATABASE.md#checking-a-migration)).

### Add an API route

1. Put it in `api/routes/<resource>.routes.ts` (create the file and register it in `api/server.ts`
   if it's a new resource). Wrap handlers with `h()` (errors become 4xx/500 JSON), read input with
   `str()` / `int()`, scope with `userId(req)`.
2. Add the endpoint to `docs/api/build-openapi.py` and run `npm run docs:api`.

### Add a portal page

1. Page in `frontend/src/pages/<Name>Page.tsx` using `Page` (template) and existing organisms.
   Reusable pieces go to `components/<level>/<feature>/`: atoms are single elements, molecules
   small groups without data loading, organisms self-contained blocks (forms, tables, calendars).
2. Register the section in `config/sections.tsx` (label, group, icon, permission, render).
3. API types go to `types/index.ts`; call the API with `useApi()`.

### Fashion Mode reactions

New outfit actions go in `services/fashion/flows/outfit.flow.ts` (exported, returning a
`FashionRouterResult`) and are mapped to an emoji in `services/fashion/fashion-reactions.ts`. A
message that should be reactable must be saved with `fashionMessageRefsModel.save(...)` when sent.

## Testing

There is no automated test suite yet. Changes are verified with:

- `npm run typecheck` and `npm run deadcode`;
- throwaway smoke scripts run with `tsx` against a **copy** of the database
  (`cp data/local-test.db data/smoke.db` then `DB_PATH=data/smoke.db npx tsx smoke.ts` inside
  `backend/`; set `DB_PATH` on the command line - ESM imports open the database at import time);
- a boot test: `DB_PATH=data/smoke.db WA_SESSION=smoke PORT=3917 npm start` (an unused session only
  shows a QR, it never connects), then `curl` the API with a session created in a smoke script.

Delete smoke files and the copied database afterwards.
