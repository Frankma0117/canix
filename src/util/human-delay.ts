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
