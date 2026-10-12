import { remindersView } from '../views.js';
import type { Tool } from '../tool-registry.js';
import { remindersRepo } from '../../db/repositories/reminders.repo.js';
import { categoriesRepo } from '../../db/repositories/categories.repo.js';
import { linksRepo } from '../../db/repositories/links.repo.js';
import { resolveActingUser } from './act-on-behalf.js';
import type { ReminderStatus } from '../../types/index.js';

export const listRemindersTool: Tool = {
  name: 'list_reminders',
  description: 'Lista mis recordatorios, opcionalmente filtrando por categoría o estado. Devuelve la lista ya diseñada para WhatsApp: envíala TAL CUAL.',
  parameters: {
    type: 'object',
    properties: {
      category: { type: 'string', description: 'Nombre de categoría para filtrar (opcional).' },
      status: {
        type: 'string',
        enum: ['pending', 'executed', 'failed', 'cancelled', 'missed', 'suspended'],
        description:
          'Estado a filtrar (default: pending). "missed" = quedó atrasado mientras el bot estuvo caído y no se ' +
          'mandó. "suspended" = se pausó solo por falta de confirmación (ver needsConfirmation en task-scheduler.ts) ' +
          'y se reactiva apenas la persona escriba cualquier cosa.',
      },
      target_user: {
        type: 'string',
        description: 'Solo administrador: nombre o número de otra persona con acceso, para ver SUS recordatorios en vez de los tuyos.',
      },
    },
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const acting = resolveActingUser(ctx, args.target_user ? String(args.target_user) : undefined);
    if ('error' in acting) return acting.error;
    const { userId } = acting;

    const status = (args.status as ReminderStatus) ?? 'pending';

    let categoryId: number | undefined;
    if (args.category) {
      const category = categoriesRepo.getByName(userId, String(args.category));
      if (!category) return `No tienes ninguna categoría llamada "${args.category}".`;
      categoryId = category.id;
    }

    const reminders = categoryId
      ? remindersRepo.listByCategory(userId, categoryId, status)
      : remindersRepo.listAll(userId, status);

    if (reminders.length === 0) return 'No tienes recordatorios que coincidan.';
    const titles: Partial<Record<ReminderStatus, string>> = { executed: 'Recordatorios enviados', cancelled: 'Recordatorios cancelados', suspended: 'Recordatorios suspendidos', missed: 'Recordatorios no enviados', failed: 'Recordatorios fallidos' };
    // Routines' own notice/check-in rows and the silent housekeeping ones aren't "reminders" to the person.
    const visible = reminders.filter((r) => r.kind === 'reminder' || r.kind === 'important_date' || r.kind === 'flexible' || r.kind === 'interval');
    if (visible.length === 0) return 'No tienes recordatorios que coincidan.';
    return remindersView(visible, (id) => linksRepo.getById(userId, id)?.url, { title: titles[status] });
  },
};
