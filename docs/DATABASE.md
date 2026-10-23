# Database

One SQLite file (`DB_PATH`, default `data/app.db`) through `better-sqlite3` (synchronous, WAL mode,
foreign keys on - see `backend/src/database/connection.ts`).

## Rules

- Every per-person table has `user_id REFERENCES users(id) ON DELETE CASCADE`; models always filter
  by it. `habit_logs` has no `user_id`: it is reached only through its routine (`todo_id`), whose
  ownership is checked first.
- Relationships are real foreign keys with `CASCADE` / `SET NULL`; closed value sets use `CHECK`
  where the table was created with one; multi-row changes go through `db.transaction()`.
- Times are local wall-clock text `'YYYY-MM-DD HH:mm:ss'` (see `TIMEZONE`); `created_at` defaults
  use SQLite's `datetime('now')` (UTC) and are only used for ordering.
- Some enum values are Spanish (`meal_slot`, list `kind`, garment taxonomy, section keys): they are
  stored data and stay as they are.

## Tables by area

| Area | Tables |
| --- | --- |
| People and access | `users`, `permissions`, `permission_packages`, `package_permissions`, `user_packages`, `user_permissions`, `access_audit`, `web_sessions`, `app_meta` |
| Conversation | `messages` (history sent to the model), `choice_prompts` (quick answers waiting for a reaction/number) |
| Reminders | `reminders` (all kinds, incl. routine notices, medication/meal notices owned via `medication_id`/`meal_plan_id`, and silent maintenance rows), `reminder_prompts` + `reminder_responses` ("¿lo hiciste?" and dose answers), `call_reminders` |
| Medicamentos y belleza | `medications` (times JSON, weekdays CSV, start/end date, active) |
| Routines and to-dos | `todos` (scope `today`/`later`/`routine`), `habit_logs`, `exercises`, `rewards_punishments` |
| Information | `categories` (shared), `links`, `notes`, `contacts`, `checklists` + `checklist_items` (lists; media kinds are the library), `meal_plans` (with optional `meal_time`, `prep_minutes`), `recipes` |
| Fashion Mode | `garments`, `garment_questions`, `outfits`, `outfit_garments`, `fashion_profiles`, `fashion_sessions`, `fashion_message_refs` (reactable messages) |
| Scheduling | `sched_professionals`, `sched_availability`, `sched_time_off`, `sched_groups`, `sched_group_members`, `sched_client_access`, `sched_appointments`, `sched_appointment_events`, `sched_reminders`, `uploaded_files` |
| WhatsApp | `wa_send_log` (send governor), `wa_session_meta` (warm-up start) |
| Usage | `ai_usage` (tokens, voice characters, calls per person) |
| Public site | `demo_requests`, `web_events` |
| Stickers | `stickers` (global pack, uploaded by the admin) |

## Schema and migrations

`database/migrate.ts` runs on every boot (and standalone with `npm run db:migrate`):

1. `schema/core.schema.ts` - `createCoreTables()`: the **current** core schema, what a brand-new
   database gets (`CREATE TABLE IF NOT EXISTS`).
2. `migrations/core-upgrades.ts` - brings databases created by older releases up to date: missing
   columns (`addMissingColumns`), table rebuilds where a `CHECK` changed, data backfills, and drops
   of retired tables. Every step checks before it changes anything.
3. `createCoreIndexes()` - after the upgrades, because some indexes cover upgraded columns.
4. `schema/access.schema.ts`, `schema/scheduling.schema.ts`, `schema/growth.schema.ts` - the
   modules that reference `users`.

There is no version table: idempotent steps are simpler and safe for a single-file database that
is always migrated by the same process that uses it. Databases from before multi-user support
(July 2026, with an `owner` table) are no longer upgraded; run an older release on them first.

### Checking a migration

Copy a real database, migrate it and a fresh one, and compare their columns and indexes:

```bash
cp data/local-test.db data/smoke.db && rm -f data/fresh.db
cd backend && DB_PATH=data/smoke.db npm run db:migrate && DB_PATH=data/fresh.db npm run db:migrate
```

```python
import sqlite3
def schema(p):
    c = sqlite3.connect(p)
    tables = [r[0] for r in c.execute("select name from sqlite_master where type='table' and name not like 'sqlite_%'")]
    return {t: sorted(r[1] for r in c.execute(f'pragma table_info({t})')) for t in tables}
a, b = schema('data/smoke.db'), schema('data/fresh.db')
print({t for t in a.keys() | b.keys() if a.get(t) != b.get(t)} or 'identical')
```

## Backups

`data/` (database, uploads, site state) and `auth_info/` (WhatsApp session) are the only state.
Back up both; copy the database with SQLite's online backup (`sqlite3 data/app.db ".backup x.db"`)
or while the bot is stopped - copying a WAL database mid-write can lose the last transactions.
