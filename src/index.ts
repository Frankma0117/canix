import { quietLibsignalLogs } from './util/quiet-libsignal.js';
import { acquireSingleInstanceLock } from './util/single-instance.js';
import { env } from './config/env.js';
import { assertDbConnection } from './db/pool.js';
import { initSchema } from './db/init.js';
import { registerTools } from './agent/tools/index.js';
import { BotManager } from './whatsapp/bot-manager.js';
import { TaskScheduler, reconcileMissedReminders } from './scheduler/task-scheduler.js';
import { createServer } from './server/http-server.js';
import { legacyAdminToken } from './server/auth.js';
import { usersRepo } from './db/repositories/users.repo.js';
import { ensureWeeklyReportReminder } from './agent/weekly-report.js';
import { ensureDailyResetReminder } from './agent/daily-reset.js';
import { ensureDailyDedupReminder, dedupeAllUsers } from './agent/dedup.js';

quietLibsignalLogs();

async function main() {
  console.log('=== Canix · asistente personal por WhatsApp ===');

  // 0) Refuse to run twice against the same DB/session (see util/single-instance.ts) - a real
  // cause of duplicate reminder sends is two processes each running their own scheduler.
  acquireSingleInstanceLock();

  // 1) Database (SQLite: file + schema created on demand, no server needed)
  initSchema();
  assertDbConnection();
  console.log('[DB] Listo (%s).', env.db.path);

  // 2) Agent tools
  registerTools();

  // Backfill: users bootstrapped before these features existed never got their recurring reminder
  // created (that only happens at bootstrap/grant_access time) - this makes every upgrade pick it
  // up too. No-op for users that already have one. The daily agenda auto-push used to be backfilled
  // here too; it's been removed (proactive messaging is now limited to notifications the user
  // actually scheduled themselves - see the boot migration in db/init.ts).
  for (const user of usersRepo.listAll()) {
    ensureWeeklyReportReminder(user.id, user.jid);
    ensureDailyResetReminder(user.id, user.jid);
    ensureDailyDedupReminder(user.id, user.jid);
  }

  // Clean up duplicates for EVERY user on every boot (not just whenever each person's own daily
  // 4am timer happens to fire) - so a deploy/restart always leaves everyone's data clean right
  // away, per the user's own "limpia toda la data cada que actualizo en todos los clientes" ask.
  // Runs before the WhatsApp session connects below, so nothing new can come in and create a fresh
  // duplicate mid-sweep.
  await dedupeAllUsers();

  // Anything left 'pending' with run_at already in the past at this exact instant was due at some
  // point while the process wasn't running (crash/deploy/manual restart) - reconcile it silently
  // (recurring ones fast-forwarded to their next real occurrence, one-offs marked 'missed') instead
  // of letting the first tick below dump the whole backlog the moment WhatsApp reconnects. See
  // reconcileMissedReminders()'s own comment in scheduler/task-scheduler.ts. If the admin wants to
  // actually tell everyone the bot's back, that's their call to make (send_message/announce_update),
  // never automatic.
  reconcileMissedReminders();

  // Backfill: every user needs their own panel_token now that the web panel is per-client instead
  // of admin-only (see server/auth.ts). The admin's is seeded from the old single shared
  // file/env-based token so an existing bookmarked panel login keeps working after this upgrade;
  // everyone else gets a fresh random one. No-op for anyone who already has a token.
  for (const user of usersRepo.listAll()) {
    if (user.panel_token) continue;
    if (user.role === 'admin') usersRepo.setPanelToken(user.id, legacyAdminToken());
    else usersRepo.ensurePanelToken(user.id);
  }

  // 3) WhatsApp: single dedicated session
  const bot = new BotManager();
  await bot.start();

  // 4) Reminder scheduler
  const scheduler = new TaskScheduler(bot.session);
  scheduler.start();

  // 5) HTTP server + admin panel (each client logs in with their own token - see server/auth.ts)
  const app = createServer(bot);
  app.listen(env.port, () => {
    console.log('[API] Panel en http://localhost:%d', env.port);
    const admin = usersRepo.getAdmin();
    if (admin?.panel_token) console.log('[AUTH] Token de acceso del administrador: %s', admin.panel_token);
  });
}

main().catch((err) => {
  console.error('Fallo al iniciar:', err);
  process.exit(1);
});
