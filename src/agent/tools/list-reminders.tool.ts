import type { Tool } from '../tool-registry.js';
import { remindersRepo } from '../../db/repositories/reminders.repo.js';
import { categoriesRepo } from '../../db/repositories/categories.repo.js';
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
    },
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const status = (args.status as ReminderStatus) ?? 'pending';

    let categoryId: number | undefined;
    if (args.category) {
      const category = categoriesRepo.getByName(ctx.userId, String(args.category));
      if (!category) return `No existe la categoría "${args.category}".`;
      categoryId = category.id;
    }

    const reminders = categoryId
      ? remindersRepo.listByCategory(ctx.userId, categoryId, status)
      : remindersRepo.listAll(ctx.userId, status);

    if (reminders.length === 0) return 'No hay recordatorios que coincidan.';
    return reminders.map((r) => `#${r.id} ${r.run_at} — ${r.message}`).join('\n');
  },
};
