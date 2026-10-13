/**
 * How Canix's messages look on WhatsApp. WhatsApp has its own small markup - *negrilla* with ONE
 * asterisk, _cursiva_, `monoespaciado`, "> " for a quote bar, "- " for bullets - and shows anything
 * else literally. Language models default to Markdown ("**negrilla**", "### Título", tables), which
 * lands as stray asterisks and hashes, so every AI reply goes through toWhatsApp() before sending.
 * It also gives lists the house style: numbered lists get keycap numbers, and list rows that start
 * with a time show it as a chip.
 */

const KEYCAPS = ['0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'];

/** 1 -> 1️⃣, 10 -> 🔟, 12 -> 1️⃣2️⃣ */
export function keycap(n: number): string {
  if (n === 10) return '🔟';
  return String(n)
    .split('')
    .map((d) => KEYCAPS[Number(d)])
    .join('');
}

/** '2026-10-12 17:05:00' or '17:05' -> '5:05 pm' - short, and the same everywhere a time is listed. */
export function shortTime(at: string): string {
  const time = at.includes(' ') ? at.slice(11, 16) : at;
  const [h, m] = time.split(':').map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m ?? 0).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

/**
 * A time as a monospace chip: `5:05 pm`. No padding inside the backticks - WhatsApp only renders
 * the chip when the text hugs them, so a leading space (tried, to line a column up) leaves the
 * backticks showing.
 */
export function timeChip(at: string): string {
  return `\`${shortTime(at)}\``;
}

/** "▰▰▰▱▱▱▱▱▱▱" - a ten-step progress bar. */
export function progressBar(done: number, total: number): string {
  const filled = total > 0 ? Math.round((Math.min(done, total) / total) * 10) : 0;
  return '▰'.repeat(filled) + '▱'.repeat(10 - filled);
}

/** The grey quote block under a message that says how to answer or what to do next (one line each). */
export function footnote(...lines: string[]): string {
  return lines.map((l) => `> ${l}`).join('\n');
}

/** "Reacciona a este mensaje" with what each reaction means underneath - the same everywhere. */
export function reactionFooter(yes = 'Sí', no = 'No'): string {
  return footnote('Reacciona a este mensaje', `👍 ${yes}  ·  👎 ${no}`);
}

// "- 12:00 Ducha", "- 5:30 pm: Cardio", "• 17:00 — Cena", "- `5:00 pm` Cena" at the start of a list row.
const TIME_ROW_RE = /^[ \t]*(?:[-•][ \t]+)?`?[ \t]*(\d{1,2}):(\d{2})[ \t]*(a\.?[ \t]?m\.?|p\.?[ \t]?m\.?)?`?[ \t]*[-–—:·]?[ \t]+(\S.*)$/i;

function timeRow(line: string): string | null {
  const m = TIME_ROW_RE.exec(line);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  const meridiem = m[3]?.toLowerCase().replace(/[^apm]/g, '');
  if (meridiem) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (meridiem.startsWith('p') ? 12 : 0);
  }
  return `${timeChip(`${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`)} ${m[4]}`;
}

/**
 * Makes one line's asterisks render: WhatsApp only turns *x* into bold when the markers hug the
 * text and sit on a word boundary, and shows every other asterisk as a literal "*".
 */
function fixBold(line: string): string {
  // Markers are paired in order (1st with 2nd, 3rd with 4th...) and each pair is tidied on its own.
  // (An earlier version used patterns over the whole line, and on "*negro* y *blanco*" took the
  // closing marker of one bold and the opening of the next as a badly spaced pair.)
  const parts = line.replace(/\*{2,}/g, '*').split('*');
  // An unpaired marker can't be bold - it would show as a stray asterisk: its text is kept, plain.
  if (parts.length % 2 === 0) {
    const last = parts.pop()!;
    parts.push(parts.pop()! + last);
  }
  let out = parts[0];
  for (let i = 1; i < parts.length; i += 2) {
    const inner = parts[i].trim();
    const after = parts[i + 1] ?? '';
    if (inner) {
      // markers glued to letters/digits on the outside don't render: give them room
      if (/[\p{L}\p{N}]$/u.test(out)) out += ' ';
      out += `*${inner}*`;
      if (/^[\p{L}\p{N}]/u.test(after)) out += ' ';
    }
    out += after;
  }
  return out;
}

/** Model-written Markdown -> WhatsApp markup in the house style. Text that's already right is left alone. */
export function toWhatsApp(text: string): string {
  const cleaned = text
    // fenced code blocks: keep the content, drop the fences
    .replace(/```[a-z]*\n?([\s\S]*?)```/gi, '$1')
    // __negrilla__ -> *negrilla*
    .replace(/__([^_\n]+?)__/g, '*$1*')
    // "# Título" (any level) -> *Título*
    .replace(/^[ \t]*#{1,6}[ \t]+(.+?)[ \t]*#*$/gm, (_m, title: string) => `*${title.replace(/\*/g, '').trim()}*`)
    // "* item" / "• item" bullets -> "- item" (what WhatsApp renders as a list)
    // - but "* Título *" on its own line is a badly spaced bold, not a bullet
    .replace(/^([ \t]*)\*[ \t]+(?![^*\n]*\*[ \t]*$)/gm, '$1- ')
    .replace(/^([ \t]*)[•·▪▸►][ \t]+/gm, '$1- ')
    // [texto](url) -> texto: url
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1: $2')
    // horizontal rules and table separators
    .replace(/^[ \t]*([-*_]){3,}[ \t]*$/gm, '')
    .replace(/^[ \t]*\|?[ \t]*:?-{2,}:?[ \t]*(\|[ \t]*:?-{2,}:?[ \t]*)+\|?[ \t]*$/gm, '');

  const lines = cleaned.split('\n').map((raw) => {
    // The quick-answer footer and quotes are ours / already styled.
    if (/^[ \t]*>/.test(raw)) return raw.trimEnd();
    let line = fixBold(raw).trimEnd();
    // "1. item" / "2) item" -> "1️⃣ item"
    line = line.replace(/^[ \t]*(\d{1,2})[.)][ \t]+(?=\S)/, (_m, n: string) => `${keycap(Number(n))} `);
    return timeRow(line) ?? line;
  });

  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
