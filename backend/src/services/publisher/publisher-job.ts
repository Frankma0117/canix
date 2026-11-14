import { resolveMedia } from './publisher-media.js';
import { runDue } from './publisher.service.js';

/** Every minute: sends whatever is due (see publisher.service.ts runDue). Started once from index.ts. */
export function startPublisherJob(): void {
  const tick = () => runDue(resolveMedia).catch((err) => console.error('[PUBLISHER] Job error:', (err as Error).message));
  setTimeout(() => void tick(), 15_000).unref(); // pick up what came due while the server was off
  setInterval(() => void tick(), 60_000).unref();
}
