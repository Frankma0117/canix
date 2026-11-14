import { automationTick } from './automation/automation.service.js';
import { mediaAccess } from './publisher-media.js';
import { runDue } from './publisher.service.js';

/** Every minute: plan the automatic content and move it forward, then send whatever is due. Started once from index.ts. */
export function startPublisherJob(): void {
  const tick = async () => {
    await automationTick().catch((err) => console.error('[PUBLISHER] Automation error:', (err as Error).message));
    await runDue(mediaAccess).catch((err) => console.error('[PUBLISHER] Job error:', (err as Error).message));
  };
  setTimeout(() => void tick(), 15_000).unref(); // pick up what came due while the server was off
  setInterval(() => void tick(), 60_000).unref();
}
