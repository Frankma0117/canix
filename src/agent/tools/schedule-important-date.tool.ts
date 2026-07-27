import type { Tool } from '../tool-registry.js';
import { remindersRepo } from '../../db/repositories/reminders.repo.js';
import { categoriesRepo } from '../../db/repositories/categories.repo.js';
import { contactsRepo } from '../../db/repositories/contacts.repo.js';
import { normalizeDate, parseWall, nowLocal, addDays, addMonths } from '../../util/datetime.js';
import { phoneToJid, isJid } from '../../util/jid.js';
import type { RecurrenceFreq } from '../../types/index.js';

export const scheduleImportantDateTool: Tool = {
  name: 'schedule_important_date',
  description:
    'Programa una fecha que NO se puede olvidar: cumpleaños, aniversarios, una reunión importante. ' +
    'A diferencia de schedule_reminder, además del aviso el día exacto manda un aviso previo (advance_notice_days ' +
    'días antes) para que no agarre de sorpresa. Usa esta en vez de schedule_reminder quiere algo importante y no un recordatorio casual.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Qué es (ej. "Cumpleaños de Ana", "Reunión con el banco").' },
      date: { type: 'string', description: "Fecha del evento, 'YYYY-MM-DD'." },
      time: { type: 'string', description: "Hora del aviso el día del evento, 'HH:mm'. Default '09:00'." },
      recurrence: {
        type: 'string',
        enum: ['yearly', 'once'],
        description: '"yearly" para cumpleaños/aniversarios (default), "once" para eventos de una sola vez como una reunión.',
      },
      advance_notice_days: {
        type: 'number',
        description: 'Días antes para mandar un aviso previo además del día exacto. Default 3 para "yearly", 1 para "once". 0 = sin aviso previo.',
      },
      category: { type: 'string', description: 'Categoría opcional para clasificarlo.' },
      target: {
        type: 'string',
        description: 'A quién avisarle: nombre de un contacto o número. Si se omite, es para mí.',
      },
    },
    required: ['title', 'date'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const title = String(args.title ?? '').trim();
    if (!title) return 'Error: falta el título de la fecha importante.';

    const time = /^\d{1,2}:\d{2}$/.test(String(args.time ?? '')) ? String(args.time) : '09:00';
    let runAt = normalizeDate(`${String(args.date ?? '')} ${time}`);

    const recurrence: RecurrenceFreq = args.recurrence === 'once' ? 'none' : 'yearly';

    // A yearly date already past this year just means "next occurrence is next year" - roll it
    // forward instead of rejecting it (that's the whole point of "cumpleaños que no suelo recordar").
    if (parseWall(runAt) <= parseWall(nowLocal())) {
      if (recurrence === 'yearly') runAt = addMonths(runAt, 12);
      else return 'Esa fecha ya pasó. Si es un evento futuro, dame la fecha correcta.';
    }

    let targetJid: string | null = null;
    if (args.target) {
      const raw = String(args.target);
      if (isJid(raw)) {
        targetJid = raw;
      } else {
        const matches = contactsRepo.findByName(ctx.userId, raw);
        if (matches.length === 1) targetJid = contactsRepo.sendTarget(matches[0]);
        else if (/^[\d\s()+-]{6,}$/.test(raw)) targetJid = phoneToJid(raw);
        else if (matches.length > 1) return `Hay varios contactos que coinciden con "${raw}", sé más específico.`;
        else return `No encontré ningún contacto llamado "${raw}".`;
      }
    }

    let categoryId: number | null = null;
    if (args.category) categoryId = categoriesRepo.findOrCreate(ctx.userId, String(args.category)).id;

    const finalTargetJid = targetJid ?? ctx.ownerJid;

    const mainId = remindersRepo.create(ctx.userId, {
      message: `🎉 ${title}`,
      runAt,
      targetJid: finalTargetJid,
      categoryId,
      recurrenceFreq: recurrence,
      recurrenceInterval: 1,
      kind: 'important_date',
    });

    const defaultAdvance = recurrence === 'yearly' ? 3 : 1;
    const advanceDays = args.advance_notice_days === undefined ? defaultAdvance : Number(args.advance_notice_days);

    let noticeNote = '';
    if (advanceDays > 0) {
      const noticeRunAt = addDays(runAt, -advanceDays);
      if (parseWall(noticeRunAt) > parseWall(nowLocal())) {
        const noticeId = remindersRepo.create(ctx.userId, {
          message: `📅 En ${advanceDays} día(s): ${title}`,
          runAt: noticeRunAt,
          targetJid: finalTargetJid,
          categoryId,
          recurrenceFreq: recurrence,
          recurrenceInterval: 1,
          kind: 'important_date',
        });
        noticeNote = ` + aviso previo #${noticeId} el ${noticeRunAt.slice(0, 10)}`;
      }
    }

    const recurrenceNote = recurrence === 'yearly' ? ' (se repite cada año)' : '';
    return `Fecha importante #${mainId} "${title}" programada para ${runAt}${recurrenceNote}${noticeNote}.`;
  },
};
