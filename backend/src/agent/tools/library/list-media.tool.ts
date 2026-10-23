import type { Tool } from '../../tool-registry.js';
import { listMedia, relatedNotes } from '../../../services/library/library.service.js';
import { mediaView, type MediaGrouping } from '../../views.js';
import { MEDIA_KINDS, isMediaKind, normalizeListKind } from '../../../shared/utils/list-kinds.js';
import { resolveActingUser } from '../shared/act-on-behalf.js';

const GROUPS: Record<string, MediaGrouping> = { lista: 'list', genero: 'genre', autor: 'creator', tipo: 'kind' };

export const listMediaTool: Tool = {
  name: 'list_media',
  description:
    'Muestra mi biblioteca (películas, series, música, libros, juegos, podcasts) con resumen, link y notas relacionadas. ' +
    'Úsala para "qué película puedo ver" (kind=peliculas, status=pendientes: las que NO he visto), "mi música por género", ' +
    '"qué libros de García Márquez tengo", "series que ya vi". Para recomendarme algo, elige de lo que devuelve y ' +
    'explícame por qué con su resumen; manda la lista TAL CUAL si te la pedí.',
  parameters: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: [...MEDIA_KINDS], description: 'Tipo; vacío = toda la biblioteca.' },
      status: { type: 'string', enum: ['pendientes', 'hechos', 'todos'], description: 'pendientes = por ver/escuchar/leer (default todos).' },
      genre: { type: 'string' },
      creator: { type: 'string', description: 'Director, artista o autor.' },
      search: { type: 'string', description: 'Palabra a buscar en título, resumen, género o notas.' },
      group_by: { type: 'string', enum: Object.keys(GROUPS), description: 'Cómo agrupar (default lista).' },
      target_user: { type: 'string', description: 'Solo administrador: ver la biblioteca de otra persona.' },
    },
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const acting = resolveActingUser(ctx, args.target_user ? String(args.target_user) : undefined);
    if ('error' in acting) return acting.error;
    const { userId } = acting;
    const kind = args.kind ? normalizeListKind(args.kind) : null;
    const done = args.status === 'pendientes' ? false : args.status === 'hechos' ? true : undefined;
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
    const items = listMedia(userId, {
      kind: isMediaKind(kind) ? kind : undefined,
      done,
      genre: str(args.genre),
      creator: str(args.creator),
      search: str(args.search),
    });
    return mediaView(items, {
      kind: isMediaKind(kind) ? kind : undefined,
      done,
      groupBy: GROUPS[String(args.group_by ?? '')] ?? (kind ? 'list' : 'kind'),
      notesFor: (item) => relatedNotes(userId, item, 1),
    });
  },
};
