import { db } from '../pool.js';
import type { Checklist, ChecklistItem } from '../../types/index.js';

export const checklistsRepo = {
  list(userId: number): Checklist[] {
    return db.prepare('SELECT * FROM checklists WHERE user_id = ? ORDER BY created_at').all(userId) as Checklist[];
  },

  getById(userId: number, id: number): Checklist | undefined {
    return db.prepare('SELECT * FROM checklists WHERE id = ? AND user_id = ?').get(id, userId) as Checklist | undefined;
  },

  /** Case-insensitive substring lookup by name - used to resolve "mi lista de películas" to a row
   *  without the caller needing to know/pass the numeric id (see resolve-checklist.ts). */
  findByName(userId: number, name: string): Checklist[] {
    return db
      .prepare('SELECT * FROM checklists WHERE user_id = ? AND name LIKE ? COLLATE NOCASE ORDER BY created_at')
      .all(userId, `%${name}%`) as Checklist[];
  },

  create(userId: number, name: string): number {
    const info = db.prepare('INSERT INTO checklists (user_id, name) VALUES (?, ?)').run(userId, name);
    return Number(info.lastInsertRowid);
  },

  rename(userId: number, id: number, name: string): void {
    db.prepare('UPDATE checklists SET name = ? WHERE id = ? AND user_id = ?').run(name, id, userId);
  },

  /** Cascades to checklist_items via ON DELETE CASCADE. */
  remove(userId: number, id: number): void {
    db.prepare('DELETE FROM checklists WHERE id = ? AND user_id = ?').run(id, userId);
  },
};

export const checklistItemsRepo = {
  list(checklistId: number): ChecklistItem[] {
    return db
      .prepare('SELECT * FROM checklist_items WHERE checklist_id = ? ORDER BY created_at')
      .all(checklistId) as ChecklistItem[];
  },

  getById(userId: number, id: number): ChecklistItem | undefined {
    return db.prepare('SELECT * FROM checklist_items WHERE id = ? AND user_id = ?').get(id, userId) as
      | ChecklistItem
      | undefined;
  },

  /** Case-insensitive substring lookup scoped to one list - used to resolve "marca super mario" to
   *  a specific item without the caller needing its numeric id. */
  findByTitle(checklistId: number, query: string): ChecklistItem[] {
    return db
      .prepare('SELECT * FROM checklist_items WHERE checklist_id = ? AND title LIKE ? COLLATE NOCASE')
      .all(checklistId, `%${query}%`) as ChecklistItem[];
  },

  add(userId: number, checklistId: number, title: string): number {
    const info = db
      .prepare('INSERT INTO checklist_items (user_id, checklist_id, title) VALUES (?, ?, ?)')
      .run(userId, checklistId, title);
    return Number(info.lastInsertRowid);
  },

  setChecked(userId: number, id: number, checked: boolean): void {
    db.prepare('UPDATE checklist_items SET checked = ? WHERE id = ? AND user_id = ?').run(checked ? 1 : 0, id, userId);
  },

  remove(userId: number, id: number): void {
    db.prepare('DELETE FROM checklist_items WHERE id = ? AND user_id = ?').run(id, userId);
  },
};
