import { db } from '../db/pool.js';
import { usersRepo } from '../db/repositories/users.repo.js';
import { permissionsRepo } from '../db/repositories/permissions.repo.js';
import { can, effectivePermissions } from '../permissions/engine.js';
import { addDays, addMinutes, nowLocal, parseStrictDateTime, todayLocal } from '../util/datetime.js';
import { phoneToJid } from '../util/jid.js';
import { checkBudget, recordSend } from '../whatsapp/send-guard.js';
import { env } from '../config/env.js';
import { ensureDailyResetReminder } from '../agent/daily-reset.js';
import { schedRepo, type AppointmentView, type Professional, type AppointmentStatus } from './repo.js';
import { availableSlots, formatWhen, type Slot } from './slots.js';
import type { User } from '../types/index.js';

/**
 * Business rules of the scheduling module, shared by the WhatsApp tools (scheduling/tools) and the
 * web portal API (server/scheduling-routes.ts) - neither talks to the repo directly for writes, so
 * the rules below hold no matter where an action comes from:
 *   - a client can only book with professionals that shared access with them (directly or via a
 *     group), only on a slot that is actually free right now, and the request stays PENDING until
 *     the professional confirms (unless the professional turned on auto_confirm);
 *   - every state change is atomic (db.transaction) and logged in sched_appointment_events;
 *   - confirmed appointments get reminders for BOTH parties (default: the morning of the day);
 *   - both parties are notified over WhatsApp of every change the other side makes.
 */

export class SchedulingError extends Error {}

/** Anything that can send a WhatsApp text - the live WaManager, injected once at boot. */
interface Notifier {
  sendText(jid: string, text: string): Promise<void>;
  checkOnWhatsApp?(jid: string): Promise<boolean | null>;
  ownPhone?(): string | null;
}
let notifier: Notifier | null = null;
export function setSchedulingNotifier(n: Notifier): void {
  notifier = n;
}

async function notify(jid: string, text: string): Promise<boolean> {
  if (!notifier) return false;
  try {
    await notifier.sendText(jid, text);
    return true;
  } catch (err) {
    console.error('[SCHED] No se pudo notificar a %s:', jid, (err as Error).message);
    return false;
  }
}

const MAX_ACTIVE_PER_CLIENT = 3;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// ---------------------------------------------------------------------------------------------
// Professionals
// ---------------------------------------------------------------------------------------------

/** The professional profile of a user with scheduling.professional, created on first use. */
export function ensureProfessional(user: User): Professional {
  if (!can(user, 'scheduling.professional')) throw new SchedulingError('No tienes habilitada la agenda de profesional.');
  return schedRepo.getProfessional(user.id) ?? schedRepo.createProfessional(user.id, user.name ?? 'Profesional');
}

export function professionalLabel(p: Professional): string {
  return p.specialty ? `${p.display_name} (${p.specialty})` : p.display_name;
}

export interface WeeklyRuleInput {
  weekday: number;
  start: string;
  end: string;
}

export function setAvailability(prof: Professional, rules: WeeklyRuleInput[]): void {
  for (const r of rules) {
    if (!Number.isInteger(r.weekday) || r.weekday < 0 || r.weekday > 6) throw new SchedulingError(`Día inválido: ${r.weekday} (0=domingo .. 6=sábado).`);
    if (!TIME_RE.test(r.start) || !TIME_RE.test(r.end)) throw new SchedulingError(`Hora inválida en ${r.start}-${r.end} (usa HH:mm, 24h).`);
    if (r.start >= r.end) throw new SchedulingError(`El horario ${r.start}-${r.end} termina antes de empezar.`);
  }
  // Overlapping windows on the same day would generate duplicate slots.
  for (const a of rules)
    for (const b of rules)
      if (a !== b && a.weekday === b.weekday && a.start < b.end && b.start < a.end) {
        throw new SchedulingError(`Los horarios ${a.start}-${a.end} y ${b.start}-${b.end} se cruzan el mismo día.`);
      }
  schedRepo.replaceAvailability(
    prof.user_id,
    rules.map((r) => ({ weekday: r.weekday, start_time: r.start, end_time: r.end })),
  );
}

export interface SettingsInput {
  display_name?: string;
  specialty?: string | null;
  slot_minutes?: number;
  buffer_minutes?: number;
  min_notice_minutes?: number;
  max_days_ahead?: number;
  reminder_morning_time?: string | null;
  reminder_hours_before?: number | null;
  auto_confirm?: boolean;
}

export function updateSettings(prof: Professional, s: SettingsInput): Professional {
  const fields: Parameters<typeof schedRepo.updateProfessional>[1] = {};
  const intIn = (v: number | undefined, min: number, max: number, label: string) => {
    if (v === undefined) return undefined;
    if (!Number.isInteger(v) || v < min || v > max) throw new SchedulingError(`${label} debe estar entre ${min} y ${max}.`);
    return v;
  };
  if (s.display_name !== undefined) {
    const n = s.display_name.trim();
    if (!n || n.length > 80) throw new SchedulingError('El nombre a mostrar debe tener entre 1 y 80 caracteres.');
    fields.display_name = n;
  }
  if (s.specialty !== undefined) fields.specialty = s.specialty?.trim() || null;
  fields.slot_minutes = intIn(s.slot_minutes, 5, 480, 'La duración de la cita');
  fields.buffer_minutes = intIn(s.buffer_minutes, 0, 240, 'El tiempo entre citas');
  fields.min_notice_minutes = intIn(s.min_notice_minutes, 0, 20160, 'La anticipación mínima');
  fields.max_days_ahead = intIn(s.max_days_ahead, 1, 365, 'Los días hacia adelante');
  if (s.reminder_morning_time !== undefined) {
    if (s.reminder_morning_time !== null && !TIME_RE.test(s.reminder_morning_time)) throw new SchedulingError('La hora del recordatorio debe ser HH:mm.');
    fields.reminder_morning_time = s.reminder_morning_time;
  }
  if (s.reminder_hours_before !== undefined) {
    fields.reminder_hours_before = s.reminder_hours_before === null ? null : intIn(s.reminder_hours_before, 1, 72, 'Las horas antes');
  }
  if (s.auto_confirm !== undefined) fields.auto_confirm = s.auto_confirm ? 1 : 0;
  for (const k of Object.keys(fields) as (keyof typeof fields)[]) if (fields[k] === undefined) delete fields[k];
  const updated = schedRepo.updateProfessional(prof.user_id, fields);

  // A reminder policy change applies to already-confirmed future appointments too.
  if (s.reminder_morning_time !== undefined || s.reminder_hours_before !== undefined) {
    const upcoming = schedRepo.listForProfessional(prof.user_id, nowLocal(), addDays(nowLocal(), 400), ['confirmed']);
    db.transaction(() => upcoming.forEach((a) => rebuildReminders(a, updated)))();
  }
  return updated;
}

export function blockTime(prof: Professional, startRaw: string, endRaw: string, reason: string | null): number {
  const start = parseStrictDateTime(startRaw);
  const end = parseStrictDateTime(endRaw);
  if (!start || !end) throw new SchedulingError("Fechas inválidas (usa 'YYYY-MM-DD HH:mm').");
  if (start >= end) throw new SchedulingError('El bloqueo termina antes de empezar.');
  return schedRepo.addTimeOff(prof.user_id, start, end, reason);
}

// ---------------------------------------------------------------------------------------------
// Client side
// ---------------------------------------------------------------------------------------------

export function bookableProfessionals(clientId: number): Professional[] {
  return schedRepo
    .bookableProfessionalIds(clientId)
    .map((id) => schedRepo.getProfessional(id))
    .filter((p): p is Professional => !!p && !!p.active);
}

/** Resolves a professional by name (or the only one) among those this client may book with. */
export function resolveBookableProfessional(clientId: number, query?: string): Professional {
  const list = bookableProfessionals(clientId);
  if (!list.length) throw new SchedulingError('Todavía ningún profesional te ha dado acceso para agendar.');
  if (!query?.trim()) {
    if (list.length === 1) return list[0];
    throw new SchedulingError(`¿Con quién? Puedes agendar con: ${list.map(professionalLabel).join(', ')}.`);
  }
  const q = query.trim().toLowerCase();
  const matches = list.filter((p) => p.display_name.toLowerCase().includes(q) || (p.specialty ?? '').toLowerCase().includes(q));
  if (matches.length === 1) return matches[0];
  if (!matches.length) throw new SchedulingError(`No tienes acceso a "${query}". Puedes agendar con: ${list.map(professionalLabel).join(', ')}.`);
  throw new SchedulingError(`Varios coinciden con "${query}": ${matches.map(professionalLabel).join(', ')}. ¿Cuál?`);
}

export function slotsFor(prof: Professional, fromDate?: string, days = 7): Slot[] {
  const from = fromDate && /^\d{4}-\d{2}-\d{2}$/.test(fromDate) ? fromDate : todayLocal();
  const span = Math.min(Math.max(Math.round(days), 1), 31);
  return availableSlots(prof, from, addDays(from, span - 1).slice(0, 10));
}

/** Creates a client's request (pending, or confirmed if the professional auto-confirms). */
export async function requestAppointment(client: User, prof: Professional, startRaw: string, reason: string | null): Promise<AppointmentView> {
  if (!can(client, 'scheduling.client') && client.role !== 'admin') throw new SchedulingError('No tienes habilitado agendar citas.');
  if (!schedRepo.bookableProfessionalIds(client.id).includes(prof.user_id)) throw new SchedulingError('No tienes acceso para agendar con ese profesional.');
  const start = parseStrictDateTime(startRaw);
  if (!start) throw new SchedulingError(`"${startRaw}" no es una fecha/hora válida ('YYYY-MM-DD HH:mm').`);

  const day = start.slice(0, 10);
  const daySlots = availableSlots(prof, day, day);
  const slot = daySlots.find((s) => s.start_at === start);
  if (!slot) {
    const options = daySlots.slice(0, 8).map((s) => s.start_at.slice(11, 16));
    throw new SchedulingError(
      options.length
        ? `Ese horario no está disponible. Ese día quedan: ${options.join(', ')}.`
        : 'Ese horario no está disponible y ese día no quedan espacios. Pide los espacios de otro día.',
    );
  }
  if (schedRepo.pendingCountForClient(client.id, prof.user_id, nowLocal()) >= MAX_ACTIVE_PER_CLIENT) {
    throw new SchedulingError(`Ya tienes ${MAX_ACTIVE_PER_CLIENT} citas activas con ${prof.display_name}; cancela una antes de pedir otra.`);
  }

  const status: AppointmentStatus = prof.auto_confirm ? 'confirmed' : 'pending';
  const id = db.transaction(() => {
    // Re-checked inside the transaction - the authoritative guard against a double booking.
    if (schedRepo.activeOverlapping(prof.user_id, slot.start_at, slot.end_at).length) {
      throw new SchedulingError('Alguien acaba de tomar ese horario. Pide los espacios de nuevo.');
    }
    const newId = schedRepo.insertAppointment({
      professional_id: prof.user_id,
      client_user_id: client.id,
      start_at: slot.start_at,
      end_at: slot.end_at,
      status,
      reason: reason?.trim().slice(0, 300) || null,
      created_by: client.id,
    });
    schedRepo.addEvent(newId, client.id, 'requested', { status });
    if (status === 'confirmed') rebuildReminders(schedRepo.getAppointment(newId)!, prof);
    return newId;
  })();

  const appt = schedRepo.getAppointment(id)!;
  const who = client.name ?? client.jid.split('@')[0];
  if (status === 'pending') {
    await notify(
      appt.professional_jid,
      `📅 *Nueva solicitud de cita #${id}*\n${who} - ${formatWhen(appt.start_at)}${appt.reason ? `\nMotivo: ${appt.reason}` : ''}\n\n` +
        `Responde "confirmar cita ${id}" o "rechazar cita ${id}" (o hazlo desde el calendario del portal).`,
    );
  } else {
    await notify(appt.professional_jid, `📅 Cita #${id} agendada y confirmada automáticamente: ${who} - ${formatWhen(appt.start_at)}.`);
  }
  return appt;
}

// ---------------------------------------------------------------------------------------------
// State changes
// ---------------------------------------------------------------------------------------------

function loadOwned(id: number, actor: User, as: 'professional' | 'client' | 'any'): AppointmentView {
  const appt = schedRepo.getAppointment(id);
  if (!appt) throw new SchedulingError(`No existe la cita #${id}.`);
  const isProf = appt.professional_id === actor.id;
  const isClient = appt.client_user_id === actor.id;
  const isAdmin = actor.role === 'admin';
  const ok = as === 'professional' ? isProf || isAdmin : as === 'client' ? isClient : isProf || isClient || isAdmin;
  if (!ok) throw new SchedulingError(`No encontré la cita #${id} entre las tuyas.`);
  return appt;
}

export async function confirmAppointment(actor: User, id: number): Promise<AppointmentView> {
  const appt = loadOwned(id, actor, 'professional');
  if (appt.status !== 'pending') throw new SchedulingError(`La cita #${id} no está pendiente (está ${statusLabel(appt.status)}).`);
  if (appt.start_at <= nowLocal()) throw new SchedulingError(`La cita #${id} ya pasó; no se puede confirmar.`);
  const prof = schedRepo.getProfessional(appt.professional_id)!;
  db.transaction(() => {
    schedRepo.setStatus(id, 'confirmed', actor.id);
    schedRepo.addEvent(id, actor.id, 'confirmed');
    rebuildReminders(schedRepo.getAppointment(id)!, prof);
  })();
  const updated = schedRepo.getAppointment(id)!;
  await notify(
    updated.client_jid,
    `✅ *Tu cita quedó confirmada*\n${prof.display_name} - ${formatWhen(updated.start_at)}.\nTe aviso ese día para que no se te olvide.`,
  );
  return updated;
}

export async function rejectAppointment(actor: User, id: number, reason: string | null): Promise<AppointmentView> {
  const appt = loadOwned(id, actor, 'professional');
  if (appt.status !== 'pending') throw new SchedulingError(`La cita #${id} no está pendiente (está ${statusLabel(appt.status)}).`);
  db.transaction(() => {
    schedRepo.setStatus(id, 'rejected', actor.id, reason);
    schedRepo.addEvent(id, actor.id, 'rejected', { reason });
  })();
  await notify(
    appt.client_jid,
    `❌ Tu solicitud de cita con ${appt.professional_name} para el ${formatWhen(appt.start_at)} no pudo ser aceptada.` +
      `${reason ? `\nMotivo: ${reason}` : ''}\nPuedes pedir otro horario cuando quieras.`,
  );
  return schedRepo.getAppointment(id)!;
}

export async function cancelAppointment(actor: User, id: number, reason: string | null): Promise<AppointmentView> {
  const appt = loadOwned(id, actor, 'any');
  if (!['pending', 'confirmed'].includes(appt.status)) throw new SchedulingError(`La cita #${id} ya está ${statusLabel(appt.status)}.`);
  if (appt.end_at <= nowLocal()) throw new SchedulingError(`La cita #${id} ya pasó.`);
  db.transaction(() => {
    schedRepo.setStatus(id, 'cancelled', actor.id, reason);
    schedRepo.cancelReminders(id);
    schedRepo.addEvent(id, actor.id, 'cancelled', { reason });
  })();
  const byClient = actor.id === appt.client_user_id;
  const otherJid = byClient ? appt.professional_jid : appt.client_jid;
  const actorName = byClient ? (appt.client_name ?? 'El cliente') : appt.professional_name;
  await notify(
    otherJid,
    `🚫 *Cita cancelada*\n${actorName} canceló la cita del ${formatWhen(appt.start_at)}.${reason ? `\nMotivo: ${reason}` : ''}`,
  );
  // If an admin cancelled on someone's behalf, tell the professional too.
  if (!byClient && actor.id !== appt.professional_id) {
    await notify(appt.professional_jid, `🚫 El administrador canceló la cita #${id} (${appt.client_name ?? ''}, ${formatWhen(appt.start_at)}).`);
  }
  return schedRepo.getAppointment(id)!;
}

/** The professional books directly for one of their clients - confirmed immediately. */
export async function scheduleByProfessional(
  actor: User,
  prof: Professional,
  clientId: number,
  startRaw: string,
  durationMinutes: number | undefined,
  reason: string | null,
): Promise<AppointmentView> {
  const isClient = schedRepo.clientsOfProfessional(prof.user_id).some((c) => c.client_user_id === clientId);
  if (!isClient) throw new SchedulingError('Esa persona no está en tus clientes; compártele acceso primero (share_scheduling_access).');
  const start = parseStrictDateTime(startRaw);
  if (!start) throw new SchedulingError(`"${startRaw}" no es una fecha/hora válida ('YYYY-MM-DD HH:mm').`);
  if (start <= nowLocal()) throw new SchedulingError('Esa hora ya pasó.');
  const minutes = durationMinutes && durationMinutes >= 5 && durationMinutes <= 480 ? Math.round(durationMinutes) : prof.slot_minutes;
  const end = addMinutes(start, minutes);

  const id = db.transaction(() => {
    const clash = schedRepo.activeOverlapping(prof.user_id, start, end);
    if (clash.length) throw new SchedulingError(`Se cruza con la cita #${clash[0].id} (${formatWhen(clash[0].start_at)}).`);
    const newId = schedRepo.insertAppointment({
      professional_id: prof.user_id,
      client_user_id: clientId,
      start_at: start,
      end_at: end,
      status: 'confirmed',
      reason: reason?.trim().slice(0, 300) || null,
      created_by: actor.id,
    });
    schedRepo.addEvent(newId, actor.id, 'scheduled_by_professional');
    rebuildReminders(schedRepo.getAppointment(newId)!, prof);
    return newId;
  })();
  const appt = schedRepo.getAppointment(id)!;
  await notify(
    appt.client_jid,
    `📅 *${prof.display_name} te agendó una cita*\n${formatWhen(appt.start_at)}${appt.reason ? ` - ${appt.reason}` : ''}.\n` +
      'Te aviso ese día. Si no puedes asistir, escríbeme para cancelarla.',
  );
  return appt;
}

export function setAppointmentNotes(actor: User, id: number, notes: string | null): AppointmentView {
  loadOwned(id, actor, 'professional');
  schedRepo.setNotes(id, notes?.slice(0, 2000) || null);
  schedRepo.addEvent(id, actor.id, 'notes_updated');
  return schedRepo.getAppointment(id)!;
}

export function statusLabel(s: AppointmentStatus): string {
  return (
    {
      pending: 'pendiente de confirmación',
      confirmed: 'confirmada',
      rejected: 'rechazada',
      cancelled: 'cancelada',
      completed: 'realizada',
      no_show: 'no asistió',
      expired: 'vencida sin confirmar',
    } as const
  )[s];
}

// ---------------------------------------------------------------------------------------------
// Reminders
// ---------------------------------------------------------------------------------------------

/**
 * Recomputes the pending reminders of one appointment for BOTH parties from the professional's
 * policy: the morning of the appointment day at reminder_morning_time (default 07:00 - or 19:00
 * the evening before when the appointment itself is earlier than that), plus optionally N hours
 * before. Only future run times are kept. Must run inside the caller's transaction.
 */
export function rebuildReminders(appt: AppointmentView, prof: Professional): void {
  if (appt.status !== 'confirmed') {
    schedRepo.cancelReminders(appt.id);
    return;
  }
  const now = nowLocal();
  const runs: { kind: 'morning' | 'before'; run_at: string }[] = [];
  if (prof.reminder_morning_time) {
    let at = `${appt.start_at.slice(0, 10)} ${prof.reminder_morning_time}:00`;
    if (at >= appt.start_at) at = `${addDays(appt.start_at, -1).slice(0, 10)} 19:00:00`;
    if (at > now) runs.push({ kind: 'morning', run_at: at });
  }
  if (prof.reminder_hours_before) {
    const at = addMinutes(appt.start_at, -prof.reminder_hours_before * 60);
    const tooClose = runs.some((r) => Math.abs(Date.parse(r.run_at.replace(' ', 'T')) - Date.parse(at.replace(' ', 'T'))) < 30 * 60_000);
    if (at > now && !tooClose) runs.push({ kind: 'before', run_at: at });
  }
  schedRepo.replaceReminders(
    appt.id,
    runs.flatMap((r) => [
      { user_id: appt.client_user_id, ...r },
      { user_id: appt.professional_id, ...r },
    ]),
  );
}

/**
 * Scheduler hook (called every tick from task-scheduler.ts): sends due appointment reminders,
 * expires requests nobody confirmed in time, and closes finished confirmed appointments.
 * Write-before-send like the rest of the scheduler: a crash can skip a reminder, never repeat it.
 */
export async function processSchedulingTick(): Promise<void> {
  const now = nowLocal();

  for (const r of schedRepo.dueReminders(now)) {
    const appt = schedRepo.getAppointment(r.appointment_id);
    // Stale (process was down past the appointment) or no longer confirmed -> drop silently.
    if (!appt || appt.status !== 'confirmed' || appt.start_at <= now) {
      schedRepo.markReminder(r.id, 'cancelled');
      continue;
    }
    schedRepo.markReminder(r.id, 'sent');
    const toClient = r.user_id === appt.client_user_id;
    const when = formatWhen(appt.start_at);
    const text = toClient
      ? `⏰ *Recordatorio de tu cita*\nCon ${appt.professional_name} - ${when}${appt.reason ? ` (${appt.reason})` : ''}.\n¡No la olvides! Si no puedes asistir, avísame para cancelarla.`
      : `⏰ *Recordatorio de cita*\n${appt.client_name ?? 'Cliente'} - ${when}${appt.reason ? ` (${appt.reason})` : ''}.`;
    const jid = toClient ? appt.client_jid : appt.professional_jid;
    if (await notify(jid, text)) recordSend('proactive', jid);
    else schedRepo.markReminder(r.id, 'failed');
  }

  for (const appt of schedRepo.stalePending(now)) {
    db.transaction(() => {
      schedRepo.setStatus(appt.id, 'expired', null);
      schedRepo.addEvent(appt.id, null, 'expired');
    })();
    await notify(
      appt.client_jid,
      `⌛ Tu solicitud de cita con ${appt.professional_name} para el ${formatWhen(appt.start_at)} no alcanzó a ser confirmada. ` +
        'Si aún la necesitas, pide otro horario.',
    );
  }

  for (const appt of schedRepo.finishedConfirmed(now)) {
    db.transaction(() => {
      schedRepo.setStatus(appt.id, 'completed', null);
      schedRepo.addEvent(appt.id, null, 'completed');
    })();
  }
}

// ---------------------------------------------------------------------------------------------
// Sharing access with clients
// ---------------------------------------------------------------------------------------------

export interface ShareResult {
  client: User;
  created: boolean;
  /** Message for the professional to forward when the bot couldn't (or shouldn't) write first. */
  forwardText: string | null;
  notified: boolean;
}

/**
 * A professional shares booking access with a client by phone number. The client gets ONLY the
 * scheduling.client permission (the one thing a professional may grant - everything else stays the
 * administrator's call; an explicit admin 'deny' is respected). Then, per the owner's choice, the
 * bot writes to the client first - through the anti-ban 'cold' budget when they're new to the bot;
 * if that budget is exhausted or the send fails, the professional gets a ready-to-forward text.
 */
export async function shareAccess(actor: User, target: { professionalId?: number; groupId?: number }, phone: string, name: string | null): Promise<ShareResult> {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 7) throw new SchedulingError('Ese número no parece completo (incluye el indicativo, ej. 57 para Colombia).');
  const jid = phoneToJid(digits);
  if (jid === actor.jid) throw new SchedulingError('Ese es tu propio número.');

  const existing = usersRepo.getByJidOrLid(jid);
  if (existing && permissionsRepo.userOverrides(existing.id).some((o) => o.permission_key === 'scheduling.client' && o.effect === 'deny')) {
    throw new SchedulingError('El administrador bloqueó el agendamiento para esa persona.');
  }
  const client = existing ?? usersRepo.create({ jid, name: name?.trim() || null, role: 'user' });
  const created = !existing;

  db.transaction(() => {
    if (client.role !== 'admin' && !effectivePermissions(client).has('scheduling.client')) {
      permissionsRepo.setOverride(actor.id, client.id, 'scheduling.client', 'allow');
    }
    schedRepo.grantClientAccess(client.id, target, actor.id);
    permissionsRepo.recordAudit(actor.id, client.id, 'scheduling.share', target);
  })();
  if (created) ensureDailyResetReminder(client.id, client.jid);

  const prof = target.professionalId ? schedRepo.getProfessional(target.professionalId) : undefined;
  const group = target.groupId ? schedRepo.getGroup(target.groupId) : undefined;
  const withWhom = prof ? professionalLabel(prof) : (group?.name ?? 'tu profesional');
  const botNumber = notifier?.ownPhone?.() ?? null;
  const greeting =
    `👋 Hola${client.name ? ` ${client.name}` : ''}! Soy el asistente de agenda de *${withWhom}*. ` +
    'Desde ahora puedes agendar tus citas conmigo por aquí: escríbeme "quiero una cita" y te muestro los horarios disponibles. ' +
    'Tus citas quedan confirmadas cuando el profesional las aprueba, y te recuerdo el día de la cita.';
  const forwardText =
    `Hola${client.name ? ` ${client.name}` : ''}! Para agendar tus citas conmigo escríbele "quiero una cita" a mi asistente` +
    `${botNumber ? ` al WhatsApp +${botNumber}` : ''}.`;

  let notified = false;
  const isCold = created; // a brand-new user has never written to this number
  const budget = isCold ? checkBudget('cold', env.wa.session) : { ok: true as const };
  if (budget.ok && notifier) {
    const exists = notifier.checkOnWhatsApp ? await notifier.checkOnWhatsApp(jid).catch(() => null) : null;
    if (exists === false) throw new SchedulingError('Ese número no tiene WhatsApp. Revisa que esté completo con el indicativo del país.');
    notified = await notify(jid, greeting);
    if (notified && isCold) recordSend('cold', jid);
  }
  return { client: usersRepo.getById(client.id)!, created, notified, forwardText: notified ? null : forwardText };
}

export function removeClient(actor: User, prof: Professional, clientId: number): boolean {
  const ok = schedRepo.revokeClientAccess(clientId, { professionalId: prof.user_id });
  if (ok) permissionsRepo.recordAudit(actor.id, clientId, 'scheduling.unshare', { professionalId: prof.user_id });
  return ok;
}

/** One line per appointment, for chat replies. */
export function appointmentLine(a: AppointmentView, perspective: 'professional' | 'client'): string {
  const other = perspective === 'professional' ? (a.client_name ?? a.client_jid.split('@')[0]) : a.professional_name;
  return `#${a.id} ${formatWhen(a.start_at)} - ${other} - ${statusLabel(a.status)}${a.reason ? ` (${a.reason})` : ''}`;
}
