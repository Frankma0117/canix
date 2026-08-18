import type { Tool } from '../tool-registry.js';
import { notesRepo } from '../../db/repositories/notes.repo.js';
import { categoriesRepo } from '../../db/repositories/categories.repo.js';
import { resolveActingUser } from './act-on-behalf.js';

export const editNoteTool: Tool = {
  name: 'edit_note',
  description: 'Edita el título, contenido y/o categoría de una nota ya guardada (usa list_notes primero para confirmar cuál es).',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'number', description: 'Id de la nota (ver list_notes).' },
      content: { type: 'string', description: 'Nuevo contenido (opcional).' },
      title: { type: 'string', description: 'Nuevo título (opcional).' },
      category: { type: 'string', description: 'Nueva categoría (opcional).' },
      target_user: {
        type: 'string',
        description: 'Solo administrador: nombre o número de otra persona con acceso, para editar SU nota en vez de la tuya.',
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
    const note = notesRepo.getById(userId, id);
    if (!note) return `No encontré la nota #${id}.`;

    let categoryId: number | null | undefined;
    if (args.category !== undefined) {
      categoryId = args.category ? categoriesRepo.findOrCreate(userId, String(args.category)).id : null;
    }

    notesRepo.update(userId, id, {
      content: args.content !== undefined ? String(args.content) : undefined,
      title: args.title !== undefined ? String(args.title) : undefined,
      categoryId,
    });

    return `Nota #${id} actualizada.`;
  },
};
