const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** 'H:mm'/'HH:mm' list -> sorted unique 'HH:mm'; invalid entries are dropped. */
export function normalizeTimes(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[,\s]+/) : [];
  const out = list
    .map((t) => String(t).trim())
    .map((t) => TIME_RE.exec(t))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => `${m[1].padStart(2, '0')}:${m[2]}`);
  return [...new Set(out)].sort();
}
