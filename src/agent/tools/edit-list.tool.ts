import type { Tool } from '../tool-registry.js';
import { checklistsRepo } from '../../db/repositories/checklists.repo.js';
import { LIST_KIND_INFO, normalizeListKind } from '../../util/list-kinds.js';
import { resolveChecklist } from './resolve-checklist.js';
import { resolveActingUser } from './act-on-behalf.js';

export const editListTool: Tool = {
  name: 'edit_list',
  description:
    'Cambia el nombre de una lista y/o de qué es (música, películas, series, libros, juegos, compras u otra) sin tocar ' +
    'sus ítems. Úsala para "esa lista es de series", "renombra la lista X a Y".',
  parameters: {
    type: 'object',
    properties: {
      list: { type: 'string', description: 'Nombre o id de la lista.' },
      name: { type: 'string', description: 'Nuevo nombre (opcional).' },
      kind: {
        type: 'string',
        enum: ['musica', 'peliculas', 'series', 'libros', 'juegos', 'compras', 'general'],
        description: 'De qué es la lista (opcional).',
      },
      target_user: {
        type: 'string',
        description: 'Solo administrador: nombre o número de otra persona con acceso, para editar SU lista en vez de la tuya.',
      },
    },
    required: ['list'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const acting = resolveActingUser(ctx, args.target_user ? String(args.target_user) : undefined);
    if ('error' in acting) return acting.error;
    const { userId } = acting;

    const list = resolveChecklist(userId, String(args.list ?? ''));
    if ('error' in list) return list.error;

    const name = args.name ? String(args.name).trim() : '';
    const kind = normalizeListKind(args.kind);
    if (args.kind && !kind) return 'No reconocí ese tipo de lista: usa musica, peliculas, series, libros, juegos, compras o general.';
    if (!name && !kind) return 'Dime qué cambiar: el nombre, de qué es la lista, o ambos.';

    if (name) checklistsRepo.rename(userId, list.id, name);
    if (kind) checklistsRepo.setKind(userId, list.id, kind);
    const changes = [name ? `ahora se llama "${name}"` : null, kind ? `quedó como lista de ${LIST_KIND_INFO[kind].label.toLowerCase()} ${LIST_KIND_INFO[kind].emoji}` : null].filter(Boolean);
    return `Listo, la lista #${list.id} ${changes.join(' y ')}.`;
  },
};
