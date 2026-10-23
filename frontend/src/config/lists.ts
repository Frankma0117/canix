import type { Checklist, ListKind } from '../types/index.ts';

export type Item = Checklist['items'][number];

/** The kinds a list can be, in the order they're shown. Music, movies, series, books and games are
 *  their own kinds so they can be found together and copied out as clean text. */
export const KINDS: { id: ListKind; label: string; emoji: string }[] = [
  { id: 'musica', label: 'Música', emoji: '🎵' },
  { id: 'peliculas', label: 'Películas', emoji: '🎬' },
  { id: 'series', label: 'Series', emoji: '📺' },
  { id: 'libros', label: 'Libros', emoji: '📚' },
  { id: 'juegos', label: 'Juegos', emoji: '🎮' },
  { id: 'podcasts', label: 'Podcasts', emoji: '🎙️' },
  { id: 'compras', label: 'Compras', emoji: '🛒' },
  { id: 'general', label: 'Otras', emoji: '📋' },
];

export const kindInfo = (kind: ListKind) => KINDS.find((k) => k.id === kind) ?? KINDS[KINDS.length - 1];
