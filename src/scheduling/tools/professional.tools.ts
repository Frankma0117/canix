import type { Tool } from '../../agent/tool-registry.js';
import { addDays, nowLocal, todayLocal } from '../../util/datetime.js';
import { schedRepo, type AppointmentStatus } from '../repo.js';
import {
  ensureProfessional,
  setAvailability,
  updateSettings,
  blockTime,
  confirmAppointment,
  rejectAppointment,
  cancelAppointment,
  scheduleByProfessional,
  shareAccess,
  removeClient,
  appointmentLine,
  professionalLabel,
  SchedulingError,
  type WeeklyRuleInput,
} from '../service.js';
import { formatWhen } from '../slots.js';
import { schedTool, parseWeekday, resolveClientOf, strOrNull } from './common.js';

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

const setAvailabilityTool = schedTool({
  name: 'set_availability',
  description:
    'Define (REEMPLAZA completo) mi horario semanal de atención para citas. Pasa TODOS los bloques que quiero ' +
    'que queden, no solo el que cambia. Ej. lunes a viernes 8-12 y 14-18 = dos bloques con days=[lunes..viernes]. ' +
    'Lista vacía = no recibo citas.',
  parameters: {
    type: 'object',
    properties: {
      blocks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            days: { type: 'array', items: { type: 'string' }, description: 'Días: lunes, martes, ... domingo.' },
            start: { type: 'string', description: "Hora inicio 'HH:mm' (24h)." },
            end: { type: 'string', description: "Hora fin 'HH:mm' (24h)." },
          },
          required: ['days', 'start', 'end'],
          additionalProperties: false,
        },
      },
    },
    required: ['blocks'],
    additionalProperties: false,
  },
  async run(args, me) {
    const prof = ensureProfessional(me);
    const blocks = Array.isArray(args.blocks) ? (args.blocks as Record<string, unknown>[]) : [];
    const rules: WeeklyRuleInput[] = [];
    for (const b of blocks) {
      const days = Array.isArray(b.days) ? b.days : [];
      for (const d of days) {
        const wd = parseWeekday(d);
        if (wd === null) throw new SchedulingError(`No entiendo el día "${d}".`);
        rules.push({ weekday: wd, start: String(b.start ?? ''), end: String(b.end ?? '') });
      }
    }
    setAvailability(prof, rules);
    if (!rules.length) return 'Listo, quedaste sin horario de atención: nadie podrá pedirte citas hasta que lo definas.';
    return `Listo, tu horario de atención quedó: ${rules.map((r) => `${WEEKDAYS[r.weekday]} ${r.start}-${r.end}`).join(', ')}. Citas de ${prof.slot_minutes} min.`;
  },
});

const viewAvailabilityTool = schedTool({
  name: 'view_availability',
  description: 'Muestra mi horario de atención, mis bloqueos próximos y la configuración de mi agenda.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  async run(_args, me) {
    const prof = ensureProfessional(me);
    const rules = schedRepo.availability(prof.user_id);
    const blocks = schedRepo.timeOff(prof.user_id, nowLocal(), addDays(nowLocal(), 120));
    return [
      `Perfil: ${professionalLabel(prof)}`,
      `Horario: ${rules.length ? rules.map((r) => `${WEEKDAYS[r.weekday]} ${r.start_time}-${r.end_time}`).join(', ') : '(sin definir)'}`,
      `Citas de ${prof.slot_minutes} min, ${prof.buffer_minutes} min entre citas, anticipación mínima ${prof.min_notice_minutes} min, hasta ${prof.max_days_ahead} días adelante.`,
      `Recordatorios: ${prof.reminder_morning_time ? `día de la cita a las ${prof.reminder_morning_time}` : 'mañana apagado'}${prof.reminder_hours_before ? `, y ${prof.reminder_hours_before}h antes` : ''}. Auto-confirmar: ${prof.auto_confirm ? 'sí' : 'no'}.`,
      `Bloqueos próximos: ${blocks.length ? blocks.map((b) => `#${b.id} ${b.start_at.slice(0, 16)} → ${b.end_at.slice(0, 16)}${b.reason ? ` (${b.reason})` : ''}`).join('; ') : 'ninguno'}`,
    ].join('\n');
  },
});

const blockTimeTool = schedTool({
  name: 'block_time',
  description: 'Bloquea un rango de tiempo en mi agenda (vacaciones, imprevisto) para que nadie pueda pedir citas ahí. No cancela citas ya existentes.',
  parameters: {
    type: 'object',
    properties: {
      start: { type: 'string', description: "Inicio 'YYYY-MM-DD HH:mm'." },
      end: { type: 'string', description: "Fin 'YYYY-MM-DD HH:mm'." },
      reason: { type: 'string' },
    },
    required: ['start', 'end'],
    additionalProperties: false,
  },
  async run(args, me) {
    const prof = ensureProfessional(me);
    const id = blockTime(prof, String(args.start ?? ''), String(args.end ?? ''), strOrNull(args.reason));
    const block = schedRepo.timeOff(prof.user_id, '0000', '9999').find((b) => b.id === id)!;
    const clashes = schedRepo.activeOverlapping(prof.user_id, block.start_at, block.end_at);
    const warn = clashes.length ? ` Ojo: ya tienes ${clashes.length} cita(s) en ese rango (${clashes.map((c) => `#${c.id}`).join(', ')}) - no las cancelé.` : '';
    return `Listo, bloqueé ese tiempo (bloqueo #${id}).${warn}`;
  },
});

const unblockTimeTool = schedTool({
  name: 'unblock_time',
  description: 'Quita un bloqueo de mi agenda por su número (ver view_availability).',
  parameters: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'], additionalProperties: false },
  async run(args, me) {
    const prof = ensureProfessional(me);
    return schedRepo.deleteTimeOff(prof.user_id, Number(args.id)) ? 'Listo, quité el bloqueo.' : `No encontré el bloqueo #${args.id}.`;
  },
});

const STATUS_FILTER: Record<string, AppointmentStatus[]> = {
  activas: ['pending', 'confirmed'],
  pendientes: ['pending'],
  confirmadas: ['confirmed'],
  todas: [],
};

const listAppointmentsTool = schedTool({
  name: 'list_appointments',
  description: 'Lista las citas de mi agenda en un rango de días (default: desde hoy, 7 días, solo activas).',
  parameters: {
    type: 'object',
    properties: {
      from_date: { type: 'string', description: "Desde 'YYYY-MM-DD' (default hoy)." },
      days: { type: 'number', description: 'Cuántos días (default 7, máx 62).' },
      status: { type: 'string', enum: ['activas', 'pendientes', 'confirmadas', 'todas'] },
    },
    additionalProperties: false,
  },
  async run(args, me) {
    const prof = ensureProfessional(me);
    const from = /^\d{4}-\d{2}-\d{2}$/.test(String(args.from_date ?? '')) ? String(args.from_date) : todayLocal();
    const days = Math.min(Math.max(Number(args.days) || 7, 1), 62);
    const statuses = STATUS_FILTER[String(args.status ?? 'activas')] ?? STATUS_FILTER.activas;
    const list = schedRepo.listForProfessional(prof.user_id, `${from} 00:00:00`, `${addDays(from, days).slice(0, 10)} 00:00:00`, statuses);
    return list.length ? list.map((a) => `- ${appointmentLine(a, 'professional')}`).join('\n') : 'No tienes citas en ese rango.';
  },
});

const confirmAppointmentTool = schedTool({
  name: 'confirm_appointment',
  description: 'Confirma una solicitud de cita pendiente por su número (le aviso al cliente y quedan los recordatorios).',
  parameters: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'], additionalProperties: false },
  async run(args, me) {
    const a = await confirmAppointment(me, Number(args.id));
    return `Listo, confirmé la cita #${a.id} con ${a.client_name ?? 'el cliente'} (${formatWhen(a.start_at)}) y le avisé.`;
  },
});

const rejectAppointmentTool = schedTool({
  name: 'reject_appointment',
  description: 'Rechaza una solicitud de cita pendiente (le aviso al cliente, con el motivo si lo das).',
  parameters: {
    type: 'object',
    properties: { id: { type: 'number' }, reason: { type: 'string' } },
    required: ['id'],
    additionalProperties: false,
  },
  async run(args, me) {
    const a = await rejectAppointment(me, Number(args.id), strOrNull(args.reason));
    return `Listo, rechacé la solicitud #${a.id} y le avisé a ${a.client_name ?? 'el cliente'}.`;
  },
});

const cancelAppointmentTool = schedTool({
  name: 'cancel_appointment',
  description: 'Cancela una cita de mi agenda (pendiente o confirmada) por su número; le aviso al cliente.',
  parameters: {
    type: 'object',
    properties: { id: { type: 'number' }, reason: { type: 'string' } },
    required: ['id'],
    additionalProperties: false,
  },
  async run(args, me) {
    const a = await cancelAppointment(me, Number(args.id), strOrNull(args.reason));
    return `Listo, cancelé la cita #${a.id} (${formatWhen(a.start_at)}) y le avisé a ${a.client_name ?? 'el cliente'}.`;
  },
});

const scheduleAppointmentTool = schedTool({
  name: 'schedule_appointment',
  description:
    'Yo (profesional) agendo directamente una cita a uno de mis clientes - queda confirmada y le aviso. Puede ser ' +
    'fuera de mi horario habitual, pero no puede cruzarse con otra cita.',
  parameters: {
    type: 'object',
    properties: {
      client: { type: 'string', description: 'Nombre o número del cliente (debe tener acceso compartido).' },
      start: { type: 'string', description: "Inicio 'YYYY-MM-DD HH:mm'." },
      duration_minutes: { type: 'number', description: 'Duración (default: la de mi agenda).' },
      reason: { type: 'string' },
    },
    required: ['client', 'start'],
    additionalProperties: false,
  },
  async run(args, me) {
    const prof = ensureProfessional(me);
    const client = resolveClientOf(prof.user_id, String(args.client ?? ''));
    const a = await scheduleByProfessional(me, prof, client.client_user_id, String(args.start ?? ''), Number(args.duration_minutes) || undefined, strOrNull(args.reason));
    return `Listo, agendé la cita #${a.id} con ${a.client_name ?? 'el cliente'} para el ${formatWhen(a.start_at)} (confirmada) y le avisé.`;
  },
});

const shareAccessTool = schedTool({
  name: 'share_scheduling_access',
  description:
    'Le doy acceso a una persona para que agende citas conmigo (solo agendar, nada más). Le escribo por WhatsApp ' +
    'para avisarle; si no se puede, te doy un mensaje para que se lo reenvíes.',
  parameters: {
    type: 'object',
    properties: {
      phone: { type: 'string', description: 'Número con indicativo (ej. 573001234567).' },
      name: { type: 'string', description: 'Nombre de la persona.' },
    },
    required: ['phone'],
    additionalProperties: false,
  },
  async run(args, me) {
    const prof = ensureProfessional(me);
    const r = await shareAccess(me, { professionalId: prof.user_id }, String(args.phone ?? ''), strOrNull(args.name));
    const who = r.client.name ?? r.client.jid.split('@')[0];
    if (r.notified) return `Listo, ${who} ya puede agendar contigo y le escribí para avisarle.`;
    return `Listo, ${who} ya puede agendar contigo, pero no pude escribirle ahora (límite anti-bloqueo de WhatsApp o número sin chat). Reenvíale esto:\n\n"${r.forwardText}"`;
  },
});

const listClientsTool = schedTool({
  name: 'list_scheduling_clients',
  description: 'Lista las personas que pueden agendar citas conmigo.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  async run(_args, me) {
    const prof = ensureProfessional(me);
    const clients = schedRepo.clientsOfProfessional(prof.user_id);
    if (!clients.length) return 'Todavía nadie puede agendar contigo. Usa share_scheduling_access con su número.';
    return clients
      .map((c) => `- ${c.client_name ?? '(sin nombre)'} (${c.client_jid.split('@')[0]})${c.group_name ? ` - vía grupo ${c.group_name}` : ''}`)
      .join('\n');
  },
});

const removeClientTool = schedTool({
  name: 'remove_scheduling_client',
  description: 'Le quito a una persona el acceso a agendar conmigo (sus citas ya existentes no se cancelan).',
  parameters: { type: 'object', properties: { client: { type: 'string' } }, required: ['client'], additionalProperties: false },
  async run(args, me) {
    const prof = ensureProfessional(me);
    const c = resolveClientOf(prof.user_id, String(args.client ?? ''));
    if (c.group_id) return `${c.client_name} tiene acceso por el grupo "${c.group_name}"; eso solo lo cambia el administrador.`;
    removeClient(me, prof, c.client_user_id);
    return `Listo, ${c.client_name ?? 'esa persona'} ya no puede agendar contigo.`;
  },
});

const setSettingsTool = schedTool({
  name: 'set_scheduling_settings',
  description:
    'Cambia la configuración de mi agenda: nombre a mostrar, especialidad, duración de cita, minutos entre citas, ' +
    'anticipación mínima, días hacia adelante, recordatorios (hora del día de la cita y/o horas antes) y auto-confirmar.',
  parameters: {
    type: 'object',
    properties: {
      display_name: { type: 'string' },
      specialty: { type: 'string' },
      slot_minutes: { type: 'number' },
      buffer_minutes: { type: 'number' },
      min_notice_minutes: { type: 'number' },
      max_days_ahead: { type: 'number' },
      reminder_morning_time: { type: 'string', description: "'HH:mm', o 'off' para apagar." },
      reminder_hours_before: { type: 'number', description: 'Horas antes (1-72), o 0 para apagar.' },
      auto_confirm: { type: 'boolean', description: 'true = las solicitudes quedan confirmadas sin mi aprobación.' },
    },
    additionalProperties: false,
  },
  async run(args, me) {
    const prof = ensureProfessional(me);
    const num = (v: unknown) => (v === undefined ? undefined : Number(v));
    const updated = updateSettings(prof, {
      display_name: args.display_name !== undefined ? String(args.display_name) : undefined,
      specialty: args.specialty !== undefined ? String(args.specialty) : undefined,
      slot_minutes: num(args.slot_minutes),
      buffer_minutes: num(args.buffer_minutes),
      min_notice_minutes: num(args.min_notice_minutes),
      max_days_ahead: num(args.max_days_ahead),
      reminder_morning_time:
        args.reminder_morning_time === undefined ? undefined : String(args.reminder_morning_time).toLowerCase() === 'off' ? null : String(args.reminder_morning_time),
      reminder_hours_before: args.reminder_hours_before === undefined ? undefined : Number(args.reminder_hours_before) === 0 ? null : Number(args.reminder_hours_before),
      auto_confirm: args.auto_confirm === undefined ? undefined : Boolean(args.auto_confirm),
    });
    return `Listo. Agenda: ${professionalLabel(updated)}, citas de ${updated.slot_minutes} min, ${updated.buffer_minutes} min entre citas, recordatorio ${updated.reminder_morning_time ?? 'de la mañana apagado'}${updated.reminder_hours_before ? ` y ${updated.reminder_hours_before}h antes` : ''}, auto-confirmar ${updated.auto_confirm ? 'sí' : 'no'}.`;
  },
});

export const professionalTools: Tool[] = [
  setAvailabilityTool,
  viewAvailabilityTool,
  blockTimeTool,
  unblockTimeTool,
  listAppointmentsTool,
  confirmAppointmentTool,
  rejectAppointmentTool,
  cancelAppointmentTool,
  scheduleAppointmentTool,
  shareAccessTool,
  listClientsTool,
  removeClientTool,
  setSettingsTool,
];
