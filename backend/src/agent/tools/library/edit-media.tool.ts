import type { Tool } from '../../tool-registry.js';
import { checklistItemsModel } from '../../../models/checklists.model.js';
import { findMedia, resolveMediaList } from '../../../services/library/library.service.js';
import { MEDIA_KINDS, MEDIA_KIND_WORDS, isMediaKind, normalizeListKind } from '../../../shared/utils/list-kinds.js';
import { resolveActingUser } from '../shared/act-on-behalf.js';

export const editMediaTool: Tool = {
  name: 'edit_media',
  description:
    'Cambia algo de un ítem de mi biblioteca: marcarlo como visto/escuchado/leído (done), calificarlo, corregir autor, ' +
    'género, año, resumen o notas, moverlo a otra de mis listas, o borrarlo (delete). Identifícalo por su título ' +
    '(o la marca ⟦id⟧ de list_media).',
  parameters: {
    type: 'object',
    properties: {
      item: { type: 'string', description: 'Título del ítem, o su id.' },
      kind: { type: 'string', enum: [...MEDIA_KINDS], description: 'Tipo, para desempatar títulos repetidos.' },
      done: { type: 'boolean' },
      rating: { type: 'integer', minimum: 1, maximum: 5 },
      title: { type: 'string', description: 'Nuevo título.' },
      creator: { type: 'string' },
      genre: { type: 'string' },
      year: { type: 'integer' },
      summary: { type: 'string' },
      notes: { type: 'string' },
      move_to_list: { type: 'string', description: 'Nombre de otra lista mía (se crea si no existe).' },
      delete: { type: 'boolean', description: 'true para borrarlo de la biblioteca.' },
      target_user: { type: 'string', description: 'Solo administrador: otra persona con acceso.' },
    },
    required: ['item'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const acting = resolveActingUser(ctx, args.target_user ? String(args.target_user) : undefined);
    if ('error' in acting) return acting.error;
    const { userId } = acting;
    const kindArg = args.kind ? normalizeListKind(args.kind) : null;
    const kind = isMediaKind(kindArg) ? kindArg : undefined;
    const query = String(args.item ?? '').replace(/[⟦⟧#]/g, '').trim();
    if (!query) return 'Me falta cuál ítem.';

    const byId = /^\d+$/.test(query) ? findMedia(userId, '', kind).filter((i) => i.id === Number(query)) : [];
    const matches = byId.length ? byId : findMedia(userId, query, kind);
    if (matches.length === 0) return `No encontré "${query}" en tu biblioteca. Revisa con list_media.`;
    if (matches.length > 1) return `Hay varios que coinciden: ${matches.slice(0, 6).map((m) => `"${m.title}" (${m.list_name})`).join(', ')}. ¿Cuál?`;
    const item = matches[0];

    if (args.delete === true) {
      checklistItemsModel.remove(userId, item.id);
      return `Listo, borré "${item.title}" de tu biblioteca.`;
    }
    const str = (v: unknown) => (typeof v === 'string' ? v.trim() || null : undefined);
    const int = (v: unknown) => (v === undefined || v === null || v === '' ? undefined : Number.isInteger(Number(v)) ? Number(v) : undefined);
    const rating = int(args.rating);
    const itemKind = isMediaKind(item.kind) ? item.kind : 'peliculas';
    const list = typeof args.move_to_list === 'string' && args.move_to_list.trim() ? resolveMediaList(userId, itemKind, args.move_to_list) : undefined;
    checklistItemsModel.updateMedia(userId, item.id, {
      title: typeof args.title === 'string' && args.title.trim() ? args.title.trim() : undefined,
      creator: str(args.creator),
      genre: str(args.genre),
      year: int(args.year),
      summary: str(args.summary),
      notes: str(args.notes),
      rating: rating && rating >= 1 && rating <= 5 ? rating : undefined,
      checklistId: list?.id,
    });
    if (typeof args.done === 'boolean') checklistItemsModel.setChecked(userId, item.id, args.done);
    const words = MEDIA_KIND_WORDS[itemKind];
    const changes = [
      typeof args.done === 'boolean' ? (args.done ? `marcada como ${words.done}` : `de nuevo ${words.pending}`) : '',
      rating ? `${'⭐'.repeat(rating)}` : '',
      list ? `movida a "${list.name}"` : '',
    ].filter(Boolean);
    return `Listo, actualicé "${item.title}"${changes.length ? `: ${changes.join(', ')}` : ''}.`;
  },
};
