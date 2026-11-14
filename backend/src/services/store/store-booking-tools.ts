import type OpenAI from 'openai';
import { addDays, normalizeDate, todayLocal } from '../../shared/utils/datetime.js';
import { formatDay, formatWhen } from '../scheduling/slots.js';
import type { Store, StoreCustomer } from '../../entities/index.js';
import { money } from './store-pricing.js';
import {
  bookAppointment,
  cancelAppointment,
  customerAppointments,
  freeSlots,
  knowledgeRepo,
  listServices,
  rescheduleAppointment,
  shownSlots,
  staffRepo,
} from './store-booking.service.js';

/** Extra tools of the store assistant when the business sells bookable services (see store-booking.service.ts). */

const fn = (name: string, description: string, properties: Record<string, unknown>, required: string[] = []): OpenAI.Chat.Completions.ChatCompletionTool => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required } },
});

export const BOOKING_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  fn('list_services', 'Lista los servicios que se pueden agendar, con precio y duración.', {}),
  fn(
    'check_availability',
    'Horarios libres de un servicio entre dos fechas. Úsala SIEMPRE antes de ofrecer una hora: nunca inventes horarios.',
    {
      service_id: { type: 'integer' },
      from_date: { type: 'string', description: 'YYYY-MM-DD. Si el cliente no dice fecha, usa hoy.' },
      to_date: { type: 'string', description: 'YYYY-MM-DD. Por defecto 7 días después de from_date.' },
      staff_id: { type: 'integer', description: 'Opcional: solo esa persona (si el cliente pide a alguien en particular).' },
    },
    ['service_id'],
  ),
  fn(
    'book_appointment',
    'Agenda la cita. SOLO con una hora que salió en check_availability y después de que el cliente la elija y confirme.',
    {
      service_id: { type: 'integer' },
      start_at: { type: 'string', description: 'Exactamente como lo devolvió check_availability: YYYY-MM-DD HH:mm:ss.' },
      staff_id: { type: 'integer', description: 'Opcional: la persona elegida.' },
      notes: { type: 'string', description: 'Indicaciones del cliente para la cita.' },
    },
    ['service_id', 'start_at'],
  ),
  fn('my_appointments', 'Citas próximas del cliente.', {}),
  fn('cancel_appointment', 'Cancela una cita próxima del cliente.', { appointment_id: { type: 'integer' }, reason: { type: 'string' } }, ['appointment_id']),
  fn(
    'reschedule_appointment',
    'Mueve una cita a otra hora libre (de check_availability).',
    { appointment_id: { type: 'integer' }, new_start_at: { type: 'string', description: 'YYYY-MM-DD HH:mm:ss' } },
    ['appointment_id', 'new_start_at'],
  ),
  fn(
    'search_knowledge',
    'Busca en la información del negocio (políticas, cuidados, preguntas frecuentes). Úsala antes de responder lo que no esté en el catálogo.',
    { query: { type: 'string' } },
    ['query'],
  ),
];

const int = (v: unknown): number => Math.trunc(Number(v));
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** Block appended to the system prompt of stores that sell services. */
export function bookingPromptBlock(store: Store): string {
  const services = listServices(store.id);
  const staff = staffRepo.list(store.id, true);
  const topics = knowledgeRepo.list(store.id).map((k) => k.title);
  return (
    `\n\nCITAS: este negocio agenda servicios (${services.map((s) => `${s.name} ${s.duration_min} min`).join('; ')}).\n` +
    `Equipo: ${staff.length ? staff.map((s) => `${s.name}${s.specialty ? ` (${s.specialty})` : ''}`).join(', ') : '(sin personas cargadas: no puedes agendar, pasa con una persona)'}.\n` +
    '- Antes de ofrecer horas usa check_availability; nunca inventes horarios. Ofrece 3-5 opciones, no todas.\n' +
    '- Agenda con book_appointment solo cuando el cliente elija una hora y confirme servicio, persona (si importa) y hora. Después repítele la cita: servicio, día, hora y con quién.\n' +
    '- Cambios y cancelaciones: my_appointments, reschedule_appointment, cancel_appointment. Nunca digas que agendaste, moviste o cancelaste sin llamar a la herramienta.\n' +
    (topics.length ? `- Información del negocio disponible con search_knowledge: ${topics.join(', ')}.\n` : '')
  );
}

/** Runs a booking tool; returns null when `name` is not one of them. */
export async function runBookingTool(name: string, args: Record<string, unknown>, store: Store, customer: StoreCustomer): Promise<string | null> {
  switch (name) {
    case 'list_services': {
      const services = listServices(store.id);
      if (!services.length) return 'Este negocio no tiene servicios agendables cargados.';
      return services.map((s) => `[${s.id}] ${s.name} · ${s.duration_min} min · ${money(s.price)}${s.description ? ` — ${s.description}` : ''}`).join('\n');
    }
    case 'check_availability': {
      const from = str(args.from_date) ? normalizeDate(String(args.from_date)).slice(0, 10) : todayLocal();
      const to = str(args.to_date) ? normalizeDate(String(args.to_date)).slice(0, 10) : addDays(from, 7).slice(0, 10);
      const slots = shownSlots(freeSlots(store.id, int(args.service_id), from, to, args.staff_id ? int(args.staff_id) : undefined));
      if (!slots.length) return `Sin horarios libres entre ${formatDay(from)} y ${formatDay(to)}. Propón otras fechas o pasa con una persona.`;
      return slots.map((s) => `${s.start_at} → ${formatWhen(s.start_at)} con ${s.staff_name} (staff_id ${s.staff_id})`).join('\n');
    }
    case 'book_appointment': {
      const res = await bookAppointment(store, customer, {
        productId: int(args.service_id),
        startAt: String(args.start_at ?? ''),
        staffId: args.staff_id ? int(args.staff_id) : undefined,
        notes: str(args.notes),
      });
      if (!res.ok) return res.error;
      const a = res.appointment;
      return `CITA AGENDADA #${a.id}: ${a.service_name} con ${a.staff_name}, ${formatWhen(a.start_at)} (termina ${a.end_at.slice(11, 16)}). Se avisó al negocio.`;
    }
    case 'my_appointments': {
      const list = customerAppointments(customer.id);
      return list.length ? list.map((a) => `#${a.id} ${a.service_name} con ${a.staff_name}, ${formatWhen(a.start_at)}`).join('\n') : 'El cliente no tiene citas próximas.';
    }
    case 'cancel_appointment': {
      const a = await cancelAppointment(store, customer, int(args.appointment_id), str(args.reason));
      return a ? `Cita #${a.id} (${a.service_name}, ${formatWhen(a.start_at)}) cancelada. Se avisó al negocio.` : 'No encuentro esa cita activa del cliente.';
    }
    case 'reschedule_appointment': {
      const res = await rescheduleAppointment(store, customer, int(args.appointment_id), String(args.new_start_at ?? ''));
      return res.ok ? `CITA MOVIDA a ${formatWhen(res.appointment.start_at)} con ${res.appointment.staff_name} (nueva cita #${res.appointment.id}).` : res.error;
    }
    case 'search_knowledge': {
      const found = knowledgeRepo.search(store.id, String(args.query ?? ''));
      return found.length
        ? found.map((k) => `${k.title}: ${k.content}`).join('\n\n')
        : 'No hay información cargada sobre eso. No inventes: si el cliente lo necesita, pasa con una persona.';
    }
    default:
      return null;
  }
}
