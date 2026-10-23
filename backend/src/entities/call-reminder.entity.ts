import type { RecurrenceFreq } from './reminder.entity.js';

export type CallReminderStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';

/** 'reminder' speaks the message then hangs up; 'alarm' says nothing and hangs up the instant it's
 *  answered - the ringing itself is the alarm (see services/calls/call-reminders.service.ts's buildTwiml). */
export type CallReminderType = 'reminder' | 'alarm';

/** A phone-call reminder (Twilio Programmable Voice, see backend/src/services/calls/) - separate resource from the
 *  WhatsApp-text `reminders` above (different channel/fields/status vocabulary), and deliberately
 *  NOT a general-purpose substitute for them - only for something truly important or an explicit
 *  alarm request (see agent/tools/calls/schedule-call-reminder.tool.ts). `status` is this row's own
 *  lifecycle; `twilio_call_status` separately tracks Twilio's own call progress (see
 *  api/routes/twilio-webhook.routes.ts), which is the ONLY thing allowed to set status to 'completed'. */
export interface CallReminder {
  id: number;
  user_id: number;
  phone_number: string; // E.164
  message: string;
  call_type: CallReminderType;
  scheduled_at: string; // 'YYYY-MM-DD HH:mm:ss' local wall time, same convention as reminders.run_at
  // Same convention as Reminder.recurrence_freq/interval - 'daily' + interval=2 is "every 2 days".
  // Only advances to the next occurrence once Twilio reports the call actually completed (see
  // services/calls/call-reminders.service.ts's handleCallStatusUpdate) - not just because it was dispatched.
  recurrence_freq: RecurrenceFreq;
  recurrence_interval: number;
  status: CallReminderStatus;
  twilio_call_sid: string | null;
  twilio_call_status: string | null;
  attempts: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}
