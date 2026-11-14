import { existsSync } from 'node:fs';
import { fromRoot } from '../../../config/paths.js';
import { renderHtml, type RenderInput } from './studio-templates.js';

/**
 * Photographs a layout with a headless browser (Playwright · Chromium, the same one the
 * advertising module installs - see deploy/ubuntu-10-setup-promo.sh). Runs only inside
 * studio-worker.ts (a child process with low priority), never in the process that holds WhatsApp.
 */
process.env.PLAYWRIGHT_BROWSERS_PATH ||= fromRoot('bin', 'ms-playwright');

export async function canCompose(): Promise<boolean> {
  if (process.env.PROMO_BROWSER) return true;
  try {
    const { chromium } = await import('playwright');
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

export interface Composed {
  data: Buffer;
  mime: 'image/jpeg' | 'image/png';
  ext: 'jpg' | 'png';
}

export const dataUrl = (buf: Buffer, mime: string) => `data:${mime};base64,${buf.toString('base64')}`;

export async function compose(input: RenderInput): Promise<Composed> {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ channel: process.env.PROMO_BROWSER || undefined, args: ['--disable-dev-shm-usage', '--font-render-hinting=none'] });
  try {
    const { width, height } = input.spec;
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.setContent(renderHtml(input), { waitUntil: 'load', timeout: 30_000 });
    await page.waitForFunction('window.designReady === true', undefined, { timeout: 30_000 });
    const png = input.design.kind === 'logo' || input.design.kind === 'profile';
    const data = await page.screenshot(png ? { type: 'png' } : { type: 'jpeg', quality: 93 });
    return png ? { data, mime: 'image/png', ext: 'png' } : { data, mime: 'image/jpeg', ext: 'jpg' };
  } finally {
    await browser.close();
  }
}
