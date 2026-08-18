import type { Tool } from '../tool-registry.js';
import { linksRepo } from '../../db/repositories/links.repo.js';
import { categoriesRepo } from '../../db/repositories/categories.repo.js';
import { resolveActingUser } from './act-on-behalf.js';

export const editLinkTool: Tool = {
  name: 'edit_link',
  description: 'Edita un link ya guardado (url, título, descripción y/o categoría) sin borrarlo y crear uno nuevo.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'number', description: 'Id del link a editar.' },
      url: { type: 'string', description: 'Nueva URL (opcional).' },
      title: { type: 'string', description: 'Nuevo título (opcional).' },
      description: { type: 'string', description: 'Nueva descripción (opcional).' },
      category: { type: 'string', description: 'Nueva categoría EXISTENTE (opcional, ver list_categories).' },
      target_user: {
        type: 'string',
        description: 'Solo administrador: nombre o número de otra persona con acceso, para editar SU link en vez del tuyo.',
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
    const link = linksRepo.getById(userId, id);
    if (!link) return `No encontré el link #${id}.`;

    let categoryId: number | undefined;
    if (args.category) {
      const category = categoriesRepo.getByName(userId, String(args.category));
      if (!category) return `Error: la categoría "${args.category}" no existe todavía. Usa list_categories o create_category primero.`;
      categoryId = category.id;
    }

    linksRepo.update(userId, id, {
      url: args.url ? String(args.url) : undefined,
      title: args.title !== undefined ? String(args.title) : undefined,
      description: args.description !== undefined ? String(args.description) : undefined,
      categoryId,
    });

    const updated = linksRepo.getById(userId, id)!;
    return `Link #${id} actualizado: ${updated.title || updated.description || updated.url}.`;
  },
};
