import type { Tool } from '../tool-registry.js';
import { remindersRepo } from '../../db/repositories/reminders.repo.js';
import { categoriesRepo } from '../../db/repositories/categories.repo.js';
import { linksRepo } from '../../db/repositories/links.repo.js';
import { resolveActingUser } from './act-on-behalf.js';
import type { ReminderStatus } from '../../types/index.js';

export const listRemindersTool: Tool = {
  name: 'list_reminders',
  description: 'Lista mis recordatorios, opcionalmente filtrando por categoría o estado.',
  parameters: {
    type: 'object',
    properties: {
      category: { type: 'string', description: 'Nombre de categoría para filtrar (opcional).' },
      status: {
        type: 'string',
        enum: ['pending', 'executed', 'failed', 'cancelled'],
        description: 'Estado a filtrar (default: pending).',
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
      if (!category) return `No existe la categoría "${args.category}".`;
      categoryId = category.id;
    }

    const reminders = categoryId
      ? remindersRepo.listByCategory(userId, categoryId, status)
      : remindersRepo.listAll(userId, status);

    if (reminders.length === 0) return 'No hay recordatorios que coincidan.';
    return reminders
      .map((r) => {
        const link = r.link_id ? linksRepo.getById(userId, r.link_id) : undefined;
        const pausedNote = r.paused_until ? ` ⏸️ pausado hasta ${r.paused_until.slice(0, 10)}` : '';
        return `#${r.id} ${r.run_at} — ${r.message}${link ? ` 🔗${link.url}` : ''}${pausedNote}`;
      })
      .join('\n');
  },
};
