import { todosView, routinesView } from '../views.js';
import type { Tool } from '../tool-registry.js';
import { todosRepo } from '../../db/repositories/todos.repo.js';
import { categoriesRepo } from '../../db/repositories/categories.repo.js';
import { linksRepo } from '../../db/repositories/links.repo.js';
import { resolveActingUser } from './act-on-behalf.js';
import type { TodoScope, TodoStatus } from '../../types/index.js';

export const listTodosTool: Tool = {
  name: 'list_todos',
  description:
    'Lista tareas pendientes (o hechas), filtrando por scope ("today", "later"), categoría y/o estado. Las RUTINAS no salen aquí salvo que pases scope "routine" (así se listan las rutinas con su id). Devuelve la lista ya diseñada para WhatsApp: envíala TAL CUAL.',
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

    // Routines aren't tasks: they only show when asked for by name (scope "routine").
    const wanted = args.scope ? todos : todos.filter((t) => t.scope !== 'routine');
    if (wanted.length === 0) return args.scope === 'routine' ? 'No tienes rutinas creadas.' : 'No tienes tareas que coincidan.';
    if (args.scope === 'routine') return routinesView(wanted);
    return todosView(wanted, (id) => linksRepo.getById(userId, id)?.url, { done: args.status === 'done' });
  },
};
