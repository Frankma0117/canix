/**
 * Child process that makes ONE design: `tsx studio-worker.ts <id>`. studio.service.ts starts it with
 * low CPU priority, so the headless browser never slows down the process that answers WhatsApp.
 */
import { buildDesign } from './studio-build.js';
import { studioStore } from './studio.store.js';

const id = Number(process.argv[2]);

buildDesign(id)
  .then(() => process.exit(0))
  .catch((err: Error) => {
    console.error('[STUDIO] Design %d failed:', id, err);
    studioStore.setStatus(id, 'error', `No se pudo terminar: ${err.message}`.slice(0, 300));
    process.exit(1);
  });
