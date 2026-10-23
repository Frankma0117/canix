import { db } from '../database/connection.js';
import type { Medication, MedicationKind } from '../entities/index.js';

export interface MedicationFields {
  name?: string;
  kind?: MedicationKind;
  dose?: string | null;
  instructions?: string | null;
  times?: string[];
  weekdays?: number[] | null;
  startDate?: string | null;
  endDate?: string | null;
  notes?: string | null;
  active?: boolean;
}

const COLUMNS: [keyof MedicationFields, string, (v: never) => unknown][] = [
  ['name', 'name', (v) => v],
  ['kind', 'kind', (v) => v],
  ['dose', 'dose', (v) => v],
  ['instructions', 'instructions', (v) => v],
  ['times', 'times', (v: string[]) => JSON.stringify(v)],
  ['weekdays', 'weekdays', (v: number[] | null) => (v && v.length && v.length < 7 ? v.join(',') : null)],
  ['startDate', 'start_date', (v) => v],
  ['endDate', 'end_date', (v) => v],
  ['notes', 'notes', (v) => v],
  ['active', 'active', (v: boolean) => (v ? 1 : 0)],
];

export const medicationsModel = {
  list(userId: number, opts: { includeInactive?: boolean } = {}): Medication[] {
    return db
      .prepare(`SELECT * FROM medications WHERE user_id = ? ${opts.includeInactive ? '' : 'AND active = 1'} ORDER BY active DESC, name`)
      .all(userId) as Medication[];
  },

  getById(userId: number, id: number): Medication | undefined {
    return db.prepare('SELECT * FROM medications WHERE id = ? AND user_id = ?').get(id, userId) as Medication | undefined;
  },

  /** By id with no owner check - only for the scheduler, which already holds the owning reminder. */
  getByIdUnscoped(id: number): Medication | undefined {
    return db.prepare('SELECT * FROM medications WHERE id = ?').get(id) as Medication | undefined;
  },

  /** Case-insensitive name lookup (contains). */
  findByName(userId: number, query: string): Medication[] {
    return db.prepare('SELECT * FROM medications WHERE user_id = ? AND name LIKE ? COLLATE NOCASE ORDER BY active DESC, name').all(userId, `%${query}%`) as Medication[];
  },

  create(userId: number, fields: MedicationFields & { name: string; times: string[] }): number {
    const info = db.prepare("INSERT INTO medications (user_id, name, times) VALUES (?, ?, '[]')").run(userId, fields.name);
    const id = Number(info.lastInsertRowid);
    this.update(userId, id, fields);
    return id;
  },

  /** Only the fields given change. */
  update(userId: number, id: number, fields: MedicationFields): void {
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const [key, column, convert] of COLUMNS) {
      if (fields[key] === undefined) continue;
      sets.push(`${column} = ?`);
      values.push(convert(fields[key] as never));
    }
    if (!sets.length) return;
    db.prepare(`UPDATE medications SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ? AND user_id = ?`).run(...values, id, userId);
  },

  /** Its reminders and dose history go with it (ON DELETE CASCADE). */
  remove(userId: number, id: number): void {
    db.prepare('DELETE FROM medications WHERE id = ? AND user_id = ?').run(id, userId);
  },
};
