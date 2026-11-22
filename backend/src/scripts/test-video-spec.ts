// Minimal check of the video spec validation: `npx tsx src/scripts/test-video-spec.ts` (no DB needed).
import assert from 'node:assert/strict';
import { canixTemplate, parseSpec } from '../services/video-studio/spec.js';

const clone = () => JSON.parse(JSON.stringify(canixTemplate())) as ReturnType<typeof canixTemplate>;
const rejects = (mutate: (s: ReturnType<typeof canixTemplate>) => void, why: string) => {
  const s = clone();
  mutate(s);
  assert.throws(() => parseSpec(s), undefined, why);
};

assert.equal(parseSpec(canixTemplate()).scenes.length, canixTemplate().scenes.length, 'template is valid');
rejects((s) => (s.scenes[0].image = 'proyectos/canix/../../etc/passwd.png'), 'path traversal');
rejects((s) => (s.scenes[0].image = 'https://x.com/a.png'), 'external url');
rejects((s) => (s.brand.from = 'red'), 'bad color');
rejects((s) => (s.scenes = []), 'no scenes');
rejects((s) => (s.scenes[0].callouts = Array.from({ length: 6 }, () => ({ x: 1, y: 1, text: 'a' }))), 'too many callouts');
rejects((s) => (s.scenes[0].callouts = [{ x: 120, y: 1, text: 'a' }]), 'x out of range');
console.log('video spec: ok');
