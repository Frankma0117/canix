import type { Tool } from '../tool-registry.js';
import { todosRepo } from '../../db/repositories/todos.repo.js';
import { categoriesRepo } from '../../db/repositories/categories.repo.js';
import { normalizeDate } from '../../util/datetime.js';

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
    },
    required: ['id'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const id = Number(args.id);
    const todo = todosRepo.getById(ctx.userId, id);
    if (!todo) return `No encontré la tarea #${id}.`;
    if (todo.scope === 'routine') return `#${id} es una rutina, no una tarea suelta - usa edit_routine para editarla.`;

    let categoryId: number | undefined;
    if (args.category) categoryId = categoriesRepo.findOrCreate(ctx.userId, String(args.category)).id;

    const dueDate = args.due_date ? normalizeDate(String(args.due_date)).slice(0, 10) : undefined;

    todosRepo.update(ctx.userId, id, {
      title: args.title ? String(args.title) : undefined,
      categoryId,
      dueDate,
    });

    const updated = todosRepo.getById(ctx.userId, id)!;
    return `Tarea #${id} actualizada: "${updated.title}"${updated.due_date ? ` (${updated.due_date})` : ''}.`;
  },
};
