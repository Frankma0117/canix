/** Small delay utility used to space out bot actions so they read as human, not scripted. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Rough typing-speed simulation (~45-70 wpm) so replies don't land instantly - an immediate
 * reply to every message is one of the "obviously automated" signals that increases spam/ban
 * risk, on top of just feeling robotic. Capped so long replies don't make the chat feel sluggish.
 */
export function typingDelayMs(replyText: string): number {
  const perChar = 22 + Math.random() * 15;
  return Math.min(Math.round(replyText.length * perChar), 7_000);
}

/** Brief, randomized "just noticed your message" pause before showing the typing indicator. */
export function readingPauseMs(): number {
  return Math.round(300 + Math.random() * 500);
}

/**
 * Fires `onTick` on a timer while `work` is still pending, capped at `maxTicks` - used to send
 * "still working on it" updates for a slow AI turn (multi-iteration tool calls, a flaky provider
 * retry) instead of leaving the user staring at a typing indicator that WhatsApp itself lets
 * expire after a while. Never delays or otherwise touches `work` itself - just observes it.
 */
export async function withWorkingUpdates<T>(
  work: Promise<T>,
  onTick: () => void | Promise<void>,
  opts: { intervalMs: number; maxTicks: number },
): Promise<T> {
  let done = false;
  work.finally(() => {
    done = true;
  });

  void (async () => {
    for (let i = 0; i < opts.maxTicks; i++) {
      await sleep(opts.intervalMs);
      if (done) return;
      await onTick();
    }
  })();

  return work;
}
