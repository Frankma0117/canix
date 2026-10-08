export interface Category {
  id: number;
  name: string;
  description: string | null;
  created_at: string;
}

export interface Link {
  id: number;
  category_id: number | null;
  url: string;
  title: string | null;
  description: string | null;
  used_count: number;
  last_used_at: string | null;
  created_at: string;
}

export interface Contact {
  id: number;
  name: string;
  jid: string;
  notes: string | null;
  created_at: string;
}

export type ReminderStatus = 'pending' | 'executed' | 'failed' | 'cancelled' | 'missed' | 'suspended';
export type RecurrenceFreq = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';
export type ReminderKind =
  | 'reminder'
  | 'important_date'
  | 'flexible'
  | 'routine_reminder'
  | 'routine_checkin'
  | 'weekly_report'
  | 'interval'
  // Deprecated - no longer auto-created, kept only so pre-existing (cancelled) rows still type-check.
  | 'daily_agenda';

export interface Reminder {
  id: number;
  message: string;
  run_at: string;
  target_jid: string | null;
  category_id: number | null;
  link_id: number | null;
  recurrence_freq: RecurrenceFreq;
  recurrence_interval: number;
  status: ReminderStatus;
  kind: ReminderKind;
  window_start: string | null;
  window_end: string | null;
  awaiting_confirmation: number;
  missed_confirmations: number;
  created_at: string;
}

export type TodoScope = 'today' | 'later' | 'routine';
export type TodoStatus = 'pending' | 'done' | 'skipped';

export interface Todo {
  id: number;
  title: string;
  category_id: number | null;
  link_id: number | null;
  scope: TodoScope;
  due_date: string | null;
  recurrence_freq: RecurrenceFreq | null;
  reminder_time: string | null;
  duration_minutes: number | null;
  status: TodoStatus;
  completed_at: string | null;
  created_at: string;
}

export interface HabitLog {
  id: number;
  todo_id: number;
  log_date: string;
  done: number;
  note: string | null;
  created_at: string;
}

export type CallReminderStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
export type CallReminderType = 'reminder' | 'alarm';

/** Phone-call reminder (Twilio) - special, not a general reminder channel: only for something
 *  truly important the user explicitly wants delivered as an actual call, or a wake-up alarm. */
export interface CallReminder {
  id: number;
  phone_number: string;
  message: string;
  call_type: CallReminderType;
  scheduled_at: string;
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

export type RewardPunishmentType = 'reward' | 'punishment';

export interface RewardPunishment {
  id: number;
  todo_id: number | null;
  type: RewardPunishmentType;
  description: string;
  note: string | null;
  date: string;
  created_at: string;
}

// ---------------- Access control (admin) ----------------
export interface PermissionDef {
  key: string;
  module: string;
  label: string;
  description: string;
  /** Paid extra (calls, natural voice...): granted per person, never through a package. */
  billable?: boolean;
}

export interface PermissionPackage {
  id: number;
  key: string;
  name: string;
  description: string;
  is_system: number;
  permissions: string[];
}

export interface AdminUser {
  id: number;
  name: string | null;
  /** Real number, or null when WhatsApp only gave us the person's @lid (see whatsapp_id). */
  phone: string | null;
  /** The digits before "@" of the stored WhatsApp id - their login "access code" when phone is null. */
  whatsapp_id: string;
  lid: string | null;
  gender: 'male' | 'female' | null;
  voice_gender: 'male' | 'female' | null;
  role: 'admin' | 'user';
  created_at: string;
  paused_until: string | null;
  has_password: boolean;
  must_change_password: boolean;
  locked_until: string | null;
  packages: { id: number; key: string; name: string }[];
  allow: string[];
  deny: string[];
  effective: string[];
  is_professional: boolean;
}

export interface AuditEntry {
  id: number;
  actor_name: string | null;
  target_name: string | null;
  action: string;
  detail: string | null;
  created_at: string;
}

// ---------------- Scheduling ----------------
export type AppointmentStatus = 'pending' | 'confirmed' | 'rejected' | 'cancelled' | 'completed' | 'no_show' | 'expired';

export interface Appointment {
  id: number;
  professional_id: number;
  client_user_id: number;
  start_at: string;
  end_at: string;
  status: AppointmentStatus;
  status_label: string;
  reason: string | null;
  notes?: string | null;
  cancel_reason: string | null;
  professional_name: string;
  client_name: string | null;
  client_phone: string;
  created_at: string;
}

export interface ProfessionalProfile {
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
}

export interface AvailabilityRule {
  id?: number;
  weekday: number;
  start_time: string;
  end_time: string;
}

export interface TimeOff {
  id: number;
  start_at: string;
  end_at: string;
  reason: string | null;
}

export interface Slot {
  start_at: string;
  end_at: string;
}

export interface SchedClient {
  id: number;
  name: string | null;
  phone: string;
  via_group: string | null;
  since: string;
}

export interface AttachedFile {
  id: number;
  name: string;
  mime: string;
  size: number;
  owner: number;
  created_at: string;
}

export interface SchedGroup {
  id: number;
  name: string;
  description: string;
  members: number[];
  clients: { id: number; name: string | null; phone: string }[];
}

// ---------------- Other modules ----------------
export interface Note {
  id: number;
  title: string | null;
  content: string;
  category_id: number | null;
  created_at: string;
  updated_at?: string;
}

export type MealSlot = 'desayuno' | 'almuerzo' | 'cena' | 'onces';

export interface MealPlan {
  id: number;
  plan_date: string;
  meal_slot: MealSlot;
  title: string;
  notes: string | null;
}

export interface Recipe {
  id: number;
  title: string;
  ingredients: string;
  instructions: string;
  created_at: string;
}

export interface Checklist {
  id: number;
  name: string;
  items: { id: number; title: string; checked: number }[];
}

export interface GarmentCard {
  id: number;
  image_url: string;
  type: string;
  category: string;
  color: string | null;
  short_description: string | null;
  favorite: boolean;
}

// ---------------- Usage (paid resources) ----------------
export interface UsageRow {
  user_id: number;
  name: string | null;
  jid: string;
  operation: string;
  uses: number;
  input_units: number;
  output_units: number;
}
