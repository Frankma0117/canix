import { AccessError } from '../../models/permissions.model.js';
import { decryptSecret, encryptSecret } from './publisher-crypto.js';
import { fit, generateSeo, isPlatform, normalizeHashtags } from './publisher-seo.js';
import { getProvider, listProviders, providersFor } from './publisher.providers.js';
import { fromDb, publisherStore, toDb } from './publisher.store.js';
import { PLATFORMS, PLATFORM_MEDIA, PLATFORM_NAMES, type Brand, type Connection, type MediaAccess, type MediaType, type Platform, type Post, type PublisherProvider, type Target } from './publisher.types.js';

/**
 * Content publisher: brand profile, platform connections, the queue of posts and their
 * publication. Business errors are AccessError (the routes turn them into a 400 with the message).
 * The media of a post is a reference the media layer resolves (see publisher-media.ts).
 */

const MAX_ATTEMPTS = 5;
const backoffMinutes = (attempts: number) => Math.min(60, 2 ** attempts); // 2, 4, 8, 16, 32...

// ---------- brand ----------

export const getBrand = () => publisherStore.getBrand();

export function saveBrand(input: Partial<Brand>): Brand {
  const prev = publisherStore.getBrand();
  const brand: Brand = {
    name: (input.name ?? prev.name).trim().slice(0, 60),
    tone: (input.tone ?? prev.tone).trim().slice(0, 300),
    language: (input.language ?? prev.language) === 'en' ? 'en' : 'es',
    audience: (input.audience ?? prev.audience).trim().slice(0, 300),
    cta: (input.cta ?? prev.cta).trim().slice(0, 200),
    hashtags: normalizeHashtags(input.hashtags ?? prev.hashtags, 30),
    keywords: (input.keywords ?? prev.keywords).map((k) => k.trim().slice(0, 40)).filter(Boolean).slice(0, 30),
  };
  publisherStore.saveBrand(brand);
  return brand;
}

// ---------- connections ----------

export function connectionsView() {
  const saved = new Map(publisherStore.listConnections().map((c) => [c.platform, c]));
  return PLATFORMS.map((platform) => {
    const c = saved.get(platform);
    return {
      platform,
      name: PLATFORM_NAMES[platform],
      connected: !!c,
      status: c?.status ?? null,
      accountName: c?.account_name ?? '',
      provider: c?.provider ?? null,
      lastError: c?.last_error ?? '',
      connectedAt: fromDb(c?.connected_at ?? null),
      providers: providersFor(platform).map((p) => ({ key: p.key, label: p.label, available: p.available, oauth: !!p.oauth, loginName: p.loginName ?? '', configured: p.configured(), envVars: p.envVars ?? [] })),
    };
  });
}

export async function connect(platform: string, providerKey: string, accountName: string) {
  if (!isPlatform(platform)) throw new AccessError('Esa red no existe.');
  const provider = getProvider(providerKey);
  if (!provider || !providersFor(platform).some((p) => p.key === provider.key)) throw new AccessError('Ese proveedor no sirve para esta red.');
  if (!provider.available) throw new AccessError(`${provider.label} todavía no está disponible: llega en una fase próxima.`);
  if (provider.oauth) throw new AccessError('Esta red se conecta con el botón «Conectar con…», que abre su inicio de sesión.');
  const res = await provider.connect(platform, { accountName: accountName.trim().slice(0, 80) });
  publisherStore.saveConnection({
    platform,
    provider: provider.key,
    accountName: res.accountName,
    accountId: res.accountId,
    accessEnc: encryptSecret(res.accessToken),
    refreshEnc: res.refreshToken ? encryptSecret(res.refreshToken) : null,
    expiresAt: res.expiresAt ?? null,
  });
  return connectionsView();
}

export function disconnect(platform: string) {
  if (!isPlatform(platform)) throw new AccessError('Esa red no existe.');
  publisherStore.deleteConnection(platform);
  return connectionsView();
}

// ---------- posts ----------

function targetView(t: Target) {
  return {
    platform: t.platform,
    name: PLATFORM_NAMES[t.platform],
    status: t.status,
    url: t.external_url,
    attempts: t.attempts,
    error: t.last_error,
    nextAttemptAt: fromDb(t.next_attempt_at),
    publishedAt: fromDb(t.published_at),
  };
}

export function postView(p: Post, resolveUrl: (ref: string) => string) {
  const targets = publisherStore.listTargets(p.id);
  return {
    id: p.id,
    promoItemId: p.promo_item_id,
    mediaType: p.media_type,
    mediaUrl: resolveUrl(p.media_ref),
    thumbnailUrl: resolveUrl(p.thumbnail_ref),
    title: p.title,
    description: p.description,
    hashtags: p.hashtags,
    keywords: p.keywords,
    seo: p.seo,
    status: p.status,
    scheduledAt: fromDb(p.scheduled_at),
    publishedAt: fromDb(p.published_at),
    platforms: targets.map((t) => t.platform),
    targets: targets.map(targetView),
    createdAt: fromDb(p.created_at),
  };
}

export function load(id: number): Post {
  const post = publisherStore.getPost(id);
  if (!post) throw new AccessError('Esa publicación ya no existe.');
  return post;
}

export interface NewPost {
  promoItemId?: number | null;
  mediaType: MediaType;
  mediaRef: string;
  thumbnailRef?: string;
  title: string;
  description?: string;
  hashtags?: string[];
  keywords?: string[];
}

export function createPost(userId: number | null, input: NewPost): Post {
  const title = input.title.trim().slice(0, 120);
  if (!title) throw new AccessError('Ponle un título a la publicación.');
  const id = publisherStore.createPost({
    promoItemId: input.promoItemId ?? null,
    mediaType: input.mediaType,
    mediaRef: input.mediaRef,
    thumbnailRef: input.thumbnailRef ?? '',
    title,
    description: (input.description ?? '').trim().slice(0, 2000),
    hashtags: normalizeHashtags(input.hashtags ?? [], 30),
    keywords: (input.keywords ?? []).map((k) => k.trim().slice(0, 40)).filter(Boolean).slice(0, 20),
    createdBy: userId,
  });
  return load(id);
}

const cleanPlatforms = (list: unknown): Platform[] => (Array.isArray(list) ? [...new Set(list.map(String))].filter(isPlatform) : []);

export interface PostChanges {
  title?: string;
  description?: string;
  hashtags?: string[];
  keywords?: string[];
  seo?: Record<string, { title?: string; description?: string; hashtags?: string[] }>;
  platforms?: string[];
}

export function updatePost(id: number, c: PostChanges): Post {
  const post = load(id);
  if (['publishing', 'published'].includes(post.status)) throw new AccessError('Esta publicación ya salió o se está enviando.');
  const seo = { ...post.seo };
  for (const [platform, text] of Object.entries(c.seo ?? {})) if (isPlatform(platform)) seo[platform] = fit(platform, { ...seo[platform], ...text });
  publisherStore.updatePost(id, {
    title: (c.title ?? post.title).trim().slice(0, 120) || post.title,
    description: (c.description ?? post.description).trim().slice(0, 2000),
    hashtags: normalizeHashtags(c.hashtags ?? post.hashtags, 30),
    keywords: (c.keywords ?? post.keywords).map((k) => k.trim().slice(0, 40)).filter(Boolean).slice(0, 20),
    seo,
  });
  if (c.platforms) publisherStore.setTargets(id, cleanPlatforms(c.platforms));
  return load(id);
}

export async function suggestSeo(id: number, userId: number | null, platforms?: string[]): Promise<{ post: Post; usedAi: boolean }> {
  const post = load(id);
  const wanted = platforms ? cleanPlatforms(platforms) : publisherStore.listTargets(id).map((t) => t.platform);
  if (!wanted.length) throw new AccessError('Elige primero en qué redes se va a publicar.');
  const { seo, usedAi } = await generateSeo(
    publisherStore.getBrand(),
    { title: post.title, description: post.description, hashtags: post.hashtags, keywords: post.keywords, mediaType: post.media_type },
    wanted,
    userId,
  );
  publisherStore.updatePost(id, { title: post.title, description: post.description, hashtags: post.hashtags, keywords: post.keywords, seo: { ...post.seo, ...seo } });
  return { post: load(id), usedAi };
}

/** The texts a platform will receive: its own SEO version, or the post's general one. */
function textFor(post: Post, platform: Platform) {
  return post.seo[platform] ?? fit(platform, { title: post.title, description: post.description, hashtags: post.hashtags });
}

/** At is null = now. Needs at least one platform that is connected. */
export function schedule(id: number, at: string | null): Post {
  const post = load(id);
  if (['publishing', 'published'].includes(post.status)) throw new AccessError('Esta publicación ya salió o se está enviando.');
  const targets = publisherStore.listTargets(id).filter((t) => t.status !== 'published');
  if (!targets.length) throw new AccessError('Elige en qué redes se va a publicar.');
  const disconnected = targets.filter((t) => !publisherStore.getConnection(t.platform)).map((t) => PLATFORM_NAMES[t.platform]);
  if (disconnected.length) throw new AccessError(`Conecta primero ${disconnected.join(', ')}.`);
  const unsupported = targets.filter((t) => !PLATFORM_MEDIA[t.platform].includes(post.media_type)).map((t) => PLATFORM_NAMES[t.platform]);
  if (unsupported.length) throw new AccessError(`${unsupported.join(', ')} no admite ${post.media_type === 'video' ? 'videos' : 'imágenes'}. Quita esa red de la publicación.`);
  let when = new Date();
  if (at) {
    when = new Date(at);
    if (Number.isNaN(when.getTime())) throw new AccessError('Esa fecha no es válida.');
    if (when.getTime() < Date.now() - 60_000) throw new AccessError('Esa fecha ya pasó.');
  }
  publisherStore.resetFailedTargets(id);
  publisherStore.setPostStatus(id, 'scheduled', toDb(when));
  return load(id);
}

/** Back to draft (only while it hasn't gone out). */
export function unschedule(id: number): Post {
  const post = load(id);
  if (post.status !== 'scheduled') throw new AccessError('Solo se pueden cancelar las programadas.');
  publisherStore.setPostStatus(id, 'draft', null);
  return load(id);
}

export function retry(id: number): Post {
  const post = load(id);
  if (!['failed', 'partial'].includes(post.status)) throw new AccessError('No hay nada que reintentar.');
  publisherStore.resetFailedTargets(id);
  publisherStore.setPostStatus(id, 'scheduled', toDb(new Date()));
  return load(id);
}

export function removePost(id: number): void {
  const post = load(id);
  if (post.status === 'publishing') throw new AccessError('Se está enviando: espera a que termine.');
  publisherStore.deletePost(post.id);
}

// ---------- publication ----------

/** Sends every pending target of one post, then settles the post's status. */
export async function publishPost(id: number, media: MediaAccess): Promise<void> {
  const post = publisherStore.getPost(id);
  if (!post || !['scheduled', 'publishing'].includes(post.status)) return;
  publisherStore.setPostStatus(id, 'publishing');
  const now = toDb(new Date());
  for (const target of publisherStore.listTargets(id)) {
    if (target.status !== 'pending' || (target.next_attempt_at && target.next_attempt_at > now)) continue;
    const conn = publisherStore.getConnection(target.platform);
    try {
      if (!conn?.access_token_enc) throw new Error(`${PLATFORM_NAMES[target.platform]} no está conectada.`);
      const provider = getProvider(conn.provider);
      if (!provider?.available) throw new Error('El proveedor de esta red no está disponible.');
      const accessToken = await freshToken(conn, provider);
      const res = await provider.publish(target.platform, {
        mediaType: post.media_type,
        mediaUrl: media.url(post.media_ref),
        thumbnailUrl: media.url(post.thumbnail_ref),
        readMedia: async () => {
          const bytes = await media.read(post.media_ref);
          if (!bytes) throw new Error('No se encontró el archivo del video.');
          return bytes;
        },
        text: textFor(post, target.platform),
        accessToken,
        accountName: conn.account_name,
        accountId: conn.account_id,
      });
      publisherStore.targetSucceeded(target.id, res.externalId, res.externalUrl);
    } catch (err) {
      const message = (err as Error).message || 'Error desconocido';
      const final = target.attempts + 1 >= MAX_ATTEMPTS || !conn;
      publisherStore.targetFailed(target.id, message, final, toDb(new Date(Date.now() + backoffMinutes(target.attempts + 1) * 60_000)));
      if (conn) publisherStore.markConnectionError(target.platform, message);
      console.log('[PUBLISHER] %s #%d failed (attempt %d): %s', target.platform, id, target.attempts + 1, message);
    }
  }
  settle(id);
}

/** The access token, renewed with the refresh token when it's about to expire. */
async function freshToken(conn: Connection, provider: PublisherProvider): Promise<string> {
  const access = decryptSecret(conn.access_token_enc!);
  const expiring = conn.expires_at && new Date(conn.expires_at).getTime() < Date.now() + 120_000;
  if (!expiring || !provider.refresh || !conn.refresh_token_enc) return access;
  const fresh = await provider.refresh(conn.platform, decryptSecret(conn.refresh_token_enc));
  publisherStore.updateTokens(conn.platform, encryptSecret(fresh.accessToken), fresh.expiresAt);
  return fresh.accessToken;
}

/** published = all sent · partial = some sent, some failed for good · failed = none sent · otherwise it waits for retries. */
function settle(id: number): void {
  const targets = publisherStore.listTargets(id);
  if (targets.some((t) => t.status === 'pending')) return void publisherStore.setPostStatus(id, 'scheduled');
  const sent = targets.filter((t) => t.status === 'published').length;
  if (sent === targets.length) publisherStore.markPostPublished(id, 'published');
  else if (sent > 0) publisherStore.markPostPublished(id, 'partial');
  else publisherStore.setPostStatus(id, 'failed');
}

let running = false;

/** Called every minute by the job (and right after «Publicar ahora»). */
export async function runDue(media: MediaAccess): Promise<number> {
  if (running) return 0;
  running = true;
  try {
    const ids = publisherStore.duePostIds(toDb(new Date()));
    for (const id of ids) await publishPost(id, media);
    return ids.length;
  } finally {
    running = false;
  }
}

export const providersView = () => listProviders().map((p) => ({ key: p.key, label: p.label, available: p.available, oauth: !!p.oauth, configured: p.configured() }));
