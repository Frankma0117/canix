import type { Tool } from '../../agent/tool-registry.js';
import { nowLocal } from '../../util/datetime.js';
import { schedRepo } from '../repo.js';
import {
  bookableProfessionals,
  resolveBookableProfessional,
  slotsFor,
  requestAppointment,
  cancelAppointment,
  appointmentLine,
  professionalLabel,
  SchedulingError,
} from '../service.js';
import { formatDay, formatWhen } from '../slots.js';
import { schedTool, strOrNull } from './common.js';
import { time12h } from '../../util/datetime.js';

const listMyProfessionalsTool = schedTool({
  name: 'list_my_professionals',
  description: 'Lista los profesionales con los que puedo agendar citas.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  async run(_args, me) {
    const list = bookableProfessionals(me.id);
    return list.length ? list.map((p) => `- ${professionalLabel(p)}`).join('\n') : 'Todavía ningún profesional te ha dado acceso para agendar.';
  },
});

const listSlotsTool = schedTool({
  name: 'list_available_slots',
  description:
    'Muestra los espacios disponibles para pedir cita con un profesional (default: los próximos 7 días). Es la ÚNICA ' +
    'fuente válida de horarios - nunca ofrezcas uno que no salga de aquí.',
  parameters: {
    type: 'object',
    properties: {
      professional: { type: 'string', description: 'Nombre del profesional (opcional si solo hay uno).' },
      from_date: { type: 'string', description: "Desde 'YYYY-MM-DD' (default hoy)." },
      days: { type: 'number', description: 'Cuántos días mirar (default 7, máx 31).' },
    },
    additionalProperties: false,
  },
  async run(args, me) {
    const prof = resolveBookableProfessional(me.id, strOrNull(args.professional) ?? undefined);
    const slots = slotsFor(prof, strOrNull(args.from_date) ?? undefined, Number(args.days) || 7);
    if (!slots.length) return `${prof.display_name} no tiene espacios disponibles en esos días. Prueba con otras fechas.`;
    const byDay = new Map<string, string[]>();
    for (const s of slots) {
      const d = s.start_at.slice(0, 10);
      byDay.set(d, [...(byDay.get(d) ?? []), time12h(s.start_at)]);
    }
    const lines = [...byDay].slice(0, 10).map(([d, times]) => `${formatDay(d)} (${d}): ${times.join(', ')}`);
    return `Espacios de ${professionalLabel(prof)} (citas de ${prof.slot_minutes} min):\n${lines.join('\n')}\n(Para pedir una, usa request_appointment con la fecha 'YYYY-MM-DD HH:mm' exacta.)`;
  },
});

const requestAppointmentTool = schedTool({
  name: 'request_appointment',
  description:
    'Pide una cita en un espacio disponible (sacado de list_available_slots). Queda pendiente hasta que el ' +
    'profesional la confirme, salvo que él tenga auto-confirmación.',
  parameters: {
    type: 'object',
    properties: {
      professional: { type: 'string', description: 'Nombre del profesional (opcional si solo hay uno).' },
      start: { type: 'string', description: "Inicio exacto 'YYYY-MM-DD HH:mm' de un espacio disponible." },
      reason: { type: 'string', description: 'Motivo de la cita (opcional).' },
    },
    required: ['start'],
    additionalProperties: false,
  },
  async run(args, me) {
    const prof = resolveBookableProfessional(me.id, strOrNull(args.professional) ?? undefined);
    const a = await requestAppointment(me, prof, String(args.start ?? ''), strOrNull(args.reason));
    return a.status === 'confirmed'
      ? `Listo, tu cita #${a.id} con ${prof.display_name} quedó CONFIRMADA para el ${formatWhen(a.start_at)}. Te la recuerdo ese día.`
      : `Listo, pedí tu cita #${a.id} con ${prof.display_name} para el ${formatWhen(a.start_at)}. Queda PENDIENTE hasta que la confirme; te aviso apenas lo haga.`;
  },
});

const listMyAppointmentsTool = schedTool({
  name: 'list_my_appointments',
  description: 'Lista mis próximas citas (como cliente) con su estado.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  async run(_args, me) {
    const list = schedRepo.listForClient(me.id, nowLocal()).filter((a) => ['pending', 'confirmed'].includes(a.status));
    return list.length ? list.map((a) => `- ${appointmentLine(a, 'client')}`).join('\n') : 'No tienes citas próximas.';
  },
});

const cancelMyAppointmentTool = schedTool({
  name: 'cancel_my_appointment',
  description: 'Cancela una de mis citas (como cliente) por su número; le aviso al profesional.',
  parameters: {
    type: 'object',
    properties: { id: { type: 'number' }, reason: { type: 'string' } },
    required: ['id'],
    additionalProperties: false,
  },
  async run(args, me) {
    const appt = schedRepo.getAppointment(Number(args.id));
    if (!appt || appt.client_user_id !== me.id) throw new SchedulingError(`No encontré la cita #${args.id} entre las tuyas.`);
    const a = await cancelAppointment(me, appt.id, strOrNull(args.reason));
    return `Listo, cancelé tu cita #${a.id} del ${formatWhen(a.start_at)} y le avisé a ${a.professional_name}.`;
  },
});

export const clientTools: Tool[] = [listMyProfessionalsTool, listSlotsTool, requestAppointmentTool, listMyAppointmentsTool, cancelMyAppointmentTool];
