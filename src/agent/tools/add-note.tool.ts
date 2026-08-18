import type { Tool } from '../tool-registry.js';
import { notesRepo } from '../../db/repositories/notes.repo.js';
import { categoriesRepo } from '../../db/repositories/categories.repo.js';
import { resolveActingUser } from './act-on-behalf.js';

export const addNoteTool: Tool = {
  name: 'add_note',
  description:
    'Guarda una nota importante: información que quiero poder recuperar después (una idea, un dato, algo que me ' +
    'dijeron, instrucciones) - NO es una tarea ni un recordatorio, no tiene fecha ni hora ni se marca como cumplida. ' +
    'Úsala cuando pidan "anota que...", "guarda esta nota/dato", "que no se me olvide esto" sin que sea algo ' +
    'accionable en una fecha/hora concreta (para eso usa add_todo/schedule_reminder en vez de esta).',
  parameters: {
    type: 'object',
    properties: {
      content: { type: 'string', description: 'El contenido de la nota.' },
      title: { type: 'string', description: 'Título corto opcional.' },
      category: { type: 'string', description: 'Categoría opcional.' },
      target_user: {
        type: 'string',
        description: 'Solo administrador: nombre o número de otra persona con acceso, para guardarle la nota a ella en vez de a ti.',
      },
    },
    required: ['content'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const acting = resolveActingUser(ctx, args.target_user ? String(args.target_user) : undefined);
    if ('error' in acting) return acting.error;
    const { userId } = acting;

    const content = String(args.content ?? '').trim();
    if (!content) return 'Error: falta el contenido de la nota.';

    let categoryId: number | null = null;
    if (args.category) categoryId = categoriesRepo.findOrCreate(userId, String(args.category)).id;

    const title = args.title ? String(args.title).trim() : null;
    const id = notesRepo.create(userId, { content, categoryId, title });
    return `📝 Nota #${id}${title ? ` "${title}"` : ''} guardada.`;
  },
};
