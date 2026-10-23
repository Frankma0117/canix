import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { db } from './connection.js';
import { createCoreTables, createCoreIndexes } from './schema/core.schema.js';
import { upgradeCoreSchema } from './migrations/core-upgrades.js';
import { initAccessSchema } from './schema/access.schema.js';
import { initSchedulingSchema } from './schema/scheduling.schema.js';
import { initGrowthSchema } from './schema/growth.schema.js';
import { initPromoSchema } from './schema/promo.schema.js';

/**
 * Creates every table that doesn't exist yet and upgrades older databases in place. Idempotent:
 * runs on every boot (see index.ts) and standalone with `npm run db:migrate`.
 *
 * Order matters: core tables -> upgrades of older core tables -> core indexes (some need upgraded
 * columns) -> the access-control, scheduling, growth and promo modules, which reference `users`.
 */
export function initSchema(): void {
  createCoreTables(db);
  upgradeCoreSchema(db);
  createCoreIndexes(db);
  initAccessSchema(db);
  initSchedulingSchema(db);
  initGrowthSchema(db);
  initPromoSchema(db);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  initSchema();
  console.log('[DB] Schema ready.');
}
