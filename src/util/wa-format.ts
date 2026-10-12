/**
 * How Canix's messages look on WhatsApp. WhatsApp has its own small markup - *negrilla* with ONE
 * asterisk, _cursiva_, `monoespaciado`, "> " for a quote bar, "- " for bullets - and shows anything
 * else literally. Language models default to Markdown ("**negrilla**", "### Título", tables), which
 * lands as stray asterisks and hashes, so every AI reply goes through toWhatsApp() before sending.
 */

/** Model-written Markdown -> WhatsApp markup. Leaves text that's already WhatsApp-style untouched. */
export function toWhatsApp(text: string): string {
  return (
    text
      // fenced code blocks: keep the content, drop the fences
      .replace(/```[a-z]*\n?([\s\S]*?)```/gi, '$1')
      // **negrilla** / __negrilla__ -> *negrilla*
      .replace(/\*\*([^*\n]+?)\*\*/g, '*$1*')
      .replace(/__([^_\n]+?)__/g, '*$1*')
      // "# Título" (any level) -> *Título*
      .replace(/^[ \t]*#{1,6}[ \t]+(.+?)[ \t]*#*$/gm, (_m, title: string) => `*${title.replace(/\*/g, '').trim()}*`)
      // "* item" / "• item" bullets -> "- item" (what WhatsApp renders as a list)
      .replace(/^([ \t]*)[*•·][ \t]+/gm, '$1- ')
      // [texto](url) -> texto: url
      .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1: $2')
      // horizontal rules and table separators
      .replace(/^[ \t]*([-*_]){3,}[ \t]*$/gm, '')
      .replace(/^[ \t]*\|?[ \t]*:?-{2,}:?[ \t]*(\|[ \t]*:?-{2,}:?[ \t]*)+\|?[ \t]*$/gm, '')
      // a bold marker left hugging spaces doesn't render: "* texto *" -> "*texto*"
      .replace(/\*[ \t]+([^*\n]+?)[ \t]+\*/g, '*$1*')
      .replace(/[ \t]+$/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

/** '2026-10-12 17:05:00' or '17:05' -> '5:05 pm' - short, and the same everywhere a time is listed. */
export function shortTime(at: string): string {
  const time = at.includes(' ') ? at.slice(11, 16) : at;
  const [h, m] = time.split(':').map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m ?? 0).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

/** A time as a fixed-width monospace chip, so a column of them lines up: ` 5:05 pm`. */
export function timeChip(at: string): string {
  return `\`${shortTime(at).padStart(8, ' ')}\``;
}

/** "▰▰▰▱▱▱▱▱▱▱" - a ten-step progress bar. */
export function progressBar(done: number, total: number): string {
  const filled = total > 0 ? Math.round((Math.min(done, total) / total) * 10) : 0;
  return '▰'.repeat(filled) + '▱'.repeat(10 - filled);
}

/** The small grey line under a message that says how to answer or what to do next. */
export function footnote(text: string): string {
  return `> ${text}`;
}
