import { todosView, routinesView } from '../../views.js';
import type { Tool } from '../../tool-registry.js';
import { todosModel } from '../../../models/todos.model.js';
import { categoriesModel } from '../../../models/categories.model.js';
import { linksModel } from '../../../models/links.model.js';
import { resolveActingUser } from '../shared/act-on-behalf.js';
import type { TodoScope, TodoStatus } from '../../../entities/index.js';

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
      const category = categoriesModel.getByName(userId, String(args.category));
      if (!category) return `No tienes ninguna categoría llamada "${args.category}".`;
      categoryId = category.id;
    }

    const todos = todosModel.list(userId, {
      scope: args.scope as TodoScope | undefined,
      status: (args.status as TodoStatus | undefined) ?? 'pending',
      categoryId,
    });

    // Routines aren't tasks: they only show when asked for by name (scope "routine").
    const wanted = args.scope ? todos : todos.filter((t) => t.scope !== 'routine');
    if (wanted.length === 0) return args.scope === 'routine' ? 'No tienes rutinas creadas.' : 'No tienes tareas que coincidan.';
    if (args.scope === 'routine') {
      // Boxeo, zumba, gym... live in Ejercicios (list_workouts): only named here so they aren't missed.
      const plain = wanted.filter((t) => !t.workout_kind);
      const workouts = wanted.filter((t) => t.workout_kind);
      const pointer = workouts.length ? `> Tus ejercicios (${workouts.map((t) => t.title).join(', ')}) están en *Ejercicios*: escribe *ejercicios* para verlos` : '';
      if (!plain.length) return `No tienes rutinas aparte de tus ejercicios.\n${pointer}`;
      return [routinesView(plain), pointer].filter(Boolean).join('\n\n');
    }
    return todosView(wanted, (id) => linksModel.getById(userId, id)?.url, { done: args.status === 'done' });
  },
};
