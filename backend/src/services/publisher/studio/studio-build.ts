import { publisherStore } from '../publisher.store.js';
import { deleteStudioFiles, readStudioFile, storeStudioFile } from '../publisher-media.js';
import { artPrompt, currentArtProvider } from './studio-art.js';
import { compose, dataUrl } from './studio-compose.js';
import { writeCopy } from './studio-copy.js';
import { studioStore } from './studio.store.js';
import { LAYOUTS, formatByKey, type Design } from './studio.types.js';

/**
 * Makes ONE design (runs inside studio-worker.ts):
 *   words (text model or template) → art (image model or sample gradient, only when the layout uses it)
 *   → the layout photographed. Texts and art already saved are kept, so a redraw after the
 *   administrator corrected the words spends no AI.
 */
const progress = (id: number, msg: string) => studioStore.setStatus(id, 'working', msg);

export const usesArt = (d: Pick<Design, 'kind' | 'layout'>) => LAYOUTS[d.layout].usesArt && d.kind !== 'profile';

export async function buildDesign(id: number): Promise<void> {
  const design = studioStore.get(id);
  if (!design || !['pending', 'working'].includes(design.status)) return;
  const spec = formatByKey(design.format);
  if (!spec) throw new Error('Ese formato ya no existe.');
  progress(id, 'Empezando…');
  const identity = studioStore.getIdentity();
  const brand = publisherStore.getBrand();

  // 1) words
  let content = design.content;
  if (!content.headline && !content.art_prompt) {
    progress(id, 'Escribiendo los textos…');
    const copy = await writeCopy(design.created_by, { kind: design.kind, layout: design.layout, brand, identity, brief: design.brief, avoid: studioStore.recentHeadlines(design.kind), variant: id % 3 });
    const { title, caption, ...rest } = copy;
    content = rest;
    studioStore.setContent(id, title, caption, content);
  }

  // 2) art
  let artRef = design.art_ref;
  let art: string | null = null;
  if (usesArt(design)) {
    if (artRef) {
      const bytes = await readStudioFile(artRef);
      if (bytes) art = dataUrl(bytes, 'image/jpeg');
    }
    if (!art) {
      const provider = currentArtProvider();
      progress(id, provider.key === 'fal' ? 'Pintando el arte con IA…' : 'Preparando el fondo…');
      const bytes = await provider.paint(artPrompt(identity, brand.name, content.art_prompt, design.kind), spec.art, identity.colors);
      const mime = provider.key === 'mock' ? 'image/png' : 'image/jpeg';
      artRef = await storeStudioFile(id, `art-${Date.now().toString(36)}.${mime === 'image/png' ? 'png' : 'jpg'}`, bytes, mime);
      studioStore.setArt(id, artRef);
      art = dataUrl(bytes, mime);
    }
  }

  // 3) the layout
  progress(id, 'Diseñando…');
  const logoBytes = identity.logoRef && design.kind !== 'logo' ? await readStudioFile(identity.logoRef) : null;
  const fresh = studioStore.get(id)!;
  const out = await compose({ design: fresh, spec, identity, brandName: brand.name, art, logo: logoBytes ? dataUrl(logoBytes, 'image/png') : null });
  const ref = await storeStudioFile(id, `${design.format}-${Date.now().toString(36)}.${out.ext}`, out.data, out.mime);
  studioStore.setResult(id, ref);
}

export { deleteStudioFiles };
