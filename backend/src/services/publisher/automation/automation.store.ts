import { db } from '../../../database/connection.js';
import type { Platform } from '../publisher.types.js';

function parse<T>(text: string | null | undefined, fallback: T): T {
  try {
    return (text ? (JSON.parse(text) as T) : fallback) ?? fallback;
  } catch {
    return fallback;
  }
}

export type RunStatus = 'generating' | 'awaiting' | 'scheduled' | 'published' | 'partial' | 'failed' | 'skipped';

export interface Schedule {
  id: number;
  name: string;
  media: 'image' | 'video';
  format: string;
  layouts: string[];
  topics: string[];
  platforms: Platform[];
  days: number[];
  time: string;
  lead_hours: number;
  mode: 'approve' | 'auto';
  enabled: boolean;
}

export interface Run {
  id: number;
  schedule_id: number;
  publish_at: string;
  item_kind: 'design' | 'promo';
  item_id: number | null;
  post_id: number | null;
  status: RunStatus;
  detail: string;
  notified: number;
  notice_id: string | null;
}

type ScheduleRow = Omit<Schedule, 'layouts' | 'topics' | 'platforms' | 'days' | 'enabled'> & { layouts: string; topics: string; platforms: string; days: string; enabled: number };
const toSchedule = (r: ScheduleRow | undefined): Schedule | undefined =>
  r ? { ...r, layouts: parse(r.layouts, []), topics: parse(r.topics, []), platforms: parse(r.platforms, []), days: parse(r.days, []), enabled: !!r.enabled } : undefined;

export type ScheduleInput = Omit<Schedule, 'id'>;

export const automationStore = {
  listSchedules(): Schedule[] {
    return (db.prepare('SELECT * FROM publisher_schedules ORDER BY id').all() as ScheduleRow[]).map((r) => toSchedule(r)!);
  },
  getSchedule(id: number): Schedule | undefined {
    return toSchedule(db.prepare('SELECT * FROM publisher_schedules WHERE id = ?').get(id) as ScheduleRow | undefined);
  },
  saveSchedule(s: ScheduleInput, id?: number): number {
    const vals = [s.name, s.media, s.format, JSON.stringify(s.layouts), JSON.stringify(s.topics), JSON.stringify(s.platforms), JSON.stringify(s.days), s.time, s.lead_hours, s.mode, s.enabled ? 1 : 0];
    if (id) {
      db.prepare(`UPDATE publisher_schedules SET name=?, media=?, format=?, layouts=?, topics=?, platforms=?, days=?, time=?, lead_hours=?, mode=?, enabled=? WHERE id = ?`).run(...vals, id);
      return id;
    }
    return Number(db.prepare(`INSERT INTO publisher_schedules (name, media, format, layouts, topics, platforms, days, time, lead_hours, mode, enabled) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(...vals).lastInsertRowid);
  },
  setEnabled(id: number, enabled: boolean): void {
    db.prepare('UPDATE publisher_schedules SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
  },
  deleteSchedule(id: number): void {
    db.prepare('DELETE FROM publisher_schedules WHERE id = ?').run(id);
  },

  runExists(scheduleId: number, publishAt: string): boolean {
    return !!db.prepare('SELECT 1 FROM publisher_runs WHERE schedule_id = ? AND publish_at = ?').get(scheduleId, publishAt);
  },
  runCount(scheduleId: number): number {
    return (db.prepare('SELECT COUNT(*) AS n FROM publisher_runs WHERE schedule_id = ?').get(scheduleId) as { n: number }).n;
  },
  createRun(r: { scheduleId: number; publishAt: string; itemKind: 'design' | 'promo'; itemId: number | null; status: RunStatus; detail?: string }): number {
    return Number(
      db.prepare(`INSERT INTO publisher_runs (schedule_id, publish_at, item_kind, item_id, status, detail) VALUES (?, ?, ?, ?, ?, ?)`).run(r.scheduleId, r.publishAt, r.itemKind, r.itemId, r.status, r.detail ?? '').lastInsertRowid,
    );
  },
  getRun(id: number): Run | undefined {
    return db.prepare('SELECT * FROM publisher_runs WHERE id = ?').get(id) as Run | undefined;
  },
  listRuns(limit = 60): Run[] {
    return db.prepare('SELECT * FROM publisher_runs ORDER BY publish_at DESC, id DESC LIMIT ?').all(limit) as Run[];
  },
  openRuns(): Run[] {
    return db.prepare(`SELECT * FROM publisher_runs WHERE status IN ('generating', 'awaiting', 'scheduled') ORDER BY publish_at, id`).all() as Run[];
  },
  updateRun(id: number, patch: Partial<Pick<Run, 'status' | 'detail' | 'post_id' | 'notified'>>): void {
    const keys = Object.keys(patch) as (keyof typeof patch)[];
    if (!keys.length) return;
    db.prepare(`UPDATE publisher_runs SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => patch[k] as string | number | null), id);
  },
  setNotice(id: number, noticeId: string): void {
    db.prepare('UPDATE publisher_runs SET notice_id = ? WHERE id = ?').run(noticeId, id);
  },
  runByNotice(noticeId: string): Run | undefined {
    return db.prepare('SELECT * FROM publisher_runs WHERE notice_id = ?').get(noticeId) as Run | undefined;
  },
  /** How many awaiting approval (for the badge). */
  awaitingCount(): number {
    return (db.prepare(`SELECT COUNT(*) AS n FROM publisher_runs WHERE status = 'awaiting'`).get() as { n: number }).n;
  },
};
