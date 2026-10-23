import { db } from '../../database/connection.js';
import { permissionsModel } from '../../models/permissions.model.js';
import { medicationsModel } from '../../models/medications.model.js';
import { remindersModel } from '../../models/reminders.model.js';
import { createMedication, timesOf, updateMedication } from './medications.service.js';
import { normalizeTimes } from '../../shared/utils/clock-times.js';
import { stripKnownPrefix } from '../../shared/utils/motivational.js';
import { parseWall, todayLocal } from '../../shared/utils/datetime.js';
import type { MedicationKind } from '../../entities/index.js';

const FLAG = 'medications_from_category_v1';
const CATEGORY = 'medicamentos y belleza';

function kindFor(text: string): MedicationKind {
  const t = text.toLowerCase();
  if (/\bagua\b|hidrat/.test(t)) return 'water';
  if (/\bfaja\b|corset|cors[eé]|medias de compresi|retenedor|plantillas|venda/.test(t)) return 'bodycare';
  if (/vitamin/.test(t)) return 'vitamin';
  if (/suplement|proteina|creatina|omega|colageno|colágeno/.test(t)) return 'supplement';
  if (/crema|bloqueador|protector|loci[oó]n/.test(t)) return 'cream';
  if (/skin|serum|sérum|mascarilla|t[oó]nico|limpiador|contorno|retinol|facial/.test(t)) return 'skincare';
  return 'medicine';
}

/**
 * Before the Medicamentos y belleza module, those were plain reminders in a category of that name.
 * Runs once: each pending one becomes a medication with its time (and weekday for weekly ones), and
 * the reminder itself is kept as the medication's notice - nothing is sent twice or lost.
 */
export function migrateCategoryRemindersToMedications(): void {
  if (permissionsModel.getMeta(FLAG)) return;
  const rows = db
    .prepare(
      `SELECT r.* FROM reminders r JOIN categories c ON c.id = r.category_id
       WHERE lower(c.name) = ? AND r.status = 'pending' AND r.kind IN ('reminder', 'flexible')`,
    )
    .all(CATEGORY) as { id: number; user_id: number; message: string; run_at: string; recurrence_freq: string }[];
  let moved = 0;
  db.transaction(() => {
    for (const r of rows) {
      const name = stripKnownPrefix(r.message).replace(/^(tomar|toma|tomarme|aplicar|aplicarme|ponerme|ponte|hora de tomar( tu)?|hora de)\s+/i, '').trim() || r.message;
      // water is merged into a single 💧 Agua by migrateWaterReminders() below
      if (kindFor(name) === 'water') continue;
      const time = r.run_at.slice(11, 16);
      const weekly = r.recurrence_freq === 'weekly' ? [parseWall(r.run_at).getUTCDay()] : null;
      const id = medicationsModel.create(r.user_id, {
        name: name.charAt(0).toUpperCase() + name.slice(1),
        kind: kindFor(name),
        times: [time],
        weekdays: weekly,
        startDate: r.run_at.slice(0, 10),
        // a one-off reminder was a single dose: it ends that day
        endDate: r.recurrence_freq === 'none' ? r.run_at.slice(0, 10) : null,
      });
      db.prepare("UPDATE reminders SET kind = 'medication', medication_id = ?, recurrence_freq = 'daily', recurrence_interval = 1 WHERE id = ?").run(id, r.id);
      moved++;
    }
    permissionsModel.setMeta(FLAG, new Date().toISOString());
  })();
  if (moved) console.log('[MEDICATIONS] %d reminder(s) of the "Medicamentos y belleza" category moved to the new module.', moved);
}

const WATER_FLAG = 'water_reminders_to_medications_v1';
const WATER_RE = /\bagua\b|hidrat/i;

/**
 * "Tomar agua" used to be ordinary daily reminders. Runs once: every pending daily reminder about
 * water becomes one notice time of the person's 💧 Agua (created if missing), and the old reminder
 * is removed - same hours, now with the day's glass count. Short interval series and one-off
 * reminders are left alone (they end on their own).
 */
export function migrateWaterReminders(): void {
  if (permissionsModel.getMeta(WATER_FLAG)) return;
  const rows = db
    .prepare(
      `SELECT id, user_id, message, run_at FROM reminders
       WHERE status = 'pending' AND kind IN ('reminder', 'flexible') AND medication_id IS NULL
         AND recurrence_freq = 'daily' AND recurrence_interval = 1`,
    )
    .all() as { id: number; user_id: number; message: string; run_at: string }[];
  const byUser = new Map<number, { ids: number[]; times: string[] }>();
  for (const r of rows.filter((r) => WATER_RE.test(r.message))) {
    const entry = byUser.get(r.user_id) ?? { ids: [], times: [] };
    entry.ids.push(r.id);
    entry.times.push(r.run_at.slice(11, 16));
    byUser.set(r.user_id, entry);
  }
  db.transaction(() => {
    for (const [userId, { ids, times }] of byUser) {
      const existing = medicationsModel.list(userId, { includeInactive: true }).find((m) => m.kind === 'water');
      if (existing) updateMedication(userId, existing.id, { times: normalizeTimes([...timesOf(existing), ...times]) });
      else createMedication(userId, { name: 'Agua', kind: 'water', times: normalizeTimes(times), dose: '1 vaso', startDate: todayLocal() });
      for (const id of ids) remindersModel.remove(userId, id);
    }
    permissionsModel.setMeta(WATER_FLAG, new Date().toISOString());
  })();
  if (byUser.size) console.log('[MEDICATIONS] water reminders of %d person(s) moved to 💧 Agua.', byUser.size);
}
