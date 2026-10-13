import { schedRepo } from './repo.js';
import { confirmAppointment, rejectAppointment, cancelAppointment, bookableProfessionals, SchedulingError } from './service.js';
import { appointmentCard, otherParty } from './views.js';
import { footnote } from '../util/wa-format.js';
import type { User } from '../types/index.js';

/**
 * What can be answered about appointments without a model turn: the plain "show me" questions
 * (which tool shows them) and the three commands on one appointment - which is also what a 👍/👎
 * on a request turns into (see service.ts's requestAppointment), so it must never be re-worded or
 * guessed at.
 */

const plain = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[¿?¡!.,]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const ASK = '(?:muestrame|mostrame|dime|dame|ver|listar|lista|listame|cuales son|que|quiero ver|a ver)';
const PENDING_RE = new RegExp(`^(?:${ASK} )?(?:mis |las )?(?:solicitudes(?: de citas?)?(?: pendientes)?|citas (?:pendientes|por confirmar|sin confirmar))(?: tengo| hay)?$`);
const APPOINTMENTS_RE = new RegExp(`^(?:${ASK} )?(?:mis |las )?(?:proximas )?citas(?: tengo| hay| agendadas| programadas| proximas| de la semana| de esta semana)?$`);
const CLIENTS_RE = new RegExp(`^(?:${ASK} )?(?:mis |los )?(?:clientes|pacientes)(?: tengo| hay)?$`);
const AVAILABILITY_RE = new RegExp(`^(?:${ASK} )?(?:mi |el |la )?(?:horario(?: de atencion)?|disponibilidad|configuracion de (?:la |mi )?agenda)$`);
const SLOTS_RE = /^(?:quiero |necesito |me gustaria |puedo )?(?:(?:pedir|agendar|sacar|reservar|programar) )?(?:una |un )?(?:cita|turno|horarios?(?: disponibles?)?|espacios?(?: disponibles?)?|que horarios? hay|que espacios? hay)(?: por favor)?$/;

/** The scheduling tool a plain question asks for, among the ones this person may use - or null. */
export function schedulingAsked(text: string, userId: number, allowed: string[] | null): { tool: string; args: Record<string, unknown> } | null {
  const t = plain(text);
  if (!t || t.length > 45 || /\d/.test(t)) return null;
  const may = (tool: string) => allowed === null || allowed.includes(tool);
  const isProfessional = may('list_appointments') && (allowed !== null || !!schedRepo.getProfessional(userId));

  if (PENDING_RE.test(t) && isProfessional) return { tool: 'list_appointments', args: { status: 'pendientes', days: 62 } };
  if (APPOINTMENTS_RE.test(t)) {
    if (isProfessional) return { tool: 'list_appointments', args: { days: 14 } };
    if (may('list_my_appointments')) return { tool: 'list_my_appointments', args: {} };
  }
  if (CLIENTS_RE.test(t) && isProfessional && may('list_scheduling_clients')) return { tool: 'list_scheduling_clients', args: {} };
  if (AVAILABILITY_RE.test(t) && isProfessional && may('view_availability')) return { tool: 'view_availability', args: {} };
  // Straight to the free slots only when there's exactly one professional to book with.
  if (SLOTS_RE.test(t) && !isProfessional && may('list_available_slots') && bookableProfessionals(userId).length === 1) return { tool: 'list_available_slots', args: {} };
  return null;
}

const COMMAND_RE = /^(confirmar|confirma|confirmo|aceptar|acepta|acepto|rechazar|rechaza|rechazo|cancelar|cancela|cancelo)\s+(?:la\s+)?cita\s+#?(\d+)$/;

/**
 * "confirmar cita 12" / "rechazar cita 12" / "cancelar cita 12", done on the spot. Returns the
 * reply, or null when the text isn't one of those (or the person may not do it - the model then
 * explains).
 */
export async function handleAppointmentCommand(user: User, text: string, allowed: string[] | null): Promise<string | null> {
  const m = COMMAND_RE.exec(plain(text));
  if (!m) return null;
  const verb = m[1].startsWith('conf') || m[1].startsWith('acept') ? 'confirm' : m[1].startsWith('rech') ? 'reject' : 'cancel';
  const id = Number(m[2]);
  const may = (tool: string) => allowed === null || allowed.includes(tool);

  try {
    if (verb === 'confirm') {
      if (!may('confirm_appointment')) return null;
      const a = await confirmAppointment(user, id);
      return appointmentCard('✅ *Cita confirmada*', a, 'professional', { note: footnote(`Ya le avisé a ${otherParty(a, 'professional')} y queda con recordatorio`) });
    }
    if (verb === 'reject') {
      if (!may('reject_appointment')) return null;
      const a = await rejectAppointment(user, id, null);
      return appointmentCard('❌ *Solicitud rechazada*', a, 'professional', { note: footnote(`Ya le avisé a ${otherParty(a, 'professional')}; ese horario quedó libre otra vez`) });
    }
    const appt = schedRepo.getAppointment(id);
    const asClient = !!appt && appt.client_user_id === user.id && appt.professional_id !== user.id;
    if (!may(asClient ? 'cancel_my_appointment' : 'cancel_appointment')) return null;
    const a = await cancelAppointment(user, id, null);
    const side = asClient ? 'client' : 'professional';
    return appointmentCard('🚫 *Cita cancelada*', a, side, { note: footnote(`Ya le avisé a ${otherParty(a, side)}`) });
  } catch (err) {
    if (err instanceof SchedulingError) return `⚠️ ${err.message}`;
    throw err;
  }
}
