import twilioLib from 'twilio';
import { env } from '../config/env.js';
import { callRemindersRepo, type CallReminderEditableFields } from '../db/repositories/call-reminders.repo.js';
import { toE164, isCallableDestination, maskPhone } from './phone.js';
import { getTwilioClient, isTwilioConfigured } from './twilio-client.js';
import { nowLocal, addMinutes, addMonths } from '../util/datetime.js';
import type { CallReminder, CallReminderType, RecurrenceFreq } from '../types/index.js';

const MAX_MESSAGE_LENGTH = 300; // short-call cost design (~10s) - see the user's own requirement

// Twilio's <Say> voice doesn't have an es-CO (Colombian) option - see VoiceResponse.d.ts's
// SayLanguage union. es-MX is the closest officially-supported Spanish variant for a Latin
// American accent (the user's own spec anticipated this: "si es necesario... seleccionar una voz
// soportada oficialmente por Twilio").
const SAY_LANGUAGE = 'es-MX';

// How long to let it ring before giving up - both short on purpose (every second is billed), but
// an alarm needs enough time to actually wake someone, longer than a brief reminder call.
const RING_TIMEOUT_SECONDS: Record<CallReminderType, number> = { reminder: 20, alarm: 30 };

/** Statuses Twilio can eventually report where the call did NOT succeed - see
 *  https://www.twilio.com/docs/voice/api/call-resource#call-status-values. 'canceled' can happen
 *  if the call is torn down before connecting; treated the same as a failed attempt. */
const RETRIABLE_TWILIO_STATUSES = new Set(['busy', 'no-answer', 'failed', 'canceled']);

export interface CreateCallReminderInput {
  userId: number;
  phoneNumber: string;
  /** Spoken for call_type 'reminder'; ignored (never spoken) for 'alarm' - still stored so the
   *  reminder is recognizable in logs/panel ("despertar", "alarma 6am", etc.). */
  message: string;
  callType: CallReminderType;
  scheduledAt: string; // 'YYYY-MM-DD HH:mm:ss' local wall time
  /** Same convention as reminders' own recurrence - 'daily' + interval 2 is "every 2 days". Default
   *  'none' (one-off). */
  recurrenceFreq?: RecurrenceFreq;
  recurrenceInterval?: number;
}

export type ServiceResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Trims and bounds the message - the Twilio SDK's VoiceResponse.say() builder (used in
 *  buildTwiml() below) escapes the text itself when generating XML, so this is about length/cost
 *  control and rejecting empty input, not XML-escaping (never hand-build TwiML via string
 *  concatenation - that's the actual injection risk, and this codebase doesn't do that). An
 *  'alarm' never speaks anything, so an empty message is fine there - it just falls back to a
 *  short label for logs/panel display. */
function sanitizeMessage(raw: string, callType: CallReminderType): ServiceResult<string> {
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  if (!trimmed) {
    if (callType === 'alarm') return { ok: true, value: 'Alarma' };
    return { ok: false, error: 'El mensaje no puede estar vacío.' };
  }
  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    return { ok: false, error: `El mensaje es muy largo (máximo ${MAX_MESSAGE_LENGTH} caracteres, para mantener la llamada corta).` };
  }
  return { ok: true, value: trimmed };
}

function validateRecurrenceInterval(freq: RecurrenceFreq | undefined, interval: number | undefined): ServiceResult<number> {
  if (!freq || freq === 'none') return { ok: true, value: 1 };
  const n = interval ?? 1;
  if (!Number.isInteger(n) || n < 1) return { ok: false, error: 'recurrence_interval debe ser un entero de al menos 1.' };
  return { ok: true, value: n };
}

function validatePhone(raw: string): ServiceResult<string> {
  const e164 = toE164(raw);
  if (!e164) return { ok: false, error: 'Número inválido - debe incluir indicativo de país en formato E.164 (ej. +573001234567).' };
  if (!isCallableDestination(e164)) {
    return { ok: false, error: 'Ese número no se puede usar como destinatario (es el número de Twilio del bot).' };
  }
  return { ok: true, value: e164 };
}

/**
 * Builds the TwiML for one call:
 *  - 'reminder': <Response><Say language="es-MX">MENSAJE</Say></Response> - speaks it, then hangs
 *    up automatically at the end of the document.
 *  - 'alarm': <Response><Hangup/></Response> - says NOTHING. Twilio only executes this TwiML after
 *    the call is answered, so the ring itself (before that point) is what wakes someone up; the
 *    instant they pick up, the call just ends - functioning as a wake-up call, not a message.
 * Uses the Twilio SDK's builder (not string concatenation) so the message text is always properly
 * XML-escaped - a message containing "</Say><Redirect>..." can never break out of the tag.
 */
export function buildTwiml(message: string, callType: CallReminderType): string {
  const response = new twilioLib.twiml.VoiceResponse();
  if (callType === 'reminder') response.say({ language: SAY_LANGUAGE }, message);
  else response.hangup();
  return response.toString();
}

/** Validates input and creates a pending call reminder - does NOT place the call (see
 *  processDueCallReminders() for the scheduled path, testCallNow() for the immediate one). */
export function createCallReminder(input: CreateCallReminderInput): ServiceResult<CallReminder> {
  const phone = validatePhone(input.phoneNumber);
  if (!phone.ok) return phone;
  const message = sanitizeMessage(input.message, input.callType);
  if (!message.ok) return message;
  if (!input.scheduledAt.trim()) return { ok: false, error: 'Falta scheduledAt.' };
  const interval = validateRecurrenceInterval(input.recurrenceFreq, input.recurrenceInterval);
  if (!interval.ok) return interval;

  const reminder = callRemindersRepo.create(
    input.userId,
    phone.value,
    message.value,
    input.callType,
    input.scheduledAt.trim(),
    input.recurrenceFreq ?? 'none',
    interval.value,
  );
  return { ok: true, value: reminder };
}

/**
 * Validates and applies a partial edit to an existing call reminder (see repo.update() for exactly
 * which fields/status transitions this allows - blocked while 'processing', revives a
 * completed/failed/cancelled one back to 'pending').
 */
export function updateCallReminder(
  userId: number,
  id: number,
  fields: {
    phoneNumber?: string;
    message?: string;
    callType?: CallReminderType;
    scheduledAt?: string;
    recurrenceFreq?: RecurrenceFreq;
    recurrenceInterval?: number;
  },
): ServiceResult<CallReminder> {
  const current = callRemindersRepo.getById(userId, id);
  if (!current) return { ok: false, error: `No existe el recordatorio #${id}.` };

  const patch: CallReminderEditableFields = {};

  if (fields.phoneNumber !== undefined) {
    const phone = validatePhone(fields.phoneNumber);
    if (!phone.ok) return phone;
    patch.phoneNumber = phone.value;
  }

  const effectiveCallType = fields.callType ?? current.call_type;
  if (fields.message !== undefined || fields.callType !== undefined) {
    const message = sanitizeMessage(fields.message ?? current.message, effectiveCallType);
    if (!message.ok) return message;
    patch.message = message.value;
    patch.callType = effectiveCallType;
  }

  if (fields.scheduledAt !== undefined) {
    if (!fields.scheduledAt.trim()) return { ok: false, error: 'scheduled_at no puede estar vacío.' };
    patch.scheduledAt = fields.scheduledAt.trim();
  }

  if (fields.recurrenceFreq !== undefined || fields.recurrenceInterval !== undefined) {
    const freq = fields.recurrenceFreq ?? current.recurrence_freq;
    const interval = validateRecurrenceInterval(freq, fields.recurrenceInterval ?? current.recurrence_interval);
    if (!interval.ok) return interval;
    patch.recurrenceFreq = freq;
    patch.recurrenceInterval = interval.value;
  }

  const ok = callRemindersRepo.update(userId, id, patch);
  if (!ok) return { ok: false, error: 'No se puede editar ahora mismo (la llamada está en curso).' };
  return { ok: true, value: callRemindersRepo.getById(userId, id)! };
}

/** Computes the next occurrence for a recurring call reminder - same logic as
 *  scheduler/task-scheduler.ts's nextRunAt() for WhatsApp reminders, kept as its own copy here
 *  since call reminders are a separate table/type (see call_reminders' own comment on why). */
function nextCallScheduledAt(reminder: CallReminder): string | undefined {
  switch (reminder.recurrence_freq) {
    case 'daily':
      return addMinutes(reminder.scheduled_at, 60 * 24 * reminder.recurrence_interval);
    case 'weekly':
      return addMinutes(reminder.scheduled_at, 60 * 24 * 7 * reminder.recurrence_interval);
    case 'monthly':
      return addMonths(reminder.scheduled_at, reminder.recurrence_interval);
    case 'yearly':
      return addMonths(reminder.scheduled_at, 12 * reminder.recurrence_interval);
    default:
      return undefined; // 'none'
  }
}

function statusCallbackUrl(reminderId: number): string | undefined {
  if (!env.panelUrl) return undefined;
  return `${env.panelUrl.replace(/\/$/, '')}/webhooks/twilio/call-status?reminderId=${reminderId}`;
}

/**
 * Actually places the call via Twilio's Voice API. Never marks the reminder 'completed' here -
 * reaching this point only means Twilio's API ACCEPTED the request (call queued), not that anyone
 * answered (see the call_reminders table's own comment, and the user's explicit requirement).
 * Callers (processDueCallReminders / testCallNow) are responsible for recording the outcome.
 */
async function placeCall(reminder: CallReminder): Promise<ServiceResult<string>> {
  if (!isTwilioConfigured()) return { ok: false, error: 'Twilio no está configurado (faltan variables de entorno).' };

  try {
    const client = getTwilioClient();
    const call = await client.calls.create({
      to: reminder.phone_number,
      from: env.twilio.phoneNumber,
      twiml: buildTwiml(reminder.message, reminder.call_type),
      statusCallback: statusCallbackUrl(reminder.id),
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
      statusCallbackMethod: 'POST',
      timeout: RING_TIMEOUT_SECONDS[reminder.call_type],
    });
    return { ok: true, value: call.sid };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

function logOutcome(reminder: CallReminder, extra: Record<string, unknown>): void {
  console.log(
    '[CALLS] reminderId=%d phone=%s scheduledAt=%s %s',
    reminder.id,
    maskPhone(reminder.phone_number),
    reminder.scheduled_at,
    Object.entries(extra)
      .map(([k, v]) => `${k}=${v}`)
      .join(' '),
  );
}

/** One dispatch attempt failed (either Twilio's API rejected the request outright, or - for the
 *  immediate test path - we're told to give up without a webhook to wait on). Decides retry vs
 *  permanent failure and logs either way. */
function handleDispatchFailure(reminder: CallReminder, errorMessage: string): void {
  const attempts = callRemindersRepo.incrementAttempts(reminder.id);
  if (attempts >= env.twilio.maxAttempts) {
    callRemindersRepo.markFailed(reminder.id, errorMessage);
    logOutcome(reminder, { callSid: '(none)', status: 'failed', attempts, error: errorMessage });
  } else {
    const nextAt = addMinutes(nowLocal(), env.twilio.retryDelayMinutes);
    callRemindersRepo.rescheduleForRetry(reminder.id, nextAt, errorMessage);
    logOutcome(reminder, { callSid: '(none)', status: 'retry-scheduled', attempts, nextAt, error: errorMessage });
  }
}

/**
 * Processes every due, pending call reminder - called from the scheduler's existing tick (see
 * scheduler/task-scheduler.ts), NOT a second worker. claim() is the idempotency guard: if this
 * were ever called twice concurrently for the same row (it isn't, in this single-process app -
 * see index.ts's acquireSingleInstanceLock - but the guard costs nothing and is correct either
 * way), only one caller's claim() actually flips pending -> processing.
 */
export async function processDueCallReminders(): Promise<void> {
  if (!isTwilioConfigured()) return; // nothing to do, silently - same as Fashion Mode's vision service being optional

  const due = callRemindersRepo.listDue(nowLocal());
  for (const reminder of due) {
    if (!callRemindersRepo.claim(reminder.id)) continue; // another caller already took it
    const claimed = callRemindersRepo.getByIdUnscoped(reminder.id)!;

    const result = await placeCall(claimed);
    if (result.ok) {
      callRemindersRepo.setCallSid(claimed.id, result.value);
      callRemindersRepo.incrementAttempts(claimed.id);
      logOutcome(claimed, { callSid: result.value, status: 'dispatched' });
    } else {
      handleDispatchFailure(claimed, result.error);
    }
  }
}

/**
 * Called by the Twilio status-callback webhook (see server/twilio-webhook.ts) whenever Twilio
 * reports how a call actually went. Only place that can move a reminder to 'completed', and the
 * only place that retries a call that was successfully dispatched but rang busy/unanswered/failed.
 */
export function handleCallStatusUpdate(callSid: string, twilioCallStatus: string): void {
  const reminder = callRemindersRepo.updateTwilioStatus(callSid, twilioCallStatus);
  if (!reminder) {
    console.error('[CALLS] Status callback para un callSid desconocido: %s (%s)', callSid, twilioCallStatus);
    return;
  }

  if (!RETRIABLE_TWILIO_STATUSES.has(twilioCallStatus)) {
    // A successful 'completed' call is the only thing that advances a RECURRING reminder to its
    // next occurrence - it stays a one-off 'completed' row forever if recurrence_freq is 'none'.
    if (twilioCallStatus === 'completed' && reminder.recurrence_freq !== 'none') {
      const nextAt = nextCallScheduledAt(reminder);
      if (nextAt) {
        callRemindersRepo.rescheduleRecurring(reminder.id, nextAt);
        logOutcome(reminder, { callSid, status: 'completed', nextAt });
        return;
      }
    }
    logOutcome(reminder, { callSid, status: twilioCallStatus });
    return;
  }

  // The dispatch itself already counted as one attempt (see processDueCallReminders) - decide here
  // whether this outcome still has retries left, without incrementing again.
  if (reminder.attempts >= env.twilio.maxAttempts) {
    callRemindersRepo.markFailed(reminder.id, `Twilio reportó: ${twilioCallStatus}`);
    logOutcome(reminder, { callSid, status: 'failed', twilioStatus: twilioCallStatus, attempts: reminder.attempts });
  } else {
    const nextAt = addMinutes(nowLocal(), env.twilio.retryDelayMinutes);
    callRemindersRepo.rescheduleForRetry(reminder.id, nextAt, `Twilio reportó: ${twilioCallStatus}`);
    logOutcome(reminder, { callSid, status: 'retry-scheduled', twilioStatus: twilioCallStatus, nextAt, attempts: reminder.attempts });
  }
}

/**
 * Immediate test call (see POST /api/call-reminders/:id/test) - creates (or reuses, via
 * createCallReminder's own idempotency) a reminder for right now and places the call straight
 * away, bypassing the scheduler entirely. Still goes through claim() so a test call is indistinguishable
 * from a scheduled one once dispatched - same retry/status-tracking machinery applies.
 */
export async function testCallNow(input: CreateCallReminderInput): Promise<ServiceResult<CallReminder>> {
  const created = createCallReminder(input);
  if (!created.ok) return created;

  if (!callRemindersRepo.claim(created.value.id)) {
    return { ok: false, error: 'Ese recordatorio ya se está procesando.' };
  }
  const claimed = callRemindersRepo.getByIdUnscoped(created.value.id)!;

  const result = await placeCall(claimed);
  if (result.ok) {
    callRemindersRepo.setCallSid(claimed.id, result.value);
    callRemindersRepo.incrementAttempts(claimed.id);
    logOutcome(claimed, { callSid: result.value, status: 'dispatched (test)' });
    return { ok: true, value: callRemindersRepo.getByIdUnscoped(claimed.id)! };
  }
  handleDispatchFailure(claimed, result.error);
  return { ok: false, error: result.error };
}
