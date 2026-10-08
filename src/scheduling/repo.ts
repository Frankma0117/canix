import { db } from '../db/pool.js';

export type AppointmentStatus = 'pending' | 'confirmed' | 'rejected' | 'cancelled' | 'completed' | 'no_show' | 'expired';
export const ACTIVE_STATUSES: AppointmentStatus[] = ['pending', 'confirmed'];

export interface Professional {
  user_id: number;
  display_name: string;
  specialty: string | null;
  slot_minutes: number;
  buffer_minutes: number;
  min_notice_minutes: number;
  max_days_ahead: number;
  reminder_morning_time: string | null;
  reminder_hours_before: number | null;
  auto_confirm: number;
  active: number;
  created_at: string;
  updated_at: string;
}

export interface AvailabilityRule {
  id: number;
  professional_id: number;
  weekday: number;
  start_time: string;
  end_time: string;
}

export interface TimeOff {
  id: number;
  professional_id: number;
  start_at: string;
  end_at: string;
  reason: string | null;
}

export interface Appointment {
  id: number;
  professional_id: number;
  client_user_id: number;
  start_at: string;
  end_at: string;
  status: AppointmentStatus;
  reason: string | null;
  notes: string | null;
  cancel_reason: string | null;
  created_by: number | null;
  status_changed_by: number | null;
  confirmed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Appointment joined with both parties' display info - what every list/notification needs. */
export interface AppointmentView extends Appointment {
  professional_name: string;
  professional_jid: string;
  client_name: string | null;
  client_jid: string;
}

export interface SchedGroup {
  id: number;
  name: string;
  description: string;
  created_at: string;
}

export interface ClientAccessRow {
  id: number;
  client_user_id: number;
  professional_id: number | null;
  group_id: number | null;
  created_at: string;
  client_name: string | null;
  client_jid: string;
  group_name?: string | null;
  professional_name?: string | null;
}

const VIEW_SELECT = `
  SELECT a.*, p.display_name AS professional_name, up.jid AS professional_jid,
         uc.name AS client_name, uc.jid AS client_jid
  FROM sched_appointments a
  JOIN sched_professionals p ON p.user_id = a.professional_id
  JOIN users up ON up.id = a.professional_id
  JOIN users uc ON uc.id = a.client_user_id`;

export const schedRepo = {
  // ---------- professionals ----------
  getProfessional(userId: number): Professional | undefined {
    return db.prepare('SELECT * FROM sched_professionals WHERE user_id = ?').get(userId) as Professional | undefined;
  },

  createProfessional(userId: number, displayName: string): Professional {
    db.prepare('INSERT OR IGNORE INTO sched_professionals (user_id, display_name) VALUES (?, ?)').run(userId, displayName.slice(0, 80) || 'Profesional');
    return this.getProfessional(userId)!;
  },

  listProfessionals(): (Professional & { jid: string })[] {
    return db
      .prepare('SELECT p.*, u.jid FROM sched_professionals p JOIN users u ON u.id = p.user_id ORDER BY p.display_name')
      .all() as (Professional & { jid: string })[];
  },

  updateProfessional(
    userId: number,
    fields: Partial<
      Pick<
        Professional,
        | 'display_name'
        | 'specialty'
        | 'slot_minutes'
        | 'buffer_minutes'
        | 'min_notice_minutes'
        | 'max_days_ahead'
        | 'reminder_morning_time'
        | 'reminder_hours_before'
        | 'auto_confirm'
        | 'active'
      >
    >,
  ): Professional {
    const keys = Object.keys(fields) as (keyof typeof fields)[];
    if (keys.length) {
      db.prepare(`UPDATE sched_professionals SET ${keys.map((k) => `${k} = @${k}`).join(', ')}, updated_at = datetime('now') WHERE user_id = @user_id`).run({
        ...fields,
        user_id: userId,
      });
    }
    return this.getProfessional(userId)!;
  },

  // ---------- availability ----------
  availability(professionalId: number): AvailabilityRule[] {
    return db
      .prepare('SELECT * FROM sched_availability WHERE professional_id = ? ORDER BY weekday, start_time')
      .all(professionalId) as AvailabilityRule[];
  },

  /** Replaces the whole weekly schedule atomically (the only way it's ever edited). */
  replaceAvailability(professionalId: number, rules: { weekday: number; start_time: string; end_time: string }[]): void {
    db.transaction(() => {
      db.prepare('DELETE FROM sched_availability WHERE professional_id = ?').run(professionalId);
      const ins = db.prepare('INSERT INTO sched_availability (professional_id, weekday, start_time, end_time) VALUES (?, ?, ?, ?)');
      for (const r of rules) ins.run(professionalId, r.weekday, r.start_time, r.end_time);
    })();
  },

  timeOff(professionalId: number, from: string, to: string): TimeOff[] {
    return db
      .prepare('SELECT * FROM sched_time_off WHERE professional_id = ? AND end_at > ? AND start_at < ? ORDER BY start_at')
      .all(professionalId, from, to) as TimeOff[];
  },

  addTimeOff(professionalId: number, startAt: string, endAt: string, reason: string | null): number {
    return Number(
      db.prepare('INSERT INTO sched_time_off (professional_id, start_at, end_at, reason) VALUES (?, ?, ?, ?)').run(professionalId, startAt, endAt, reason)
        .lastInsertRowid,
    );
  },

  deleteTimeOff(professionalId: number, id: number): boolean {
    return db.prepare('DELETE FROM sched_time_off WHERE id = ? AND professional_id = ?').run(id, professionalId).changes > 0;
  },

  // ---------- appointments ----------
  getAppointment(id: number): AppointmentView | undefined {
    return db.prepare(`${VIEW_SELECT} WHERE a.id = ?`).get(id) as AppointmentView | undefined;
  },

  /** Active (pending/confirmed) appointments of a professional overlapping [from, to). */
  activeOverlapping(professionalId: number, from: string, to: string, excludeId = 0): Appointment[] {
    return db
      .prepare(
        `SELECT * FROM sched_appointments WHERE professional_id = ? AND status IN ('pending','confirmed')
           AND start_at < ? AND end_at > ? AND id <> ?`,
      )
      .all(professionalId, to, from, excludeId) as Appointment[];
  },

  listForProfessional(professionalId: number, from: string, to: string, statuses?: AppointmentStatus[]): AppointmentView[] {
    const st = statuses?.length ? `AND a.status IN (${statuses.map(() => '?').join(',')})` : '';
    return db
      .prepare(`${VIEW_SELECT} WHERE a.professional_id = ? AND a.start_at >= ? AND a.start_at < ? ${st} ORDER BY a.start_at`)
      .all(professionalId, from, to, ...(statuses ?? [])) as AppointmentView[];
  },

  listForProfessionals(ids: number[], from: string, to: string): AppointmentView[] {
    if (!ids.length) return [];
    return db
      .prepare(
        `${VIEW_SELECT} WHERE a.professional_id IN (${ids.map(() => '?').join(',')}) AND a.start_at >= ? AND a.start_at < ? ORDER BY a.start_at`,
      )
      .all(...ids, from, to) as AppointmentView[];
  },

  listForClient(clientId: number, fromAt: string): AppointmentView[] {
    return db
      .prepare(`${VIEW_SELECT} WHERE a.client_user_id = ? AND a.end_at >= ? ORDER BY a.start_at`)
      .all(clientId, fromAt) as AppointmentView[];
  },

  pendingCountForClient(clientId: number, professionalId: number, nowAt: string): number {
    return (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM sched_appointments WHERE client_user_id = ? AND professional_id = ? AND status IN ('pending','confirmed') AND start_at > ?`,
        )
        .get(clientId, professionalId, nowAt) as { n: number }
    ).n;
  },

  insertAppointment(a: {
    professional_id: number;
    client_user_id: number;
    start_at: string;
    end_at: string;
    status: AppointmentStatus;
    reason: string | null;
    notes?: string | null;
    created_by: number;
  }): number {
    return Number(
      db
        .prepare(
          `INSERT INTO sched_appointments (professional_id, client_user_id, start_at, end_at, status, reason, notes, created_by, status_changed_by, confirmed_at)
           VALUES (@professional_id, @client_user_id, @start_at, @end_at, @status, @reason, @notes, @created_by, @created_by,
                   CASE WHEN @status = 'confirmed' THEN datetime('now') END)`,
        )
        .run({ notes: null, ...a }).lastInsertRowid,
    );
  },

  setStatus(id: number, status: AppointmentStatus, actorId: number | null, cancelReason?: string | null): void {
    db.prepare(
      `UPDATE sched_appointments SET status = ?, status_changed_by = ?, updated_at = datetime('now'),
         cancel_reason = COALESCE(?, cancel_reason),
         confirmed_at = CASE WHEN ? = 'confirmed' THEN datetime('now') ELSE confirmed_at END
       WHERE id = ?`,
    ).run(status, actorId, cancelReason ?? null, status, id);
  },

  setNotes(id: number, notes: string | null): void {
    db.prepare(`UPDATE sched_appointments SET notes = ?, updated_at = datetime('now') WHERE id = ?`).run(notes, id);
  },

  addEvent(appointmentId: number, actorId: number | null, action: string, detail?: unknown): void {
    db.prepare('INSERT INTO sched_appointment_events (appointment_id, actor_user_id, action, detail) VALUES (?, ?, ?, ?)').run(
      appointmentId,
      actorId,
      action,
      detail === undefined ? null : JSON.stringify(detail),
    );
  },

  events(appointmentId: number): { action: string; detail: string | null; created_at: string; actor_name: string | null }[] {
    return db
      .prepare(
        `SELECT e.action, e.detail, e.created_at, u.name AS actor_name FROM sched_appointment_events e
         LEFT JOIN users u ON u.id = e.actor_user_id WHERE e.appointment_id = ? ORDER BY e.id`,
      )
      .all(appointmentId) as { action: string; detail: string | null; created_at: string; actor_name: string | null }[];
  },

  /** Pending requests whose start already passed - never confirmed in time. */
  stalePending(nowAt: string): AppointmentView[] {
    return db.prepare(`${VIEW_SELECT} WHERE a.status = 'pending' AND a.start_at <= ?`).all(nowAt) as AppointmentView[];
  },

  /** Confirmed appointments already over - auto-closed as completed. */
  finishedConfirmed(nowAt: string): Appointment[] {
    return db.prepare(`SELECT * FROM sched_appointments WHERE status = 'confirmed' AND end_at <= ?`).all(nowAt) as Appointment[];
  },

  // ---------- reminders ----------
  replaceReminders(appointmentId: number, rows: { user_id: number; kind: 'morning' | 'before'; run_at: string }[]): void {
    db.prepare(`DELETE FROM sched_reminders WHERE appointment_id = ? AND status = 'pending'`).run(appointmentId);
    const ins = db.prepare(
      `INSERT INTO sched_reminders (appointment_id, user_id, kind, run_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(appointment_id, user_id, kind) DO UPDATE SET run_at = excluded.run_at, status = 'pending', sent_at = NULL`,
    );
    for (const r of rows) ins.run(appointmentId, r.user_id, r.kind, r.run_at);
  },

  cancelReminders(appointmentId: number): void {
    db.prepare(`UPDATE sched_reminders SET status = 'cancelled' WHERE appointment_id = ? AND status = 'pending'`).run(appointmentId);
  },

  dueReminders(nowAt: string): { id: number; appointment_id: number; user_id: number; kind: string; run_at: string }[] {
    return db
      .prepare(`SELECT id, appointment_id, user_id, kind, run_at FROM sched_reminders WHERE status = 'pending' AND run_at <= ? ORDER BY run_at LIMIT 50`)
      .all(nowAt) as { id: number; appointment_id: number; user_id: number; kind: string; run_at: string }[];
  },

  markReminder(id: number, status: 'sent' | 'cancelled' | 'failed'): void {
    db.prepare(`UPDATE sched_reminders SET status = ?, sent_at = CASE WHEN ? = 'sent' THEN datetime('now') END WHERE id = ?`).run(status, status, id);
  },

  // ---------- groups ----------
  listGroups(): (SchedGroup & { member_ids: string | null })[] {
    return db
      .prepare(
        `SELECT g.*, (SELECT group_concat(professional_id) FROM sched_group_members m WHERE m.group_id = g.id) AS member_ids
         FROM sched_groups g ORDER BY g.name`,
      )
      .all() as (SchedGroup & { member_ids: string | null })[];
  },

  getGroup(idOrName: number | string): SchedGroup | undefined {
    return (
      typeof idOrName === 'number'
        ? db.prepare('SELECT * FROM sched_groups WHERE id = ?').get(idOrName)
        : db.prepare('SELECT * FROM sched_groups WHERE name = ? COLLATE NOCASE').get(idOrName)
    ) as SchedGroup | undefined;
  },

  createGroup(name: string, description: string): number {
    return Number(db.prepare('INSERT INTO sched_groups (name, description) VALUES (?, ?)').run(name, description).lastInsertRowid);
  },

  updateGroup(id: number, name: string, description: string): void {
    db.prepare('UPDATE sched_groups SET name = ?, description = ? WHERE id = ?').run(name, description, id);
  },

  deleteGroup(id: number): void {
    db.prepare('DELETE FROM sched_groups WHERE id = ?').run(id);
  },

  setGroupMembers(groupId: number, professionalIds: number[]): void {
    db.transaction(() => {
      db.prepare('DELETE FROM sched_group_members WHERE group_id = ?').run(groupId);
      const ins = db.prepare('INSERT INTO sched_group_members (group_id, professional_id) VALUES (?, ?)');
      for (const id of new Set(professionalIds)) ins.run(groupId, id);
    })();
  },

  groupMemberIds(groupId: number): number[] {
    return (db.prepare('SELECT professional_id FROM sched_group_members WHERE group_id = ?').all(groupId) as { professional_id: number }[]).map(
      (r) => r.professional_id,
    );
  },

  groupsOfProfessional(professionalId: number): SchedGroup[] {
    return db
      .prepare('SELECT g.* FROM sched_groups g JOIN sched_group_members m ON m.group_id = g.id WHERE m.professional_id = ? ORDER BY g.name')
      .all(professionalId) as SchedGroup[];
  },

  // ---------- client access ----------
  grantClientAccess(clientId: number, target: { professionalId?: number; groupId?: number }, grantedBy: number): void {
    db.prepare(
      `INSERT OR IGNORE INTO sched_client_access (client_user_id, professional_id, group_id, granted_by) VALUES (?, ?, ?, ?)`,
    ).run(clientId, target.professionalId ?? null, target.groupId ?? null, grantedBy);
  },

  revokeClientAccess(clientId: number, target: { professionalId?: number; groupId?: number }): boolean {
    return (
      db
        .prepare(
          target.professionalId
            ? 'DELETE FROM sched_client_access WHERE client_user_id = ? AND professional_id = ?'
            : 'DELETE FROM sched_client_access WHERE client_user_id = ? AND group_id = ?',
        )
        .run(clientId, target.professionalId ?? target.groupId).changes > 0
    );
  },

  /** Professionals this client may book with: direct grants + every member of granted groups. */
  bookableProfessionalIds(clientId: number): number[] {
    return (
      db
        .prepare(
          `SELECT professional_id AS id FROM sched_client_access WHERE client_user_id = ? AND professional_id IS NOT NULL
           UNION
           SELECT m.professional_id FROM sched_client_access a JOIN sched_group_members m ON m.group_id = a.group_id
           WHERE a.client_user_id = ? AND a.group_id IS NOT NULL`,
        )
        .all(clientId, clientId) as { id: number }[]
    ).map((r) => r.id);
  },

  /** Clients with direct access to this professional, plus clients of groups they belong to. */
  clientsOfProfessional(professionalId: number): ClientAccessRow[] {
    return db
      .prepare(
        `SELECT a.*, u.name AS client_name, u.jid AS client_jid, g.name AS group_name FROM sched_client_access a
         JOIN users u ON u.id = a.client_user_id LEFT JOIN sched_groups g ON g.id = a.group_id
         WHERE a.professional_id = ? OR a.group_id IN (SELECT group_id FROM sched_group_members WHERE professional_id = ?)
         ORDER BY u.name`,
      )
      .all(professionalId, professionalId) as ClientAccessRow[];
  },

  clientsOfGroup(groupId: number): ClientAccessRow[] {
    return db
      .prepare(
        `SELECT a.*, u.name AS client_name, u.jid AS client_jid FROM sched_client_access a JOIN users u ON u.id = a.client_user_id
         WHERE a.group_id = ? ORDER BY u.name`,
      )
      .all(groupId) as ClientAccessRow[];
  },
};
