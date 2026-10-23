import type { Tool } from '../../tool-registry.js';
import { todosModel } from '../../../models/todos.model.js';
import { categoriesModel } from '../../../models/categories.model.js';
import { normalizeDate } from '../../../shared/utils/datetime.js';
import { resolveActingUser } from '../shared/act-on-behalf.js';

export const editTodoTool: Tool = {
  name: 'edit_todo',
  description:
    'Edita una tarea existente de "hoy" o "para después" (título, categoría y/o fecha) sin borrarla y recrearla. ' +
    'Para rutinas usa edit_routine en vez de esta - esta tool rechaza ids de rutinas.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'number', description: 'Id de la tarea a editar.' },
      title: { type: 'string', description: 'Nuevo título (opcional, deja igual si no se manda).' },
      category: { type: 'string', description: 'Nueva categoría (opcional).' },
      due_date: { type: 'string', description: "Nueva fecha objetivo 'YYYY-MM-DD' (opcional)." },
      target_user: {
        type: 'string',
        description: 'Solo administrador: nombre o número de otra persona con acceso, para editar SU tarea en vez de la tuya.',
      },
    },
    required: ['id'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const acting = resolveActingUser(ctx, args.target_user ? String(args.target_user) : undefined);
    if ('error' in acting) return acting.error;
    const { userId } = acting;

    const id = Number(args.id);
    const todo = todosModel.getById(userId, id);
    if (!todo) return `No encontré la tarea ⟦${id}⟧.`;
    if (todo.scope === 'routine') return `⟦${id}⟧ es una rutina, no una tarea suelta - usa edit_routine para editarla.`;

    let categoryId: number | undefined;
    if (args.category) categoryId = categoriesModel.findOrCreate(userId, String(args.category)).id;

    const dueDate = args.due_date ? normalizeDate(String(args.due_date)).slice(0, 10) : undefined;

    todosModel.update(userId, id, {
      title: args.title ? String(args.title) : undefined,
      categoryId,
      dueDate,
    });

    const updated = todosModel.getById(userId, id)!;
    return `Listo, actualicé la tarea ⟦${id}⟧: "${updated.title}"${updated.due_date ? ` (${updated.due_date})` : ''}.`;
  },
};
