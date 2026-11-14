/**
 * Captures real screenshots of the portal for the promo videos (frontend/public/promo/screens/*.jpg).
 * Runs the real API + the built portal (/public) against a TEMPORARY database with a demo account
 * full of example data - never touches data/app.db. Usage (from backend/): npx tsx scripts/promo-screens.ts
 * Needs the portal built (npm run build) and Playwright's browser (PROMO_BROWSER=msedge on Windows).
 */
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'canix-screens-'));
process.env.DB_PATH = join(tmp, 'demo.db');
process.env.PORT = '0';
const OUT = resolve(import.meta.dirname, '..', '..', 'frontend', 'public', 'promo', 'screens');
mkdirSync(OUT, { recursive: true });

const { initSchema } = await import('../src/database/migrate.js');
const { permissionsModel } = await import('../src/models/permissions.model.js');
const { usersModel } = await import('../src/models/users.model.js');
const { categoriesModel } = await import('../src/models/categories.model.js');
const { remindersModel } = await import('../src/models/reminders.model.js');
const { todosModel } = await import('../src/models/todos.model.js');
const { notesModel } = await import('../src/models/notes.model.js');
const { recipesModel } = await import('../src/models/recipes.model.js');
const { setPassword } = await import('../src/services/auth/web-auth.service.js');
const { nowLocal, addDays } = await import('../src/shared/utils/datetime.js');
const { db } = await import('../src/database/connection.js');
const { createServer } = await import('../src/api/server.js');

initSchema();
permissionsModel.syncCatalog();

const user = usersModel.create({ jid: '573001234567@s.whatsapp.net', name: 'Laura Gómez' });
const full = db.prepare(`SELECT id FROM permission_packages WHERE name = 'Asistente completo'`).get() as { id: number } | undefined;
if (full) permissionsModel.addPackageToUser(null, user.id, full.id);
const PASSWORD = 'Demo-Canix-2026!';
await setPassword(user.id, PASSWORD, { mustChange: false, actorId: null });

// ---- example data ----
const today = nowLocal().slice(0, 10);
const at = (days: number, hm: string) => `${addDays(`${today} 12:00`, days).slice(0, 10)} ${hm}`;
const work = categoriesModel.create(user.id, 'Trabajo');
const home = categoriesModel.create(user.id, 'Casa');
const health = categoriesModel.create(user.id, 'Salud');
const rem = (message: string, runAt: string, categoryId: number | null, freq: 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly' = 'none') =>
  remindersModel.create(user.id, { message, runAt, targetJid: null, categoryId, recurrenceFreq: freq, recurrenceInterval: 1 });
rem('Pagar el arriendo', at(2, '09:00'), home, 'monthly');
rem('Reunión con el equipo', at(0, '15:30'), work);
rem('Llamar a mamá', at(0, '19:00'), home, 'weekly');
rem('Tomar la vitamina D', at(1, '08:00'), health, 'daily');
rem('Cumpleaños de Ana 🎂', at(5, '08:00'), null, 'yearly');
rem('Enviar la factura al cliente', at(1, '11:00'), work);
const todo = (title: string, due: string | null, categoryId: number | null) =>
  todosModel.create(user.id, { title, categoryId, scope: 'task', dueDate: due, recurrenceFreq: null });
todo('Comprar mercado de la semana', at(1, '00:00').slice(0, 10), home);
todo('Preparar la presentación', at(2, '00:00').slice(0, 10), work);
todo('Agendar cita con el odontólogo', null, health);
todo('Renovar el seguro del carro', at(6, '00:00').slice(0, 10), null);
for (const [title, time, minutes, freq] of [['Meditar', '06:30', 10, 'daily'], ['Ejercicio', '07:00', 45, 'daily'], ['Leer', '21:30', 20, 'daily']] as const) {
  todosModel.create(user.id, { title, categoryId: health, scope: 'routine', dueDate: null, recurrenceFreq: freq, reminderTime: time, durationMinutes: minutes, startDate: today });
}
notesModel.create(user.id, { title: 'Ideas para el viaje', content: 'Reservar hotel cerca de la playa. Llevar el cargador y los documentos. Preguntar por tours.', categoryId: null });
notesModel.create(user.id, { title: 'Lista del mercado', content: 'Arroz, pollo, tomate, cebolla, huevos, leche, café.', categoryId: home });
recipesModel.create(user.id, { title: 'Arroz con pollo', ingredients: '2 tazas de arroz\n500 g de pollo\n1 cebolla\n2 tomates', instructions: 'Sofríe la cebolla y el tomate, agrega el pollo, el arroz y el agua; cocina 20 minutos.', categoryId: home });

// ---- server on a free port (the bot is not needed to serve the portal) ----
const app = createServer({} as never);
const server = await new Promise<import('node:http').Server>((ok) => { const s = app.listen(0, '127.0.0.1', () => ok(s)); });
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

const login = (await (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: '573001234567', password: PASSWORD }) })).json()) as { token?: string };
if (!login.token) throw new Error('No se pudo iniciar sesión con la cuenta demo');

const SECTIONS = ['home', 'calendar', 'today', 'reminders', 'routines', 'lists', 'notes', 'recipes', 'meals', 'library', 'categories', 'contacts', 'agenda', 'account'];
const { chromium } = await import('playwright');
const browser = await chromium.launch({ channel: process.env.PROMO_BROWSER || undefined });
try {
  for (const [name, vp] of [['', { width: 1440, height: 900 }], ['m-', { width: 390, height: 844 }]] as const) {
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1.5, locale: 'es-CO', timezoneId: 'America/Bogota', colorScheme: 'light' });
    await ctx.addInitScript((t) => sessionStorage.setItem('canix_session', t), login.token);
    const page = await ctx.newPage();
    for (const id of SECTIONS) {
      await page.goto(`${base}/#/${id}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(900);
      await page.screenshot({ path: join(OUT, `${name}${id}.jpg`), type: 'jpeg', quality: 88 });
      console.log('captura', `${name}${id}`);
    }
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* Windows keeps the temp DB open until the process exits; the OS temp folder cleans it */
  }
}
process.exit(0);
