import type { Tool } from '../tool-registry.js';
import { todosRepo } from '../../db/repositories/todos.repo.js';
import { categoriesRepo } from '../../db/repositories/categories.repo.js';
import type { RecurrenceFreq } from '../../types/index.js';

export const createRoutineTool: Tool = {
  name: 'create_routine',
  description:
    'Crea un hábito/rutina recurrente para hacerle seguimiento diario o semanal (ej. "ejercicio", "leer 20 minutos").',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Nombre del hábito/rutina.' },
      category: { type: 'string', description: 'Categoría opcional.' },
      frequency: {
        type: 'string',
        enum: ['daily', 'weekly'],
        description: 'Con qué frecuencia se espera hacerlo. Default "daily".',
      },
    },
    required: ['title'],
    additionalProperties: false,
  },

  async execute(args) {
    const title = String(args.title ?? '').trim();
    if (!title) return 'Error: falta el nombre de la rutina.';

    let categoryId: number | null = null;
    if (args.category) categoryId = categoriesRepo.findOrCreate(String(args.category)).id;

    const freq: RecurrenceFreq = args.frequency === 'weekly' ? 'weekly' : 'daily';
    const id = todosRepo.create({ title, categoryId, scope: 'routine', dueDate: null, recurrenceFreq: freq });
    return `Rutina #${id} "${title}" creada (${freq === 'daily' ? 'diaria' : 'semanal'}). Usa checkin_routine para marcar avances.`;
  },
};
