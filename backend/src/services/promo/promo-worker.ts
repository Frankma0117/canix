/**
 * Child process that builds ONE piece of advertising material: `tsx promo-worker.ts <id>`.
 * promo.service.ts starts it with low CPU priority, so recording a video (a headless browser and
 * ffmpeg working for minutes) never slows down the process that answers WhatsApp.
 */
import { promoModel } from '../../models/promo.model.js';
import { build } from './promo-build.js';

const id = Number(process.argv[2]);

build(id)
  .then(() => process.exit(0))
  .catch((err: Error) => {
    console.error('[PROMO] Item %d failed:', id, err);
    promoModel.setStatus(id, 'error', `No se pudo terminar: ${err.message}`.slice(0, 300));
    process.exit(1);
  });
