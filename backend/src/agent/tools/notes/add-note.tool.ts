import type { Tool } from '../../tool-registry.js';
import { notesModel } from '../../../models/notes.model.js';
import { categoriesModel } from '../../../models/categories.model.js';
import { resolveActingUser } from '../shared/act-on-behalf.js';

export const addNoteTool: Tool = {
  name: 'add_note',
  description:
    'Guarda una nota importante: información que quiero poder recuperar después (una idea, un dato, algo que me ' +
    'dijeron, instrucciones) - NO es una tarea ni un recordatorio, no tiene fecha ni hora ni se marca como cumplida. ' +
    'Úsala cuando pidan "anota que...", "guarda esta nota/dato", "que no se me olvide esto" sin que sea algo ' +
    'accionable en una fecha/hora concreta (para eso usa add_todo/schedule_reminder en vez de esta). ' +
    'Las notas se guardan como TIPS CLAVE: resume lo que me dijeron en puntos cortos y concretos (datos, cifras, ' +
    'nombres, pasos), sin relleno ni perder nada importante. Si además hay algo que hacer "en algún momento", ' +
    'usa schedule_free_slot_reminder con note_tips en vez de esta.',
  parameters: {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: 'Los tips clave, una línea por tip empezando con "• " (ej. "• Aceite 5W-30\\n• Cambio cada 5.000 km").',
      },
      title: { type: 'string', description: 'Título corto del tema (ej. "Mantenimiento del carro"). Ponlo siempre.' },
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
    if (!content) return 'Me falta el contenido de la nota.';

    let categoryId: number | null = null;
    if (args.category) categoryId = categoriesModel.findOrCreate(userId, String(args.category)).id;

    const title = args.title ? String(args.title).trim() : null;
    const id = notesModel.create(userId, { content, categoryId, title });
    return `📝 Listo, guardé la nota ⟦${id}⟧${title ? ` "${title}"` : ''}.`;
  },
};
