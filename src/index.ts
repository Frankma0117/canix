import { env } from './config/env.js';
import { assertDbConnection } from './db/pool.js';
import { initSchema } from './db/init.js';
import { registerTools } from './agent/tools/index.js';
import { BotManager } from './whatsapp/bot-manager.js';
import { TaskScheduler } from './scheduler/task-scheduler.js';
import { createServer } from './server/http-server.js';
import { getAdminToken } from './server/auth.js';

async function main() {
  console.log('=== canix · asistente personal por WhatsApp ===');

  // 1) Database (SQLite: file + schema created on demand, no server needed)
  initSchema();
  assertDbConnection();
  console.log('[DB] Listo (%s).', env.db.path);

  // 2) Agent tools
  registerTools();

  // 3) WhatsApp: single dedicated session
  const bot = new BotManager();
  await bot.start();

  // 4) Reminder scheduler
  const scheduler = new TaskScheduler(bot.session);
  scheduler.start();

  // 5) HTTP server + admin panel
  const app = createServer(bot);
  app.listen(env.port, () => {
    console.log('[API] Panel admin en http://localhost:%d', env.port);
    console.log('[AUTH] Token de acceso al panel: %s', getAdminToken());
  });
}

main().catch((err) => {
  console.error('Fallo al iniciar:', err);
  process.exit(1);
});
