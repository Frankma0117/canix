import type { Tool } from '../tool-registry.js';
import { todosRepo } from '../../db/repositories/todos.repo.js';
import { categoriesRepo } from '../../db/repositories/categories.repo.js';
import { linksRepo } from '../../db/repositories/links.repo.js';
import { resolveActingUser } from './act-on-behalf.js';
import type { TodoScope, TodoStatus } from '../../types/index.js';

export const listTodosTool: Tool = {
  name: 'list_todos',
  description:
    'Lista tareas pendientes (o hechas), filtrando por scope ("today", "later", "routine"), categoría y/o estado.',
  parameters: {
    type: 'object',
    properties: {
      scope: { type: 'string', enum: ['today', 'later', 'routine'] },
      status: { type: 'string', enum: ['pending', 'done', 'skipped'], description: 'Default: pending.' },
      category: { type: 'string', description: 'Nombre de categoría para filtrar (opcional).' },
      target_user: {
        type: 'string',
        description: 'Solo administrador: nombre o número de otra persona con acceso, para ver SUS tareas en vez de las tuyas.',
      },
    },
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const acting = resolveActingUser(ctx, args.target_user ? String(args.target_user) : undefined);
    if ('error' in acting) return acting.error;
    const { userId } = acting;

    let categoryId: number | undefined;
    if (args.category) {
      const category = categoriesRepo.getByName(userId, String(args.category));
      if (!category) return `No tienes ninguna categoría llamada "${args.category}".`;
      categoryId = category.id;
    }

    const todos = todosRepo.list(userId, {
      scope: args.scope as TodoScope | undefined,
      status: (args.status as TodoStatus | undefined) ?? 'pending',
      categoryId,
    });

    if (todos.length === 0) return 'No tienes tareas que coincidan.';
    return todos
      .map((t) => {
        const link = t.link_id ? linksRepo.getById(userId, t.link_id) : undefined;
        return (
          `#${t.id} ${t.title}${t.due_date ? ` (${t.due_date})` : ''} [${t.scope}]` +
          (t.scope === 'routine' && t.reminder_time ? ` ⏰${t.reminder_time} (${t.duration_minutes}min)` : '') +
          (link ? ` 🔗${link.url}` : '')
        );
      })
      .join('\n');
  },
};
