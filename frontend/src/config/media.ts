import type { MediaKind } from '../types/index.ts';

/** How each kind of the media library is named and drawn (mirrors backend shared/utils/list-kinds.ts). */
export const MEDIA_KIND_INFO: Record<MediaKind, { label: string; emoji: string; item: string; done: string; pending: string; creatorLabel: string; example: string }> = {
  peliculas: { label: 'Películas', emoji: '🎬', item: 'película', done: 'vista', pending: 'Por ver', creatorLabel: 'Director', example: 'Interstellar' },
  series: { label: 'Series', emoji: '📺', item: 'serie', done: 'vista', pending: 'Por ver', creatorLabel: 'Creador', example: 'Dark' },
  musica: { label: 'Música', emoji: '🎵', item: 'canción o álbum', done: 'escuchada', pending: 'Por escuchar', creatorLabel: 'Artista', example: 'Tití me preguntó' },
  libros: { label: 'Libros', emoji: '📚', item: 'libro', done: 'leído', pending: 'Por leer', creatorLabel: 'Autor', example: 'Cien años de soledad' },
  juegos: { label: 'Juegos', emoji: '🎮', item: 'juego', done: 'jugado', pending: 'Por jugar', creatorLabel: 'Estudio', example: 'Zelda' },
  podcasts: { label: 'Podcasts', emoji: '🎙️', item: 'podcast', done: 'escuchado', pending: 'Por escuchar', creatorLabel: 'Autor', example: 'Radio Ambulante' },
};

export const MEDIA_KINDS = Object.keys(MEDIA_KIND_INFO) as MediaKind[];
