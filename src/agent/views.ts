import { withIcon } from '../util/icons.js';
import { todayLocal, addDays, weekdayName } from '../util/datetime.js';
import { jidToPhone } from '../util/jid.js';
import { keycap, progressBar, timeChip } from '../util/wa-format.js';
import { describeSchedule, scheduleOf } from './routine-schedule.js';
import type { Category, Checklist, ChecklistItem, Contact, Exercise, Link, MealPlan, Note, Reminder, Todo } from '../types/index.js';

/**
 * How every "show me my ..." list looks on WhatsApp - one place, so links, contacts, notes, lists,
 * reminders and tasks share the same shape: a bold title with its emoji and count, rows grouped
 * under short sub-headings, and each row's number as a small `#12` chip at the end (it's what the
 * person - or the model - quotes to edit or delete that item). The tools return these as-is and
 * the model is told to pass them through untouched (see STYLE_RULE in agent/choices.ts).
 */
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
/** Past this, a list stops being readable in a chat - the rest is counted, with how to narrow it. */
const MAX_ROWS = 40;

export const idChip = (id: number) => `\`#${id}\``;

/** "+57 311 111 1111" for a Colombian mobile, "+<digits>" otherwise. */
export function prettyPhone(digits: string): string {
  const d = digits.replace(/\D/g, '');
  if (d.startsWith('57') && d.length === 12) return `+57 ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}`;
  return `+${d}`;
}

/** "Hoy · lunes 12 de octubre", "Mañana · martes 13 de octubre", "viernes 16 de octubre". */
export function dayLabel(date: string): string {
  const today = todayLocal();
  const base = `${weekdayName(date)} ${Number(date.slice(8, 10))} de ${MONTHS[Number(date.slice(5, 7)) - 1]}`;
  const year = date.slice(0, 4) !== today.slice(0, 4) ? ` de ${date.slice(0, 4)}` : '';
  if (date === today) return `Hoy · ${base}`;
  if (date === addDays(today, 1).slice(0, 10)) return `Mañana · ${base}`;
  if (date === addDays(today, -1).slice(0, 10)) return `Ayer · ${base}`;
  return `${base.charAt(0).toUpperCase()}${base.slice(1)}${year}`;
}

function capped<T>(rows: T[], hint: string): { shown: T[]; more: string[] } {
  if (rows.length <= MAX_ROWS) return { shown: rows, more: [] };
  return { shown: rows.slice(0, MAX_ROWS), more: [`_… y ${rows.length - MAX_ROWS} más${hint ? ` (${hint})` : ''}_`] };
}

/** Rows grouped under bold sub-headings, in the order the groups first appear. */
function grouped<T>(rows: T[], keyOf: (row: T) => string, heading: (key: string, count: number) => string, line: (row: T) => string): string[] {
  const groups = new Map<string, T[]>();
  for (const row of rows) groups.set(keyOf(row), [...(groups.get(keyOf(row)) ?? []), row]);
  const out: string[] = [];
  for (const [key, items] of groups) out.push('', heading(key, items.length), ...items.map(line));
  return out;
}

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

// ---------------------------------------------------------------------------------------------

export function linksView(links: Link[], categories: Category[], opts: { filter?: string } = {}): string {
  const { shown, more } = capped(links, 'búscalos por categoría o por texto');
  const nameOf = (id: number | null) => categories.find((c) => c.id === id)?.name ?? 'Sin categoría';
  const line = (l: Link) => {
    const title = l.title || l.description || host(l.url);
    return `🔗 *${title.replace(/\*/g, '')}* ${idChip(l.id)}\n${l.url}`;
  };
  return [
    `🔗 *Tus links*${opts.filter ? ` · ${opts.filter}` : ''} · ${links.length}`,
    ...grouped(shown, (l) => nameOf(l.category_id), (name, n) => `📁 *${name}* · ${n}`, line),
    ...more,
  ].join('\n');
}

/** One link on its own (pick_link): the title, where it's from, and the address on its own line. */
export function linkCard(link: Link, categoryName: string): string {
  const title = link.title || link.description || host(link.url);
  return `🔗 *${title.replace(/\*/g, '')}* ${idChip(link.id)}\n📁 ${categoryName}\n${link.url}`;
}

export function contactsView(contacts: Contact[]): string {
  const { shown, more } = capped(contacts, '');
  const line = (c: Contact) => {
    const phone = jidToPhone(c.jid);
    const extra = [phone ? prettyPhone(phone) : null, c.username ? `@${c.username}` : null].filter(Boolean).join(' · ');
    return `👤 *${c.name.replace(/\*/g, '')}*${extra ? ` · ${extra}` : ''} ${idChip(c.id)}${c.notes ? `\n> ${c.notes}` : ''}`;
  };
  return [`👥 *Tus contactos* · ${contacts.length}`, '', ...shown.map(line), ...more].join('\n');
}

export function notesView(notes: Note[], categories: Category[], opts: { filter?: string } = {}): string {
  const { shown, more } = capped(notes, 'búscalas por categoría o por texto');
  const nameOf = (id: number | null) => categories.find((c) => c.id === id)?.name ?? 'Sin categoría';
  const line = (n: Note) => {
    const body = n.content.replace(/\s+/g, ' ').trim();
    const preview = body.length > 110 ? `${body.slice(0, 109)}…` : body;
    return n.title ? `📝 *${n.title.replace(/\*/g, '')}* ${idChip(n.id)}\n> ${preview}` : `📝 ${preview} ${idChip(n.id)}`;
  };
  return [
    `📝 *Tus notas*${opts.filter ? ` · ${opts.filter}` : ''} · ${notes.length}`,
    ...grouped(shown, (n) => nameOf(n.category_id), (name, c) => `📁 *${name}* · ${c}`, line),
    ...more,
  ].join('\n');
}

export function listsView(lists: { list: Checklist; items: ChecklistItem[] }[]): string {
  const line = ({ list, items }: { list: Checklist; items: ChecklistItem[] }) => {
    const checked = items.filter((i) => i.checked).length;
    const state = items.length === 0 ? 'vacía' : checked === items.length ? 'completa ✓' : `${checked} de ${items.length}`;
    return `📋 *${list.name.replace(/\*/g, '')}* · ${state} ${idChip(list.id)}`;
  };
  return [`📋 *Tus listas* · ${lists.length}`, '', ...lists.map(line)].join('\n');
}

export function listView(list: Checklist, items: ChecklistItem[]): string {
  const checked = items.filter((i) => i.checked).length;
  const pending = items.filter((i) => !i.checked);
  const done = items.filter((i) => i.checked);
  const lines = [`📋 *${list.name.replace(/\*/g, '')}* · ${checked} de ${items.length}`, progressBar(checked, items.length)];
  if (pending.length) lines.push('', ...pending.map((i) => `⬜ ${i.title} ${idChip(i.id)}`));
  if (done.length) lines.push('', ...done.map((i) => `☑️ ~${i.title.replace(/~/g, '')}~ ${idChip(i.id)}`));
  return lines.join('\n');
}

function recurrenceTag(r: Reminder): string {
  if (r.kind === 'interval') return ' · 🔁 por intervalos';
  const unit = { daily: ['día', 'días'], weekly: ['semana', 'semanas'], monthly: ['mes', 'meses'], yearly: ['año', 'años'] }[r.recurrence_freq as string];
  if (!unit) return '';
  return r.recurrence_interval > 1 ? ` · 🔁 cada ${r.recurrence_interval} ${unit[1]}` : ` · 🔁 cada ${unit[0]}`;
}

export function remindersView(reminders: Reminder[], linkUrl: (id: number) => string | undefined, opts: { title?: string } = {}): string {
  const sorted = [...reminders].sort((a, b) => a.run_at.localeCompare(b.run_at));
  const { shown, more } = capped(sorted, 'filtra por categoría');
  const now = todayLocal();
  const line = (r: Reminder) => {
    const notes: string[] = [];
    if (r.paused_until && r.paused_until.slice(0, 10) >= now) notes.push(`⏸️ en pausa hasta el ${Number(r.paused_until.slice(8, 10))} de ${MONTHS[Number(r.paused_until.slice(5, 7)) - 1]}`);
    if (r.status === 'suspended') notes.push('⏸️ suspendido por falta de respuesta (se reactiva al escribirme)');
    if (r.status === 'missed') notes.push('no se envió (el bot estaba caído)');
    const url = r.link_id ? linkUrl(r.link_id) : undefined;
    const when = r.kind === 'flexible' && r.window_start && r.window_end ? `\`${r.window_start}–${r.window_end}\`` : timeChip(r.run_at);
    return `${when} ${withIcon(r.message, '🔔')}${recurrenceTag(r)} ${idChip(r.id)}${notes.length ? `\n> ${notes.join(' · ')}` : ''}${url ? `\n${url}` : ''}`;
  };
  return [
    `⏰ *${opts.title ?? 'Tus recordatorios'}* · ${reminders.length}`,
    ...grouped(shown, (r) => r.run_at.slice(0, 10), (date) => `*${dayLabel(date)}*`, line),
    ...more,
  ].join('\n');
}

export function todosView(todos: Todo[], linkUrl: (id: number) => string | undefined, opts: { done?: boolean } = {}): string {
  const { shown, more } = capped(todos, 'filtra por tipo o categoría');
  const groupName: Record<string, string> = { today: '📌 *Hoy*', later: '🗂️ *Para después*', routine: '🔁 *Rutinas*' };
  const line = (t: Todo) => {
    const url = t.link_id ? linkUrl(t.link_id) : undefined;
    if (t.scope === 'routine') {
      const s = scheduleOf(t);
      return `${timeChip(s.time)} ${withIcon(t.title)} ${idChip(t.id)}\n> ${describeSchedule(s)}${t.duration_minutes ? ` · ${t.duration_minutes} min` : ''}${url ? `\n${url}` : ''}`;
    }
    const due = t.due_date && t.scope !== 'today' ? ` · ${dayLabel(t.due_date).toLowerCase()}` : '';
    return `${opts.done ? '☑️' : '⬜'} ${t.title}${due} ${idChip(t.id)}${url ? `\n${url}` : ''}`;
  };
  const order = ['today', 'later', 'routine'];
  const sorted = [...shown].sort((a, b) => order.indexOf(a.scope) - order.indexOf(b.scope));
  return [
    `✅ *${opts.done ? 'Tareas hechas' : 'Tus pendientes'}* · ${todos.length}`,
    ...grouped(sorted, (t) => t.scope, (scope, n) => `${groupName[scope] ?? `*${scope}*`} · ${n}`, line),
    ...more,
  ].join('\n');
}

export function categoriesView(categories: Category[]): string {
  return [
    `📁 *Tus categorías* · ${categories.length}`,
    '',
    ...categories.map((c) => `📁 *${c.name.replace(/\*/g, '')}* ${idChip(c.id)}${c.description ? `\n> ${c.description}` : ''}`),
  ].join('\n');
}

const MEAL_ICON: Record<string, string> = { desayuno: '🍳', almuerzo: '🍽️', onces: '☕', cena: '🌙' };
const MEAL_ORDER = ['desayuno', 'almuerzo', 'onces', 'cena'];

export function mealPlanView(plans: MealPlan[]): string {
  const sorted = [...plans].sort((a, b) => a.plan_date.localeCompare(b.plan_date) || MEAL_ORDER.indexOf(a.meal_slot) - MEAL_ORDER.indexOf(b.meal_slot));
  const line = (p: MealPlan) => `${MEAL_ICON[p.meal_slot] ?? '🍴'} *${p.meal_slot.charAt(0).toUpperCase()}${p.meal_slot.slice(1)}:* ${p.title} ${idChip(p.id)}${p.notes ? `\n> ${p.notes}` : ''}`;
  return ['🍽️ *Plan de comidas*', ...grouped(sorted, (p) => p.plan_date, (date) => `*${dayLabel(date)}*`, line)].join('\n');
}

export function recipesView(recipes: { id: number; title: string; ingredients: string }[]): string {
  const line = (r: { id: number; title: string; ingredients: string }) => {
    const ing = r.ingredients.replace(/\s+/g, ' ').trim();
    return `📖 *${r.title.replace(/\*/g, '')}* ${idChip(r.id)}\n> ${ing.length > 110 ? `${ing.slice(0, 109)}…` : ing}`;
  };
  return [`📖 *Tus recetas* · ${recipes.length}`, '', ...recipes.map(line)].join('\n');
}

/** "4 × 12 · 20 kg", "3 × 45 s", "15 rep" - whatever the exercise has. */
function exerciseDose(e: Exercise): string {
  const amount = e.reps ? `${e.reps}${e.sets ? '' : ' rep'}` : e.seconds ? `${e.seconds} s` : '';
  const sets = e.sets && amount ? `${e.sets} × ${amount}` : e.sets ? `${e.sets} series` : amount;
  return [sets, e.weight_kg ? `${e.weight_kg} kg` : ''].filter(Boolean).join(' · ');
}

/** The exercises of a routine as a numbered block - what to do, in order. `withIds` adds each one's
 *  `#12` (for the list the person edits from; left out of the notice, which is just to follow). */
export function exercisesBlock(exercises: Exercise[], opts: { title?: string; withIds?: boolean } = {}): string {
  const rows = exercises.map((e, i) => {
    const dose = exerciseDose(e);
    return `${keycap(i + 1)} ${e.name}${dose ? ` — ${dose}` : ''}${opts.withIds ? ` ${idChip(e.id)}` : ''}`;
  });
  return [`🏋️ *${opts.title ?? 'Ejercicios'}* · ${exercises.length}`, ...rows].join('\n');
}

/** Tools whose result is already a designed message (see above) rather than data to phrase. */
const DESIGNED_TOOLS = new Set([
  'get_today_agenda', 'get_week_report', 'list_links', 'list_contacts', 'list_notes', 'list_lists', 'view_list',
  'list_reminders', 'list_todos', 'list_categories', 'list_meal_plan', 'list_recipes', 'list_exercises',
]);
const LIST_ROW_RE = /^(?:[-•]\s|`|\d+[.)]\s|[0-9]\uFE0F?\u20E3|#\d|[⬜☑✅🔗👤📝📋])/u;

/**
 * The model is told to pass a designed list through untouched, and mostly does - but sometimes it
 * re-types the list its own way. When the reply is itself a list and the last thing the turn
 * fetched was a designed one that isn't in it, the designed one goes out instead, followed by the
 * model's closing question if it had one. A reply that isn't a list (it only looked something up
 * to answer a specific question) is left alone.
 */
export function preferDesigned(reply: string, turnTools: { name: string; result: string }[]): string {
  const last = turnTools[turnTools.length - 1];
  if (!last || !DESIGNED_TOOLS.has(last.name)) return reply;
  const designed = last.result.trim();
  const header = designed.split('\n')[0];
  if (!/^\S+ \*[^*]+\*/.test(header) || reply.includes(header)) return reply;

  const lines = reply.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.filter((l) => LIST_ROW_RE.test(l)).length < 3) return reply;
  const closing = lines[lines.length - 1];
  const keepClosing = /\?\s*(\p{Extended_Pictographic}|\s)*$/u.test(closing) && !LIST_ROW_RE.test(closing);
  return keepClosing ? `${designed}\n\n${closing}` : designed;
}

const LIST_WORDS: Record<string, string> = {
  recordatorios: 'list_reminders',
  links: 'list_links',
  enlaces: 'list_links',
  contactos: 'list_contacts',
  notas: 'list_notes',
  listas: 'list_lists',
  pendientes: 'list_todos',
  tareas: 'list_todos',
  categorias: 'list_categories',
  recetas: 'list_recipes',
};
const LIST_ASK_RE = new RegExp(
  `^(?:(?:muestrame|mostrame|dime|dame|ver|listar|lista|listame|cuales son|que|quiero ver|a ver|enviame|mandame)\\s+)?(?:(?:todos|todas)\\s+)?(?:mis|los|las)?\\s*(${Object.keys(LIST_WORDS).join('|')})(?:\\s+(?:tengo|que tengo|hay|guardados|guardadas|pendientes|activos|programados))?$`,
);

/**
 * The list tool a plain "show me my X" asks for ("mis links", "qué recordatorios tengo",
 * "muéstrame mis contactos") - or null when the message is anything more than that. Those are
 * answered straight from the data with the designed list: no model turn, so nothing can be
 * re-typed, summarized or - as seen in testing - made up.
 */
export function listToolAsked(text: string): string | null {
  const t = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[¿?¡!.,]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t || t.length > 45 || /\d/.test(t)) return null;
  const m = LIST_ASK_RE.exec(t);
  return m ? LIST_WORDS[m[1]] : null;
}
