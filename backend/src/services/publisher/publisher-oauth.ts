import { randomBytes } from 'node:crypto';
import { env } from '../../config/env.js';
import { AccessError } from '../../models/permissions.model.js';
import { encryptSecret } from './publisher-crypto.js';
import { getProvider, providersFor } from './publisher.providers.js';
import { publisherStore } from './publisher.store.js';
import { isPlatform } from './publisher-seo.js';
import type { Platform } from './publisher.types.js';

/**
 * «Conectar con…»: the administrator is sent to the platform's login page, which returns to
 * /api/publisher-oauth/callback with a code. The `state` (random, one use, 10 minutes) ties the
 * return to the administrator who started it - without it nobody can attach an account.
 */
const TTL = 10 * 60_000;
const pending = new Map<string, { platform: Platform; provider: string; at: number }>();

export const redirectUri = () => `${(env.panelUrl || 'http://localhost:' + env.port).replace(/\/$/, '')}/api/publisher-oauth/callback`;

export function beginOAuth(platformKey: string, providerKey: string): string {
  if (!isPlatform(platformKey)) throw new AccessError('Esa red no existe.');
  const provider = getProvider(providerKey);
  if (!provider || !providersFor(platformKey).some((p) => p.key === provider.key)) throw new AccessError('Ese proveedor no sirve para esta red.');
  if (!provider.available || !provider.oauth || !provider.authUrl) throw new AccessError('Esa conexión no usa inicio de sesión.');
  if (!provider.configured()) throw new AccessError(`Faltan las claves de la app en el .env del servidor: ${provider.envVars?.join(', ')}.`);
  const now = Date.now();
  for (const [k, v] of pending) if (now - v.at > TTL) pending.delete(k);
  const state = randomBytes(24).toString('hex');
  pending.set(state, { platform: platformKey, provider: provider.key, at: now });
  return provider.authUrl(platformKey, redirectUri(), state);
}

/** Returns the platform that got connected. Throws a readable error otherwise. */
export async function finishOAuth(state: string, code: string): Promise<Platform> {
  const entry = pending.get(state);
  pending.delete(state);
  if (!entry || Date.now() - entry.at > TTL) throw new AccessError('El enlace de conexión venció. Vuelve a intentarlo desde el panel.');
  const provider = getProvider(entry.provider);
  if (!provider?.exchange) throw new AccessError('Proveedor no válido.');
  const res = await provider.exchange(entry.platform, code, redirectUri());
  publisherStore.saveConnection({
    platform: entry.platform,
    provider: provider.key,
    accountName: res.accountName,
    accessEnc: encryptSecret(res.accessToken),
    refreshEnc: res.refreshToken ? encryptSecret(res.refreshToken) : (publisherStore.getConnection(entry.platform)?.refresh_token_enc ?? null),
    expiresAt: res.expiresAt ?? null,
  });
  return entry.platform;
}
