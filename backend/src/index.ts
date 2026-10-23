import { wardrobeUpkeep } from './services/fashion/upkeep.js';
import { setWardrobeNotifier } from './services/fashion/review.js';
import { repairRoutines } from './services/routines/routine-repairs.service.js';
import { quietLibsignalLogs } from './shared/utils/quiet-libsignal.js';
import { acquireSingleInstanceLock } from './shared/utils/single-instance.js';
import { env } from './config/env.js';
import { assertDbConnection } from './database/connection.js';
import { initSchema } from './database/migrate.js';
import { registerTools } from './agent/tools/index.js';
import { BotManager } from './channels/whatsapp/bot-manager.js';
import { TaskScheduler, reconcileMissedReminders } from './jobs/task-scheduler.js';
import { createServer } from './api/server.js';
import { legacyAdminToken } from './api/middleware/auth.middleware.js';
import { usersModel } from './models/users.model.js';
import { ensureWeeklyReportReminder } from './services/agenda/weekly-report.service.js';
import { ensureDailyResetReminder } from './services/conversation/daily-reset.service.js';
import { ensureDailyDedupReminder, dedupeAllUsers } from './services/maintenance/dedup.service.js';
import { permissionsModel } from './models/permissions.model.js';
import { migrateLegacyAccess, grantLibraryToListUsers, grantMedicationsToReminderUsers, grantWorkoutsToRoutineUsers } from './services/permissions/permissions.service.js';
import { migrateExerciseRoutinesToWorkouts } from './services/workouts/workouts-migration.service.js';
import { migrateCategoryRemindersToMedications, migrateWaterReminders } from './services/medications/medications-migration.service.js';
import { installProcessGuards } from './shared/utils/process-guards.js';
import { setSchedulingNotifier } from './services/scheduling/scheduling.service.js';
import { expireDemos } from './services/growth/demo.service.js';

quietLibsignalLogs();
installProcessGuards();

async function main() {
  console.log('=== Canix · personal assistant on WhatsApp ===');

  // 0) Refuse to run twice against the same DB/session (see shared/utils/single-instance.ts) - a real
  // cause of duplicate reminder sends is two processes each running their own scheduler.
  acquireSingleInstanceLock();

  // 1) Database (SQLite: file + schema created on demand, no server needed)
  initSchema();
  assertDbConnection();
  console.log('[DB] Ready (%s).', env.db.path);

  // 1b) Access control: mirror the permissions catalog into the DB (FK target), seed the default
  // packages, and move anyone still on the old per-tool system onto packages - once, losslessly.
  permissionsModel.syncCatalog();
  migrateLegacyAccess();
  grantLibraryToListUsers();
  grantMedicationsToReminderUsers();
  migrateCategoryRemindersToMedications();
  migrateWaterReminders();
  grantWorkoutsToRoutineUsers();
  migrateExerciseRoutinesToWorkouts();
  const movedBillable = permissionsModel.moveBillableOutOfPackages();
  if (movedBillable) console.log('[ACCESS] Moved %d paid permission(s) from packages to direct grants (review them under Users).', movedBillable);

  // 2) Agent tools
  registerTools();

  // Backfill: users bootstrapped before these features existed never got their recurring reminder
  // created (that only happens at bootstrap/grant_access time) - this makes every upgrade pick it
  // up too. No-op for users that already have one. The daily agenda auto-push used to be backfilled
  // here too; it's been removed (proactive messaging is now limited to notifications the user
  // actually scheduled themselves - see the boot migration in database/migrate.ts).
  for (const user of usersModel.listAll()) {
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
  // reconcileMissedReminders()'s own comment in jobs/task-scheduler.ts. If the admin wants to
  // actually tell everyone the bot's back, that's their call to make (send_message/announce_update),
  // never automatic.
  reconcileMissedReminders();

  // Backfill: every user needs their own panel_token now that the web panel is per-client instead
  // of admin-only (see api/middleware/auth.middleware.ts). The admin's is seeded from the old single shared
  // file/env-based token so an existing bookmarked panel login keeps working after this upgrade;
  // everyone else gets a fresh random one. No-op for anyone who already has a token.
  for (const user of usersModel.listAll()) {
    if (user.panel_token) continue;
    if (user.role === 'admin') usersModel.setPanelToken(user.id, legacyAdminToken());
    else usersModel.ensurePanelToken(user.id);
  }

  // 3) WhatsApp: single dedicated session
  const bot = new BotManager();
  // Appointment notifications (web portal actions included) go out through this same session.
  setSchedulingNotifier(bot.session);
  await bot.start();

  // Routines left without notices get them back before the scheduler looks (see routine-repairs.service.ts).
  repairRoutines();

  // 4) Reminder scheduler
  const scheduler = new TaskScheduler(bot.session);
  scheduler.start();

  // Free demos from the landing page end on their own (see services/growth/demo.service.ts).
  const demoTimer = setInterval(() => {
    expireDemos(bot.session).catch((err) => console.error('[DEMO] Error expiring demos:', (err as Error).message));
  }, 5 * 60_000);
  demoTimer.unref();

  // Wardrobe upkeep (see services/fashion/upkeep.ts): colors read from the photos, exact duplicates removed -
  // a small batch now and every 20 minutes, in the background.
  setWardrobeNotifier(async (userId, text) => {
    const owner = usersModel.getById(userId);
    if (owner) await bot.session.sendText(owner.jid, text);
  });
  void wardrobeUpkeep();
  setInterval(() => void wardrobeUpkeep(), 20 * 60_000).unref();

  // 5) HTTP server + admin panel (each client logs in with their own token - see api/middleware/auth.middleware.ts)
  const app = createServer(bot);
  app.listen(env.port, () => {
    console.log('[API] Portal at http://localhost:%d', env.port);
    // Until the admin sets a portal password, the old admin token is the way in (see api/middleware/auth.middleware.ts).
    const admin = usersModel.getAdmin();
    if (admin && !admin.password_hash && admin.panel_token) {
      console.log('[AUTH] The administrator has no portal password yet. Sign in with this token: %s', admin.panel_token);
    }
  });
}

main().catch((err) => {
  console.error('Startup failed:', err);
  process.exit(1);
});
