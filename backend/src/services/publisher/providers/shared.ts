import type { SeoText } from '../publisher.types.js';

/** Fetch + JSON with a readable error. `message` pulls the platform's own text out of its error body. */
export async function fetchJson<T>(url: string, init: RequestInit & { timeoutMs?: number } = {}, what: string, message?: (body: Record<string, unknown>) => string | undefined): Promise<T> {
  const { timeoutMs = 30_000, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(url, { ...rest, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    throw new Error(`${what}: no se pudo conectar (${(err as Error).message}).`);
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const problem = message?.(body);
  if (!res.ok || problem) throw new Error(`${what}: ${problem ?? `HTTP ${res.status}`}`);
  return body as T;
}

export const form = (params: Record<string, string | number | boolean | undefined>): URLSearchParams => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) q.set(k, String(v));
  return q;
};

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Text to post: title (when asked), description and hashtags, each in its own paragraph. */
export function caption(text: SeoText, opts: { title?: boolean; max?: number } = {}): string {
  const tags = text.hashtags.map((h) => `#${h}`).join(' ');
  const head = opts.title && text.title && !text.description.startsWith(text.title) ? text.title : '';
  return [head, text.description, tags].filter(Boolean).join('\n\n').slice(0, opts.max ?? 2200);
}
