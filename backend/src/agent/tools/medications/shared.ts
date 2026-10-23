import { medicationsModel } from '../../../models/medications.model.js';
import type { Medication } from '../../../entities/index.js';

/** A medication named by the person (or by its internal ref): exactly one, or the reason why not. */
export function resolveMedication(userId: number, query: string): Medication | { error: string } {
  const text = query.replace(/[⟦⟧#]/g, '').trim();
  if (!text) return { error: 'Me falta cuál medicamento.' };
  if (/^\d+$/.test(text)) {
    const byId = medicationsModel.getById(userId, Number(text));
    if (byId) return byId;
  }
  const matches = medicationsModel.findByName(userId, text);
  const exact = matches.filter((m) => m.name.toLowerCase() === text.toLowerCase());
  const pick = exact.length === 1 ? exact : matches;
  if (pick.length === 1) return pick[0];
  if (pick.length === 0) return { error: `No encontré "${text}" en tus medicamentos. Revisa con list_medications.` };
  return { error: `Hay varios que coinciden: ${pick.map((m) => `"${m.name}"`).join(', ')}. ¿Cuál?` };
}

const WEEKDAY_WORDS: Record<string, number> = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, miércoles: 3, jueves: 4, viernes: 5, sabado: 6, sábado: 6 };

/** [1,3,5] / ["lunes","miércoles"] -> weekday numbers; null = every day. */
export function parseWeekdays(raw: unknown): number[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const days = raw
    .map((d) => (typeof d === 'number' ? d : WEEKDAY_WORDS[String(d).trim().toLowerCase()] ?? Number(d)))
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  const unique = [...new Set(days)].sort();
  return unique.length && unique.length < 7 ? unique : null;
}
