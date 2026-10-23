import type { Tool } from '../../tool-registry.js';
import { saveMedia } from '../../../services/library/library.service.js';
import { MEDIA_KINDS, MEDIA_KIND_WORDS, LIST_KIND_INFO, normalizeListKind, isMediaKind } from '../../../shared/utils/list-kinds.js';
import { internalRef } from '../../../shared/utils/wa-format.js';
import { resolveActingUser } from '../shared/act-on-behalf.js';

export const saveMediaTool: Tool = {
  name: 'save_media',
  description:
    'Guarda una película, serie, canción/álbum, libro, juego o podcast en mi biblioteca (mis listas especiales de ese tipo). ' +
    'Úsala cuando te digo que algo es una película/serie/canción/libro ("guarda Inception", "este link es una película sobre ' +
    'viajes en el tiempo", "agrega esta canción de Bad Bunny a mi música para entrenar"). Si viene con un link, pásalo en url: ' +
    'la tool lo guarda TAMBIÉN en mis links (en la categoría del tipo, ej. "Películas") - no llames save_link aparte. ' +
    'Si ya estaba, la actualiza con lo nuevo. Llena creator/genre/year/summary con lo que yo dije o lo que sepas con certeza ' +
    'del título; si no estás seguro de un dato, déjalo vacío.',
  parameters: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: [...MEDIA_KINDS], description: 'Qué es: peliculas, series, musica, libros, juegos o podcasts.' },
      title: { type: 'string', description: 'Título (de la película, canción, libro...).' },
      creator: { type: 'string', description: 'Director, artista, autor o estudio.' },
      genre: { type: 'string', description: 'Género (ej. "Ciencia ficción", "Reggaetón", "Terror").' },
      year: { type: 'integer', description: 'Año de estreno/publicación.' },
      summary: { type: 'string', description: 'De qué se trata, en una o dos frases (lo que te dije del link o lo que sepas).' },
      url: { type: 'string', description: 'Link, si vino con uno.' },
      list: { type: 'string', description: 'Nombre de mi lista donde va, si la nombré ("Rock para entrenar"). Si no, va a la principal de ese tipo.' },
      link_category: { type: 'string', description: 'Categoría EXISTENTE para el link, solo si la pedí. Si no, usa la del tipo.' },
      notes: { type: 'string', description: 'Nota mía sobre esto ("me la recomendó Ana").' },
      done: { type: 'boolean', description: 'true si ya la vi/escuché/leí.' },
      rating: { type: 'integer', minimum: 1, maximum: 5, description: 'Calificación 1-5 si la di.' },
      target_user: { type: 'string', description: 'Solo administrador: otra persona con acceso, para guardárselo a ella.' },
    },
    required: ['kind', 'title'],
    additionalProperties: false,
  },

  async execute(args, ctx) {
    const acting = resolveActingUser(ctx, args.target_user ? String(args.target_user) : undefined);
    if ('error' in acting) return acting.error;
    const kind = normalizeListKind(args.kind);
    if (!isMediaKind(kind)) return `El tipo debe ser uno de: ${MEDIA_KINDS.join(', ')}.`;
    const title = String(args.title ?? '').trim();
    if (!title) return 'Me falta el título.';
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
    const int = (v: unknown) => (Number.isInteger(Number(v)) && v !== undefined && v !== null && v !== '' ? Number(v) : undefined);
    const rating = int(args.rating);

    const result = saveMedia(acting.userId, {
      kind,
      title,
      creator: str(args.creator),
      genre: str(args.genre),
      year: int(args.year),
      summary: str(args.summary),
      url: str(args.url),
      list: str(args.list),
      linkCategory: str(args.link_category),
      notes: str(args.notes),
      done: typeof args.done === 'boolean' ? args.done : undefined,
      rating: rating && rating >= 1 && rating <= 5 ? rating : undefined,
    });
    const what = MEDIA_KIND_WORDS[kind].item;
    const linkNote = result.link ? ` El link ${result.link.reused ? 'ya estaba' : 'quedó'} en tus links, categoría "${result.link.categoryName}".` : '';
    return `${LIST_KIND_INFO[kind].emoji} Listo, ${result.created ? 'guardé' : 'actualicé'} la ${what} "${title}" ${internalRef(result.itemId)} en tu lista "${result.listName}".${linkNote}`;
  },
};
