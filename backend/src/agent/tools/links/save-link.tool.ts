import type { Tool } from '../../tool-registry.js';
import { linksModel } from '../../../models/links.model.js';
import { categoriesModel } from '../../../models/categories.model.js';
import { resolveActingUser } from '../shared/act-on-behalf.js';
import { normalizeHttpUrl } from '../../../shared/utils/urls.js';

export const saveLinkTool: Tool = {
  name: 'save_link',
  description:
    'Guarda un link ya clasificado. Solo úsala después de: 1) mostrar list_categories y que el usuario elija una ' +
    'categoría EXISTENTE (o confirme explícitamente crear una nueva con create_category), y 2) tener una breve ' +
    'descripción. La categoría debe existir ya - esta tool NO crea categorías nuevas por su cuenta, para evitar ' +
    'que queden categorías inventadas o mal escritas que el usuario nunca pidió.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'La URL a guardar.' },
      category: { type: 'string', description: 'Nombre EXACTO de una categoría que ya existe (ver list_categories).' },
      description: { type: 'string', description: 'Breve descripción de qué es el link.' },
      title: { type: 'string', description: 'Título corto opcional.' },
      target_user: {
        type: 'string',
        description: 'Solo administrador: nombre o número de otra persona con acceso, para guardárselo a ella en vez de a ti.',
      },
    },
    required: ['url', 'category'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const acting = resolveActingUser(ctx, args.target_user ? String(args.target_user) : undefined);
    if ('error' in acting) return acting.error;
    const { userId } = acting;

    const url = normalizeHttpUrl(args.url);
    if (!url) return 'Me falta la URL, o no es un link web válido (debe empezar por http:// o https://).';
    const categoryName = String(args.category ?? '').trim();
    if (!categoryName) return 'Me falta la categoría.';

    const category = categoriesModel.getByName(userId, categoryName);
    if (!category) {
      return (
        `La categoría "${categoryName}" no existe todavía. Usa list_categories para mostrarme las ` +
        'categorías reales y preguntarme en cuál, o create_category si confirmo crear una nueva - no la inventes tú.'
      );
    }
    const id = linksModel.create(userId, {
      url,
      categoryId: category.id,
      title: args.title ? String(args.title) : null,
      description: args.description ? String(args.description) : null,
    });
    return `Listo, guardé el link (⟦${id}⟧) en la categoría "${category.name}" 🔗`;
  },
};
