/**
 * The http(s) URL in `raw`, normalized - or null for anything else. Links come from chat and from
 * the portal and are later rendered as clickable anchors, so only web URLs are ever stored
 * (no javascript:, data:, file: ...).
 */
export function normalizeHttpUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (!/^https?:\/\//i.test(text) || text.length > 2000) return null;
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}
