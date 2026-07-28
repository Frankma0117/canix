/**
 * The `libsignal` package (a Baileys dependency implementing the Signal Protocol) calls
 * `console.info`/`console.warn` directly for routine session bookkeeping ("Closing session:",
 * "Session already closed") - this bypasses our own pino logger entirely (it's hardcoded in
 * session_record.js), so it can't be silenced the normal way. It's expected noise from opening
 * fresh encryption sessions with a new contact, not an error - filtered here purely so real
 * logs/errors aren't buried under raw Signal session dumps.
 */
const NOISY_PATTERNS = [/^Closing session:/, /^Session already closed/, /^Opening session:/];

function isNoisy(args: unknown[]): boolean {
  const first = args[0];
  return typeof first === 'string' && NOISY_PATTERNS.some((re) => re.test(first));
}

export function quietLibsignalLogs(): void {
  const originalInfo = console.info.bind(console);
  const originalWarn = console.warn.bind(console);

  console.info = (...args: unknown[]) => {
    if (!isNoisy(args)) originalInfo(...args);
  };
  console.warn = (...args: unknown[]) => {
    if (!isNoisy(args)) originalWarn(...args);
  };
}
