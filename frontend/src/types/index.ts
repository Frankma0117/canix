export interface Category {
  id: number;
  name: string;
  description: string | null;
  created_at: string;
  /** What it groups - categories are shared by every module. */
  usage?: { links: number; notes: number; reminders: number; todos: number; recipes: number };
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
  paused_until?: string | null;
  /** Emoji that fits what the reminder is about (picked by the server from its text). */
  icon?: string;
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
  /** Free trial from the public page: 'active' | 'expired' | null (not a demo). */
  demo_status: 'active' | 'expired' | null;
  /** ISO (UTC) end of the trial. */
  demo_expires_at: string | null;
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

export type MealSlot = 'desayuno' | 'onces' | 'almuerzo' | 'media_tarde' | 'cena';

export interface MealPlan {
  id: number;
  plan_date: string;
  meal_slot: MealSlot;
  title: string;
  notes: string | null;
  /** 'HH:mm' - with a time Canix sends "hora del almuerzo"; null = only planned. */
  meal_time: string | null;
  /** Minutes before meal_time for the "toca preparar" notice. */
  prep_minutes: number | null;
}

export type MedicationKind = 'medicine' | 'vitamin' | 'supplement' | 'cream' | 'skincare' | 'water' | 'bodycare' | 'other';

/** Medicamentos y belleza - one row of GET /api/medications. */
export interface Medication {
  id: number;
  name: string;
  kind: MedicationKind;
  dose: string | null;
  instructions: string | null;
  /** 'HH:mm', sorted: a "toca tomar" notice at each. */
  times: string[];
  /** 0 = Sunday; null = every day. */
  weekdays: number[] | null;
  start_date: string | null;
  end_date: string | null;
  notes: string | null;
  active: boolean;
  /** Last 7 days of doses. */
  week: { taken: number; missed: number; pending: number };
  /** Taken today vs due today (for water: glasses vs the day's goal). */
  today: { done: number; goal: number };
}

export interface MedicationsResponse {
  kinds: Record<MedicationKind, { label: string; emoji: string; verb: string }>;
  items: Medication[];
}

export interface Recipe {
  id: number;
  title: string;
  ingredients: string;
  instructions: string;
  created_at: string;
}

export type ListKind = 'musica' | 'peliculas' | 'series' | 'libros' | 'juegos' | 'podcasts' | 'compras' | 'general';

export interface Checklist {
  id: number;
  name: string;
  /** What it's a list of. */
  kind: ListKind;
  items: { id: number; title: string; checked: number }[];
}

// ---------------- Media library ----------------
/** The list kinds that make up the media library. */
export type MediaKind = 'peliculas' | 'series' | 'musica' | 'libros' | 'juegos' | 'podcasts';

export interface MediaItem {
  id: number;
  checklist_id: number;
  list_name: string;
  kind: MediaKind;
  title: string;
  /** 1 = watched / listened / read / played. */
  checked: number;
  creator: string | null;
  genre: string | null;
  year: number | null;
  summary: string | null;
  url: string | null;
  link_id: number | null;
  rating: number | null;
  notes: string | null;
  done_at: string | null;
  created_at: string;
  related_notes: { id: number; title: string | null; content: string }[];
}

export interface LibraryResponse {
  kinds: MediaKind[];
  lists: { id: number; name: string; kind: MediaKind }[];
  items: MediaItem[];
}

// ---------------- Calendar ----------------
export type CalendarEventKind = 'routine' | 'reminder' | 'todo' | 'call' | 'meal' | 'medication' | 'appointment';

export interface CalendarEvent {
  key: string;
  kind: CalendarEventKind;
  sourceId: number;
  title: string;
  /** 'YYYY-MM-DD HH:mm:ss', bot timezone. */
  start: string;
  end: string;
  allDay: boolean;
  done: boolean | null;
  detail?: string;
}

export interface GarmentCard {
  id: number;
  image_url: string;
  type: string;
  category: string;
  category_label: string;
  color: string | null;
  short_description: string | null;
  favorite: boolean;
  /** The classifier has open questions about it (see the "Por revisar" tab). */
  needs_review?: boolean;
}

export type GarmentFieldValue = string | string[] | null;

export interface GarmentQuestionView {
  id: number;
  field: string;
  label: string;
  question: string;
  options: { value: string; label: string }[];
  suggested: string | null;
  many: boolean;
  /** What the garment is / its color, as opposed to a detail like the material. */
  main: boolean;
}

export interface GarmentDetail extends GarmentCard {
  full_image_url: string;
  long_description: string | null;
  seen: string | null;
  classified_by: 'vision' | 'local' | null;
  by_user: string[];
  fields: Record<string, GarmentFieldValue>;
  questions: GarmentQuestionView[];
}

export interface WardrobeTaxonomy {
  types: { value: string; label: string; categories: { value: string; label: string }[] }[];
  fields: { key: string; label: string; kind: 'one' | 'many' | 'text'; options: { value: string; label: string }[]; only_types: string[] | null }[];
}

export interface WardrobeReviewStatus {
  enabled: boolean;
  total: number;
  classified: number;
  pending: number;
  unreadable: number;
  open_questions: number;
  main_questions: number;
  garments_to_review: number;
  main_garments: number;
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

export type RoutineFreq = 'daily' | 'weekly' | 'monthly';
export type PromptAnswer = 'yes' | 'no';
/** Where an answer came from: the WhatsApp poll, a quoted reply, telling the bot, or this portal. */
export type PromptSource = 'poll' | 'reply' | 'chat' | 'web';

/** A routine as /api/routines returns it: schedule spelled out plus today's state. */
export interface Routine {
  id: number;
  title: string;
  /** Emoji that fits what the routine is about (picked by the server from its title). */
  icon?: string;
  /** Set when it belongs to Ejercicios (boxeo, zumba...) instead of Rutinas. */
  workout_kind?: WorkoutKind | null;
  category_id: number | null;
  reminder_time: string;
  duration_minutes: number | null;
  freq: RoutineFreq;
  interval: number;
  /** 0 = domingo ... 6 = sábado (weekly only). */
  weekdays: number[];
  month_day: number | null;
  start_date: string | null;
  schedule_label: string;
  occurs_today: boolean;
  today_answer: PromptAnswer | null;
  today_answered_at: string | null;
  today_sent_at: string | null;
  streak: number;
  next_run_at: string | null;
  suspended: boolean;
  /** false = its notices were cancelled or are missing: it's listed but never says anything. */
  notifying: boolean;
  paused_until: string | null;
}

export type WorkoutKind = 'combat' | 'dance' | 'strength' | 'cardio' | 'flexibility' | 'sport' | 'other';

/** One exercise of a workout or routine: rounds/sets, reps or seconds, weight. */
export interface Exercise {
  id: number;
  todo_id: number;
  name: string;
  sets: number | null;
  reps: number | null;
  seconds: number | null;
  weight_kg: number | null;
  order_index: number;
}

/** Ejercicios - one row of GET /api/workouts: the routine view plus place, notes, the week and its exercises. */
export interface Workout extends Routine {
  workout_kind: WorkoutKind;
  place: string | null;
  notes: string | null;
  week: { done: number; due: number; minutes: number; streak: number };
  exercises: Exercise[];
}

export interface WorkoutsResponse {
  kinds: Record<WorkoutKind, { label: string; emoji: string }>;
  summary: { done: number; due: number; minutes: number; minutes_text: string };
  items: Workout[];
}

export interface PromptResponse {
  id: number;
  prompt_id: number;
  answer: PromptAnswer;
  source: PromptSource;
  created_at: string;
}

/** One "¿lo hiciste?" (a routine day or a reminder) with every answer given, oldest first. */
export interface PromptWithResponses {
  id: number;
  todo_id: number | null;
  reminder_id: number | null;
  title: string;
  occurrence_date: string;
  sent_at: string | null;
  answer: PromptAnswer | null;
  answered_at: string | null;
  answer_source: PromptSource | null;
  responses: PromptResponse[];
}

/** Administrator's "modo prueba": the reduced access being tried on WhatsApp. */

// ---------------- Sticker pack (admin) ----------------
export interface StickerMomentDef {
  key: string;
  label: string;
  /** When the bot sends it on its own. */
  when: string;
}

export interface PackSticker {
  id: number;
  label: string | null;
  /** Moments it fits (the admin's choice, or suggested from the name when momentsSuggested). */
  moments: string[];
  momentsSuggested: boolean;
  suggestedMoments: string[];
  usage: string | null;
  active: number;
  sent_count: number;
  last_sent_at: string | null;
  created_at: string;
  size: number;
}

export interface StickerPackResponse {
  moments: StickerMomentDef[];
  stickers: PackSticker[];
  /** moment key -> active stickers that fit it */
  coverage: Record<string, number>;
}
