/**
 * End-to-end check of the generation flow with the simulated providers and a temporary database:
 * generate an image and a video → SEO → schedule → publish (simulated network) → see them published.
 * Run: DB_PATH=data/test-generation.db PUBLISHER_FAL_KEY= FAL_KEY= npx tsx scripts/publisher-generation-test.ts
 */
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { fromRoot } from '../src/config/paths.js';

process.env.DB_PATH = 'data/test-generation.db';
process.env.FAL_KEY = '';
process.env.PUBLISHER_FAL_KEY = '';
for (const f of ['', '-wal', '-shm']) rmSync(fromRoot(`data/test-generation.db${f}`), { force: true });

const { initSchema } = await import('../src/database/migrate.js');
initSchema();
const { db } = await import('../src/database/connection.js');

const gen = await import('../src/services/publisher/generation/generation.service.js');
const media = await import('../src/services/publisher/publisher-media.js');
const pub = await import('../src/services/publisher/publisher.service.js');
const { publisherStore } = await import('../src/services/publisher/publisher.store.js');

const waitReady = async (id: number) => {
  for (let i = 0; i < 100; i++) {
    const a = gen.getAsset(id)!;
    if (a.status !== 'working') return a;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('timeout');
};

const status = gen.generationStatus();
assert.equal(status.image.find((p) => p.active)?.key, 'mock', 'without keys the simulated provider is used');
assert.equal(status.video.find((p) => p.active)?.key, 'mock');

const img = gen.generateImage(null, { prompt: 'una taza de café sobre una mesa de madera', aspect: 'square' });
const vid = gen.generateVideo(null, { prompt: 'amanecer en la ciudad', aspect: 'portrait', seconds: 3 });
const imgDone = await waitReady(img.id);
const vidDone = await waitReady(vid.id);
assert.equal(imgDone.status, 'ready', imgDone.detail);
assert.equal(vidDone.status, 'ready', vidDone.detail);
assert.ok(imgDone.file_ref && vidDone.file_ref && vidDone.poster_ref);
assert.equal(imgDone.cost_cents, 0);
console.log('✓ imagen y video generados con el proveedor simulado');

assert.throws(() => gen.generateImage(null, { prompt: 'x' }), /qué quieres ver/);
gen.setCostCapCents(0);
console.log('✓ validaciones y tope de gasto');

const assets = media.approvedAssets();
assert.ok(assets.some((a) => a.id === `g${img.id}`) && assets.some((a) => a.id === `g${vid.id}`), 'generated assets appear as material');

pub.saveBrand({ name: 'Prueba', tone: 'cercano', language: 'es', audience: 'todos', cta: 'Escríbenos', hashtags: ['prueba'], keywords: ['café'] });
await pub.connect('instagram', 'mock', 'cuenta_prueba');
await pub.connect('tiktok', 'mock', 'cuenta_prueba');

for (const [asset, platforms] of [[img.id, ['instagram']], [vid.id, ['instagram', 'tiktok']]] as const) {
  const post = media.postFromAsset(null, `g${asset}`, {});
  pub.updatePost(post.id, { platforms: [...platforms] });
  const { post: withSeo } = await pub.suggestSeo(post.id, null);
  assert.ok(Object.keys(withSeo.seo).length >= platforms.length, 'SEO per platform');
  pub.schedule(post.id, null);
  await pub.runDue(media.mediaAccess);
  const final = pub.load(post.id);
  assert.equal(final.status, 'published', `post ${post.id}: ${final.status}`);
  assert.ok(publisherStore.listTargets(post.id).every((t) => t.status === 'published'));
}
console.log('✓ SEO → programar → publicar (imagen en Instagram, video en Instagram y TikTok)');

await gen.deleteAsset(img.id).then(
  () => assert.fail('no debe borrar una pieza que está en la cola'),
  (e: Error) => assert.match(e.message, /cola de publicaciones/),
);
console.log('✓ no se borra material en uso');
console.log(JSON.stringify(gen.usageSummary()));
db.close();
for (const f of ['', '-wal', '-shm']) rmSync(fromRoot(`data/test-generation.db${f}`), { force: true });
rmSync(fromRoot('data/promo/gen-' + img.id), { recursive: true, force: true });
rmSync(fromRoot('data/promo/gen-' + vid.id), { recursive: true, force: true });
process.exit(0);
