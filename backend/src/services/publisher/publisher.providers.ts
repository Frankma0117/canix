import { randomBytes } from 'node:crypto';
import { metaProvider } from './providers/meta.provider.js';
import { tiktokProvider } from './providers/tiktok.provider.js';
import { youtubeProvider } from './providers/youtube.provider.js';
import { PLATFORM_NAMES, type Platform, type PublisherProvider } from './publisher.types.js';

/**
 * Simulated provider: connects and «publishes» without touching any network, so the whole flow
 * (queue, retries, SEO, panel) can be used and tested at no cost. Set MOCK_PUBLISH_FAIL=1 to make
 * every publication fail (to try the retries).
 */
const mock: PublisherProvider = {
  key: 'mock',
  label: 'Simulado (pruebas)',
  available: true,
  configured: () => true,
  async connect(platform, { accountName }) {
    return {
      accountName: accountName || `Cuenta de prueba de ${PLATFORM_NAMES[platform]}`,
      accessToken: `mock-${randomBytes(12).toString('hex')}`,
      refreshToken: `mock-refresh-${randomBytes(8).toString('hex')}`,
      expiresAt: new Date(Date.now() + 60 * 24 * 3600_000).toISOString(),
    };
  },
  async publish(platform) {
    if (process.env.MOCK_PUBLISH_FAIL === '1') throw new Error('Fallo simulado de la plataforma.');
    const id = randomBytes(6).toString('hex');
    return { externalId: `mock-${platform}-${id}`, externalUrl: `https://example.invalid/${platform}/${id}` };
  },
};


const PROVIDERS: PublisherProvider[] = [mock, youtubeProvider, metaProvider, tiktokProvider];

/** Which real provider serves each platform when it exists (phases 3-5 fill this in). */
const REAL_FOR: Record<Platform, string> = { youtube: 'google', instagram: 'meta', facebook: 'meta', tiktok: 'tiktok' };

export const listProviders = () => PROVIDERS;
export const getProvider = (key: string): PublisherProvider | undefined => PROVIDERS.find((p) => p.key === key);

/** Providers a platform can be connected through. */
export function providersFor(platform: Platform): PublisherProvider[] {
  return PROVIDERS.filter((p) => p.key === 'mock' || p.key === REAL_FOR[platform]);
}
