import type { Tool } from '../tool-registry.js';
import { todosRepo } from '../../db/repositories/todos.repo.js';
import { categoriesRepo } from '../../db/repositories/categories.repo.js';
import { todayLocal, normalizeDate } from '../../util/datetime.js';

export const addTodoTool: Tool = {
  name: 'add_todo',
  description:
    'Agrega una tarea pendiente. Usa scope "today" para algo de hoy nada más, o "later" para algo sin fecha fija o para más adelante. Para hábitos/rutinas recurrentes usa create_routine en vez de esta.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Qué hay que hacer.' },
      scope: { type: 'string', enum: ['today', 'later'], description: 'today = solo hoy, later = para después.' },
      category: { type: 'string', description: 'Categoría opcional.' },
      due_date: { type: 'string', description: "Fecha objetivo 'YYYY-MM-DD' (opcional; today usa hoy por default)." },
    },
    required: ['title', 'scope'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const title = String(args.title ?? '').trim();
    if (!title) return 'Error: falta el título de la tarea.';
    const scope = args.scope === 'later' ? 'later' : 'today';

    let categoryId: number | null = null;
    if (args.category) categoryId = categoriesRepo.findOrCreate(ctx.userId, String(args.category)).id;

    const dueDate = args.due_date ? normalizeDate(String(args.due_date)).slice(0, 10) : scope === 'today' ? todayLocal() : null;

    const id = todosRepo.create(ctx.userId, { title, categoryId, scope, dueDate });
    return `Tarea #${id} agregada (${scope === 'today' ? 'hoy' : 'para después'}).`;
  },
};
