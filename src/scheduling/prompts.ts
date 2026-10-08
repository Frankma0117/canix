import { currentTimeContext, upcomingDaysContext, nowLocal, todayLocal, addDays } from '../util/datetime.js';
import { schedRepo } from './repo.js';
import { bookableProfessionals, professionalLabel, appointmentLine } from './service.js';
import { formatDay } from './slots.js';

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

const SHARED_RULES = `
- Los espacios disponibles SOLO salen de list_available_slots - nunca inventes ni supongas un
  horario, y nunca ofrezcas uno que la tool no devolvió. Muéstralos agrupados por día, cortos.
- Una cita pedida por un cliente queda PENDIENTE hasta que el profesional la confirma - dilo así,
  nunca digas que ya quedó confirmada si la tool dice pendiente.
- Para agendar necesitas el horario exacto ('YYYY-MM-DD HH:mm') de uno de los espacios devueltos.
  Si la persona dice "el jueves a las 3", tradúcelo a la fecha exacta y confirma con ella antes de
  pedirla si hay cualquier duda.
- Antes de cancelar una cita, confirma cuál es (por su número #) si hay más de una posible.`;

/**
 * System prompt for someone who can ONLY book appointments (a professional's client): a neutral,
 * courteous booking assistant - they're a stranger to the bot's owner, so none of the owner's
 * personal "parcero" persona, data or features apply to them.
 */
export function buildClientSystemPrompt(userId: number, userName: string | null): string {
  const profs = bookableProfessionals(userId);
  const upcoming = schedRepo.listForClient(userId, nowLocal()).filter((a) => ['pending', 'confirmed'].includes(a.status));
  return [
    `Eres el asistente de agendamiento de citas por WhatsApp. Ayudas a la persona a ver los horarios
disponibles de sus profesionales, pedir citas, ver sus citas y cancelarlas. Hablas en español, con
tono amable, claro y profesional (tutea con respeto), mensajes cortos como en WhatsApp.

Reglas:
- Solo puedes ayudar con citas. Si piden otra cosa, explica con amabilidad que por este medio solo
  gestionas citas.
- NO INVENTES NADA: ni profesionales, ni horarios, ni citas. Usa solo lo que te dan las tools y el
  contexto de abajo.${SHARED_RULES}
- Usa la zona horaria y la fecha/hora actual de abajo para entender "mañana", "el viernes", etc.`,
    '',
    currentTimeContext(),
    upcomingDaysContext(false),
    `Nombre de la persona: ${userName ?? '(no lo sé)'}`,
    `Profesionales con los que puede agendar: ${profs.length ? profs.map(professionalLabel).join('; ') : '(ninguno todavía)'}`,
    `Sus próximas citas: ${upcoming.length ? '\n' + upcoming.map((a) => `- ${appointmentLine(a, 'client')}`).join('\n') : '(ninguna)'}`,
  ].join('\n');
}

/**
 * Extra system-prompt section for a regular (owner-persona) user who also has scheduling
 * permissions: a professional's live agenda summary, and/or the booking rules for a client.
 */
export function schedulingPromptSection(userId: number, perms: Set<string>): string {
  const parts: string[] = [];
  if (perms.has('scheduling.professional')) {
    const prof = schedRepo.getProfessional(userId);
    const rules = prof ? schedRepo.availability(userId) : [];
    const pending = prof ? schedRepo.listForProfessional(userId, nowLocal(), addDays(nowLocal(), 400), ['pending']) : [];
    const today = prof ? schedRepo.listForProfessional(userId, `${todayLocal()} 00:00:00`, `${addDays(todayLocal(), 1).slice(0, 10)} 00:00:00`, ['confirmed', 'pending']) : [];
    const schedule = rules.length
      ? rules.map((r) => `${WEEKDAYS[r.weekday]} ${r.start_time}-${r.end_time}`).join(', ')
      : '(sin horario de atención definido - si quiero recibir citas, ayúdame a definirlo con set_availability)';
    parts.push(
      `\n\nAGENDA PROFESIONAL: tengo agenda de citas (soy el profesional). Herramientas: set_availability
(reemplaza TODO mi horario semanal: pásale todos los bloques, no solo el que cambia), view_availability,
block_time/unblock_time (vacaciones, imprevistos), list_appointments, confirm_appointment,
reject_appointment, cancel_appointment, schedule_appointment (yo agendo a un cliente, queda confirmada),
share_scheduling_access (dar acceso a agendar a un número - el bot le escribe), list_scheduling_clients,
remove_scheduling_client, set_scheduling_settings (duración, tiempo entre citas, anticipación mínima,
recordatorios, auto-confirmar).${SHARED_RULES}
- Si escribo "confirmar cita 12" / "rechazar cita 12", usa la tool correspondiente con ese número.
Mi perfil: ${prof ? `${professionalLabel(prof)}, citas de ${prof.slot_minutes} min${prof.buffer_minutes ? ` + ${prof.buffer_minutes} min entre citas` : ''}, recordatorio ${prof.reminder_morning_time ? `el día de la cita a las ${prof.reminder_morning_time}` : 'de la mañana apagado'}${prof.reminder_hours_before ? ` y ${prof.reminder_hours_before}h antes` : ''}` : '(se crea solo con la primera acción de agenda)'}
Mi horario de atención: ${schedule}
Citas de hoy (${formatDay(todayLocal())}): ${today.length ? today.map((a) => appointmentLine(a, 'professional')).join('; ') : 'ninguna'}
Solicitudes pendientes de confirmar: ${pending.length ? pending.map((a) => appointmentLine(a, 'professional')).join('; ') : 'ninguna'}`,
    );
  }
  if (perms.has('scheduling.client')) {
    const profs = bookableProfessionals(userId);
    if (profs.length) {
      parts.push(
        `\n\nAGENDAR CITAS (como cliente): puedo pedir citas con: ${profs.map(professionalLabel).join('; ')}. Herramientas:
list_my_professionals, list_available_slots, request_appointment, list_my_appointments, cancel_my_appointment.${SHARED_RULES}`,
      );
    }
  }
  return parts.join('');
}
