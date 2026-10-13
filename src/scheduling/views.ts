import { addMinutes, nowLocal } from '../util/datetime.js';
import { footnote, keycap, timeChip } from '../util/wa-format.js';
import { dayLabel, prettyPhone } from '../agent/views.js';
import { schedRepo, type AppointmentStatus, type AppointmentView, type ClientAccessRow, type Professional } from './repo.js';
import type { Slot } from './slots.js';

/**
 * How appointments look on WhatsApp - the same designed language as the rest of Canix (agenda.ts,
 * agent/views.ts): a bold title with its icon, one fact per line each with its own icon, times as
 * chips, and what can be done next as a quiet footer. Everything here is built from the stored
 * appointment; nothing is worded by the model.
 */

type Side = 'professional' | 'client';

const STATUS: Record<AppointmentStatus, string> = {
  pending: '🟡 Por confirmar',
  confirmed: '🟢 Confirmada',
  rejected: '❌ Rechazada',
  cancelled: '🚫 Cancelada',
  completed: '✅ Realizada',
  no_show: '⚪ No asistió',
  expired: '⌛ Venció sin confirmar',
};

const idChip = (id: number) => `\`#${id}\``;
const phoneOf = (jid: string) => prettyPhone(jid.split('@')[0]);

/** Who the appointment is with, from one side: the client's name (or number), or the professional. */
export function otherParty(a: AppointmentView, side: Side): string {
  if (side === 'client') return a.professional_name;
  return a.client_name?.trim() || phoneOf(a.client_jid);
}

const timeRange = (a: { start_at: string; end_at: string }) => `${timeChip(a.start_at)} a ${timeChip(a.end_at)}`;

/**
 * One appointment as a card:
 *   📅 *Nueva solicitud de cita* `#12`
 *
 *   👤 *Laura Gómez* · +57 311 569 2818
 *   🗓️ Mañana · miércoles 14 de octubre
 *   🕓 `2:00 pm` a `2:30 pm`
 *   📝 Control
 */
export function appointmentCard(title: string, a: AppointmentView, side: Side, opts: { status?: boolean; note?: string } = {}): string {
  const who =
    side === 'professional'
      ? `👤 *${otherParty(a, side)}*${a.client_name?.trim() ? ` · ${phoneOf(a.client_jid)}` : ''}`
      : `🧑‍⚕️ *${a.professional_name}*`;
  const lines = [`${title} ${idChip(a.id)}`, '', who, `🗓️ ${dayLabel(a.start_at.slice(0, 10))}`, `🕓 ${timeRange(a)}`];
  if (a.reason) lines.push(`📝 ${a.reason}`);
  if (opts.status) lines.push(STATUS[a.status]);
  if (opts.note) lines.push('', opts.note);
  return lines.join('\n');
}

function byDay<T extends { start_at: string }>(items: T[]): [string, T[]][] {
  const days = new Map<string, T[]>();
  for (const item of items) {
    const day = item.start_at.slice(0, 10);
    days.set(day, [...(days.get(day) ?? []), item]);
  }
  return [...days.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function appointmentRows(list: AppointmentView[], side: Side): string[] {
  const lines: string[] = [];
  for (const a of [...list].sort((x, y) => x.start_at.localeCompare(y.start_at))) {
    lines.push(`${timeChip(a.start_at)} ${side === 'professional' ? '👤' : '🧑‍⚕️'} *${otherParty(a, side)}* ${idChip(a.id)}`);
    lines.push(`> ${STATUS[a.status]}${a.reason ? ` · ${a.reason}` : ''}`);
  }
  return lines;
}

/** A list of appointments grouped by day, with what can be done with them underneath. */
export function appointmentsView(list: AppointmentView[], side: Side, opts: { title?: string; empty?: string } = {}): string {
  const title = opts.title ?? (side === 'professional' ? 'Tu agenda de citas' : 'Tus citas');
  if (list.length === 0) return `📅 *${title}*\n${opts.empty ?? (side === 'professional' ? 'No tienes citas en esas fechas.' : 'No tienes citas próximas.')}`;

  const lines = [`📅 *${title}* · ${list.length}`];
  for (const [day, items] of byDay(list)) lines.push('', `*${dayLabel(day)}*`, ...appointmentRows(items, side));

  const pending = list.filter((a) => a.status === 'pending');
  if (side === 'professional') {
    const sample = (pending[0] ?? list[0]).id;
    lines.push('', pending.length ? footnote(`${pending.length} por confirmar`, `Escribe "confirmar cita ${sample}" o "rechazar cita ${sample}"`) : footnote(`Para cancelar una: "cancelar cita ${sample}"`));
  } else {
    lines.push('', footnote(`Para cancelar una: "cancelar cita ${list[0].id}"`));
  }
  return lines.join('\n');
}

/**
 * The appointments of one day as a block for the daily agenda ("qué tengo hoy") - empty when the
 * person has none that day, on either side.
 */
export function dayAppointmentsBlock(userId: number, date: string): string[] {
  const from = `${date} 00:00:00`;
  const to = `${date} 23:59:59`;
  const asProfessional = schedRepo.getProfessional(userId) ? schedRepo.listForProfessional(userId, from, to, ['pending', 'confirmed']) : [];
  const asClient = schedRepo
    .listForClient(userId, from)
    .filter((a) => a.start_at <= to && ['pending', 'confirmed'].includes(a.status) && a.professional_id !== userId);
  if (asProfessional.length + asClient.length === 0) return [];
  return ['', '📅 *CITAS*', ...appointmentRows(asProfessional, 'professional'), ...appointmentRows(asClient, 'client')];
}

/** Free slots grouped by day, as chips: what a client picks from. */
export function slotsView(prof: Professional, slots: Slot[]): string {
  const name = prof.display_name;
  if (slots.length === 0) return `🗓️ *Horarios disponibles* · ${name}\nNo hay espacios libres en esos días.\n\n${footnote('Pídeme otras fechas: "horarios de la otra semana"')}`;
  const lines = [`🗓️ *Horarios disponibles* · ${name}`, `> Citas de ${prof.slot_minutes} min`];
  const days = byDay(slots);
  for (const [day, items] of days.slice(0, 10)) {
    lines.push('', `*${dayLabel(day)}*`);
    // a handful per line so a busy day doesn't become one unreadable row
    for (let i = 0; i < items.length; i += 4) lines.push(items.slice(i, i + 4).map((s) => timeChip(s.start_at)).join('  '));
  }
  if (days.length > 10) lines.push('', `_… y ${days.length - 10} día(s) más_`);
  lines.push('', footnote('Dime el día y la hora que prefieres y la pido'));
  return lines.join('\n');
}

const WEEKDAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const SHORT_MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const shortDate = (at: string) => `${Number(at.slice(8, 10))} ${SHORT_MONTHS[Number(at.slice(5, 7)) - 1]}`;

/** "Lunes a viernes" / "Lunes, miércoles y viernes" for a set of weekdays (Monday first). */
function daysLabel(days: number[]): string {
  const order = [1, 2, 3, 4, 5, 6, 0];
  const sorted = [...days].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const consecutive = sorted.every((d, i) => i === 0 || order.indexOf(d) === order.indexOf(sorted[i - 1]) + 1);
  if (sorted.length >= 3 && consecutive) return `${WEEKDAYS[sorted[0]]} a ${WEEKDAYS[sorted[sorted.length - 1]].toLowerCase()}`;
  const names = sorted.map((d, i) => (i === 0 ? WEEKDAYS[d] : WEEKDAYS[d].toLowerCase()));
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`;
}

/** The weekly hours with equal days folded together: "Lunes a viernes · 8:00 am a 12:00 pm". */
export function scheduleLines(rules: { weekday: number; start_time: string; end_time: string }[]): string[] {
  const order = [1, 2, 3, 4, 5, 6, 0];
  // each day's blocks as one text ("8:00 am a 12:00 pm y 2:00 pm a 6:00 pm"), then days that share it together
  const perDay = new Map<number, string[]>();
  for (const r of [...rules].sort((a, b) => a.start_time.localeCompare(b.start_time))) {
    perDay.set(r.weekday, [...(perDay.get(r.weekday) ?? []), `${timeChip(r.start_time)} a ${timeChip(r.end_time)}`]);
  }
  const byHours = new Map<string, number[]>();
  for (const day of order) {
    const hours = perDay.get(day)?.join(' y ');
    if (hours) byHours.set(hours, [...(byHours.get(hours) ?? []), day]);
  }
  return [...byHours.entries()].map(([hours, days]) => `- *${daysLabel(days)}* · ${hours}`);
}

const minutesLabel = (m: number) => (m >= 60 && m % 60 === 0 ? `${m / 60} h` : `${m} min`);

/** The professional's own setup: hours, how appointments work, and blocked time. */
export function availabilityView(prof: Professional): string {
  const rules = schedRepo.availability(prof.user_id);
  const blocks = schedRepo.timeOff(prof.user_id, nowLocal(), addMinutes(nowLocal(), 120 * 24 * 60));
  const lines = [`🗓️ *Tu agenda de citas* · ${prof.display_name}${prof.specialty ? ` (${prof.specialty})` : ''}`, '', '🕘 *Horario de atención*'];
  lines.push(...(rules.length ? scheduleLines(rules) : ['Todavía no lo has definido: nadie puede pedirte citas.']));

  lines.push(
    '',
    '⚙️ *Cómo funcionan tus citas*',
    `- Duran ${minutesLabel(prof.slot_minutes)}${prof.buffer_minutes ? `, con ${minutesLabel(prof.buffer_minutes)} entre una y otra` : ''}`,
    `- Se piden con mínimo ${minutesLabel(prof.min_notice_minutes)} de anticipación y hasta ${prof.max_days_ahead} días adelante`,
    `- ${prof.auto_confirm ? 'Quedan confirmadas solas' : 'Tú confirmas cada solicitud'}`,
    `- Recordatorio: ${[prof.reminder_morning_time ? `el día de la cita a las ${timeChip(prof.reminder_morning_time)}` : null, prof.reminder_hours_before ? `${prof.reminder_hours_before} h antes` : null].filter(Boolean).join(' y ') || 'apagado'}`,
  );

  if (blocks.length) {
    lines.push('', '🚫 *Tiempo bloqueado*');
    for (const b of blocks) lines.push(`- ${idChip(b.id)} ${shortDate(b.start_at)} ${timeChip(b.start_at)} → ${shortDate(b.end_at)} ${timeChip(b.end_at)}${b.reason ? ` · ${b.reason}` : ''}`);
  }
  lines.push('', footnote('Cámbialo hablando normal: "atiendo lunes a viernes de 8 a 12", "bloquea el viernes", "citas de 45 minutos"'));
  return lines.join('\n');
}

/** The people who can book with this professional. */
export function clientsView(clients: ClientAccessRow[]): string {
  const unique = [...new Map(clients.map((c) => [c.client_user_id, c])).values()];
  if (unique.length === 0) return `👥 *Tus clientes*\nTodavía nadie puede agendar contigo.\n\n${footnote('Pásame el número (con indicativo) y el nombre, y le doy acceso')}`;
  const lines = [`👥 *Tus clientes* · ${unique.length}`, ''];
  unique.forEach((c, i) => {
    lines.push(`${keycap(i + 1)}  *${c.client_name?.trim() || 'Sin nombre'}*`);
    lines.push(`> ${phoneOf(c.client_jid)}${c.group_name ? ` · por el grupo ${c.group_name}` : ''}`);
  });
  lines.push('', footnote('"dale acceso a 573001234567, Laura" · "quítale el acceso a Laura"'));
  return lines.join('\n');
}

/** The professionals a client can book with. */
export function professionalsView(profs: Professional[]): string {
  if (profs.length === 0) return '🧑‍⚕️ *Tus profesionales*\nTodavía ningún profesional te ha dado acceso para agendar.';
  const lines = [`🧑‍⚕️ *Tus profesionales* · ${profs.length}`, ''];
  profs.forEach((p, i) => lines.push(`${keycap(i + 1)}  *${p.display_name}*${p.specialty ? ` · ${p.specialty}` : ''}`));
  lines.push('', footnote('Escribe "quiero una cita" y te muestro los horarios'));
  return lines.join('\n');
}
