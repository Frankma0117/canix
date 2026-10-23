import { inferListKind, type ListKind } from '../shared/utils/list-kinds.js';
import { db } from '../database/connection.js';
import type { Checklist, ChecklistItem } from '../entities/index.js';

/** The media fields an item can carry (see entities/checklist.entity.ts). */
export interface MediaFields {
  creator?: string | null;
  genre?: string | null;
  year?: number | null;
  summary?: string | null;
  url?: string | null;
  linkId?: number | null;
  rating?: number | null;
  notes?: string | null;
}

/** A library item with the list it lives in. */
export interface MediaItem extends ChecklistItem {
  list_name: string;
  kind: string;
}

export interface MediaFilter {
  kinds?: string[];
  listId?: number;
  done?: boolean;
  genre?: string;
  creator?: string;
  search?: string;
}

const MEDIA_COLUMNS: [keyof MediaFields, string][] = [
  ['creator', 'creator'],
  ['genre', 'genre'],
  ['year', 'year'],
  ['summary', 'summary'],
  ['url', 'url'],
  ['linkId', 'link_id'],
  ['rating', 'rating'],
  ['notes', 'notes'],
];

export const checklistsModel = {
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

  /** `kind` defaults to whatever the name points at (see shared/utils/list-kinds.ts). */
  create(userId: number, name: string, kind?: ListKind | null): number {
    const info = db.prepare('INSERT INTO checklists (user_id, name, kind) VALUES (?, ?, ?)').run(userId, name, kind ?? inferListKind(name));
    return Number(info.lastInsertRowid);
  },

  setKind(userId: number, id: number, kind: ListKind): void {
    db.prepare('UPDATE checklists SET kind = ? WHERE id = ? AND user_id = ?').run(kind, id, userId);
  },

  rename(userId: number, id: number, name: string): void {
    db.prepare('UPDATE checklists SET name = ? WHERE id = ? AND user_id = ?').run(name, id, userId);
  },

  /** Cascades to checklist_items via ON DELETE CASCADE. */
  remove(userId: number, id: number): void {
    db.prepare('DELETE FROM checklists WHERE id = ? AND user_id = ?').run(id, userId);
  },
};

export const checklistItemsModel = {
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

  /** Marks it done/undone; done_at records when (kept for the library's "visto el ..."). */
  setChecked(userId: number, id: number, checked: boolean): void {
    db.prepare(`UPDATE checklist_items SET checked = ?, done_at = CASE WHEN ? THEN COALESCE(done_at, datetime('now')) ELSE NULL END WHERE id = ? AND user_id = ?`).run(
      checked ? 1 : 0,
      checked ? 1 : 0,
      id,
      userId,
    );
  },

  /** Adds an item with its media fields in one go. */
  addMedia(userId: number, checklistId: number, title: string, fields: MediaFields): number {
    const id = this.add(userId, checklistId, title);
    this.updateMedia(userId, id, fields);
    return id;
  },

  /** Sets only the media fields given (undefined = unchanged, null = cleared). */
  updateMedia(userId: number, id: number, fields: MediaFields & { title?: string; checklistId?: number }): void {
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const [key, column] of MEDIA_COLUMNS) {
      if (fields[key] === undefined) continue;
      sets.push(`${column} = ?`);
      values.push(fields[key]);
    }
    if (fields.title !== undefined) {
      sets.push('title = ?');
      values.push(fields.title);
    }
    if (fields.checklistId !== undefined) {
      sets.push('checklist_id = ?');
      values.push(fields.checklistId);
    }
    if (!sets.length) return;
    db.prepare(`UPDATE checklist_items SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).run(...values, id, userId);
  },

  /** Library items across the person's lists, newest first, with each one's list. */
  listMedia(userId: number, filter: MediaFilter = {}): MediaItem[] {
    const where = ['i.user_id = ?'];
    const params: unknown[] = [userId];
    if (filter.kinds?.length) {
      where.push(`l.kind IN (${filter.kinds.map(() => '?').join(',')})`);
      params.push(...filter.kinds);
    }
    if (filter.listId !== undefined) {
      where.push('l.id = ?');
      params.push(filter.listId);
    }
    if (filter.done !== undefined) {
      where.push('i.checked = ?');
      params.push(filter.done ? 1 : 0);
    }
    for (const [value, column] of [
      [filter.genre, 'i.genre'],
      [filter.creator, 'i.creator'],
    ] as const) {
      if (!value) continue;
      where.push(`${column} LIKE ? COLLATE NOCASE`);
      params.push(`%${value}%`);
    }
    if (filter.search) {
      where.push(`(i.title LIKE ? COLLATE NOCASE OR i.summary LIKE ? COLLATE NOCASE OR i.creator LIKE ? COLLATE NOCASE OR i.genre LIKE ? COLLATE NOCASE OR i.notes LIKE ? COLLATE NOCASE)`);
      params.push(...Array(5).fill(`%${filter.search}%`));
    }
    return db
      .prepare(
        `SELECT i.*, l.name AS list_name, l.kind AS kind FROM checklist_items i JOIN checklists l ON l.id = i.checklist_id
         WHERE ${where.join(' AND ')} ORDER BY i.checked, i.created_at DESC`,
      )
      .all(...params) as MediaItem[];
  },

  remove(userId: number, id: number): void {
    db.prepare('DELETE FROM checklist_items WHERE id = ? AND user_id = ?').run(id, userId);
  },
};
