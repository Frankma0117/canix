/**
 * What a list is a list OF. Music, movies, series, books and games are kept as their own kinds (not
 * just a name) so they can be found together, shown with their own look, and handed over as clean
 * text to paste somewhere else. A list whose name doesn't say is 'general'; nothing is ever lost
 * by a kind - it only labels the list.
 */
export const LIST_KINDS = ['musica', 'peliculas', 'series', 'libros', 'juegos', 'compras', 'general'] as const;
export type ListKind = (typeof LIST_KINDS)[number];

export const LIST_KIND_INFO: Record<ListKind, { label: string; emoji: string }> = {
  musica: { label: 'Música', emoji: '🎵' },
  peliculas: { label: 'Películas', emoji: '🎬' },
  series: { label: 'Series', emoji: '📺' },
  libros: { label: 'Libros', emoji: '📚' },
  juegos: { label: 'Juegos', emoji: '🎮' },
  compras: { label: 'Compras', emoji: '🛒' },
  general: { label: 'Otras listas', emoji: '📋' },
};

const plain = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

// Checked in this order: "series" before "libros" so "novelas de TV" isn't a book list, etc.
const KIND_WORDS: [ListKind, RegExp][] = [
  ['juegos', /\b(juego|juegos|videojuego|videojuegos|games?|gaming|nintendo|switch|playstation|ps[45]|xbox|steam|zelda|mario|pokemon)\b/],
  ['musica', /\b(musica|cancion|canciones|playlist|playlists|album|albumes|disco|discos|artista|artistas|banda|bandas|temas para escuchar)\b/],
  ['series', /\b(serie|series|anime|animes|dorama|doramas|temporada|temporadas|telenovela|telenovelas|shows?)\b/],
  ['peliculas', /\b(pelicula|peliculas|peli|pelis|cine|film|films|filmes|documental|documentales)\b/],
  ['libros', /\b(libro|libros|lectura|lecturas|leer|novela|novelas|comic|comics|manga|mangas|audiolibro|audiolibros)\b/],
  ['compras', /\b(compra|compras|mercado|supermercado|super|tienda|despensa|viveres)\b/],
];

/** The kind a list's name points at - 'general' when it doesn't say. */
export function inferListKind(name: string): ListKind {
  const text = plain(name);
  return KIND_WORDS.find(([, re]) => re.test(text))?.[0] ?? 'general';
}

/** A kind as someone would say or send it ("Películas", "peli", "games", "musica") -> its value. */
export function normalizeListKind(raw: unknown): ListKind | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const text = plain(raw.trim());
  if ((LIST_KINDS as readonly string[]).includes(text)) return text as ListKind;
  if (/^(otra|otras|otro|otros|ninguna|ninguno|normal|general)/.test(text)) return 'general';
  return KIND_WORDS.find(([, re]) => re.test(text))?.[0] ?? null;
}

export function listKindOf(list: { kind?: string | null; name: string }): ListKind {
  return normalizeListKind(list.kind) ?? inferListKind(list.name);
}

/**
 * A list as clean text to paste anywhere (notes app, a chat, a document): its title and one item
 * per line - no checkboxes, numbers or formatting marks. What's already marked goes in its own
 * block at the end.
 */
export function listAsText(list: { name: string; kind?: string | null }, items: { title: string; checked: number | boolean }[]): string {
  const { emoji } = LIST_KIND_INFO[listKindOf(list)];
  const pending = items.filter((i) => !i.checked).map((i) => `- ${i.title}`);
  const done = items.filter((i) => i.checked).map((i) => `- ${i.title}`);
  const lines = [`${emoji} ${list.name}`];
  if (pending.length) lines.push('', ...(done.length ? ['Pendientes:'] : []), ...pending);
  if (done.length) lines.push('', 'Ya marcados:', ...done);
  if (!items.length) lines.push('', '(vacía)');
  return lines.join('\n');
}
