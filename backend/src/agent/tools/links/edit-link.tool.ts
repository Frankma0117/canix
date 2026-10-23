import type { Tool } from '../../tool-registry.js';
import { linksModel } from '../../../models/links.model.js';
import { categoriesModel } from '../../../models/categories.model.js';
import { resolveActingUser } from '../shared/act-on-behalf.js';
import { normalizeHttpUrl } from '../../../shared/utils/urls.js';

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
    const link = linksModel.getById(userId, id);
    if (!link) return `No encontré el link ⟦${id}⟧.`;

    let categoryId: number | undefined;
    if (args.category) {
      const category = categoriesModel.getByName(userId, String(args.category));
      if (!category) return `La categoría "${args.category}" no existe todavía - usa list_categories o create_category primero.`;
      categoryId = category.id;
    }

    const url = args.url ? normalizeHttpUrl(args.url) : undefined;
    if (url === null) return 'Esa URL no es un link web válido (debe empezar por http:// o https://).';
    linksModel.update(userId, id, {
      url,
      title: args.title !== undefined ? String(args.title) : undefined,
      description: args.description !== undefined ? String(args.description) : undefined,
      categoryId,
    });

    const updated = linksModel.getById(userId, id)!;
    return `Listo, actualicé el link ⟦${id}⟧: ${updated.title || updated.description || updated.url} 🔗`;
  },
};
