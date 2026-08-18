import type { Tool } from '../tool-registry.js';
import { todosRepo } from '../../db/repositories/todos.repo.js';
import { categoriesRepo } from '../../db/repositories/categories.repo.js';
import { linksRepo } from '../../db/repositories/links.repo.js';
import { todayLocal, normalizeDate } from '../../util/datetime.js';
import { resolveActingUser } from './act-on-behalf.js';

export const addTodoTool: Tool = {
  name: 'add_todo',
  description:
    'Agrega una tarea pendiente. Usa scope "today" para algo de hoy nada más, o "later" para algo sin fecha fija o ' +
    'para más adelante. Para hábitos/rutinas recurrentes usa create_routine en vez de esta. Si la tarea es hacer algo ' +
    'de un link ya guardado (ej. "mañana a la hora de almuerzo hago el ejercicio de tal link"), busca el link primero ' +
    '(list_links/search) y pasa su id en link_id.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Qué hay que hacer.' },
      scope: { type: 'string', enum: ['today', 'later'], description: 'today = solo hoy, later = para después.' },
      category: { type: 'string', description: 'Categoría opcional.' },
      due_date: { type: 'string', description: "Fecha objetivo 'YYYY-MM-DD' (opcional; today usa hoy por default)." },
      link_id: { type: 'number', description: 'Id de un link ya guardado que esta tarea referencia (opcional, ver list_links).' },
      target_user: {
        type: 'string',
        description: 'Solo administrador: nombre o número de otra persona con acceso, para agregarle la tarea a ella en vez de a ti.',
      },
    },
    required: ['title', 'scope'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const acting = resolveActingUser(ctx, args.target_user ? String(args.target_user) : undefined);
    if ('error' in acting) return acting.error;
    const { userId } = acting;

    const title = String(args.title ?? '').trim();
    if (!title) return 'Error: falta el título de la tarea.';
    const scope = args.scope === 'later' ? 'later' : 'today';

    let categoryId: number | null = null;
    if (args.category) categoryId = categoriesRepo.findOrCreate(userId, String(args.category)).id;

    let linkId: number | null = null;
    if (args.link_id !== undefined) {
      const link = linksRepo.getById(userId, Number(args.link_id));
      if (!link) return `No encontré el link #${args.link_id}.`;
      linkId = link.id;
    }

    const dueDate = args.due_date ? normalizeDate(String(args.due_date)).slice(0, 10) : scope === 'today' ? todayLocal() : null;

    const id = todosRepo.create(userId, { title, categoryId, scope, dueDate, linkId });
    return `Tarea #${id} agregada (${scope === 'today' ? 'hoy' : 'para después'})${linkId ? ` con link #${linkId}` : ''}.`;
  },
};
