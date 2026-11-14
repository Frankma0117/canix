import type { ConnectResult, Platform, PublisherProvider, PublishRequest, PublishResult } from '../publisher.types.js';
import { caption, fetchJson, form, sleep } from './shared.js';

/**
 * Instagram + Facebook through one Meta login (Graph API). One «Conectar con Meta» connects the
 * Facebook page AND the Instagram professional account linked to it.
 * .env: META_APP_ID, META_APP_SECRET (app type «Empresa», product «Facebook Login for Business»), optional
 * META_PAGE_ID (which page, when the account manages several) and META_GRAPH_VERSION (default v21.0).
 * The page token that comes from a long-lived user token doesn't expire, so there is nothing to refresh.
 * Meta downloads the media itself: it must be reachable at a public URL (PANEL_URL).
 */
const SCOPES = ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'instagram_basic', 'instagram_content_publish', 'business_management'];
const appId = () => process.env.META_APP_ID?.trim() ?? '';
const appSecret = () => process.env.META_APP_SECRET?.trim() ?? '';
const version = () => process.env.META_GRAPH_VERSION?.trim() || 'v21.0';
const graph = (path: string) => `https://graph.facebook.com/${version()}${path}`;

const metaError = (b: Record<string, unknown>): string | undefined => {
  const e = b.error as { message?: string; code?: number; error_user_msg?: string } | undefined;
  return e ? `${e.error_user_msg ?? e.message ?? 'error'}${e.code ? ` (código ${e.code})` : ''}` : undefined;
};

const get = <T>(path: string, params: Record<string, string>) => fetchJson<T>(`${graph(path)}?${form(params)}`, {}, 'Meta', metaError);
const post = <T>(path: string, params: Record<string, string | undefined>, timeoutMs = 120_000) =>
  fetchJson<T>(graph(path), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form(params), timeoutMs }, 'Meta', metaError);

interface Page {
  id: string;
  name: string;
  access_token: string;
  instagram_business_account?: { id: string; username?: string };
}

export const metaProvider: PublisherProvider = {
  key: 'meta',
  label: 'Instagram y Facebook (Meta)',
  loginName: 'Meta',
  available: true,
  oauth: true,
  envVars: ['META_APP_ID', 'META_APP_SECRET'],
  configured: () => !!(appId() && appSecret()),

  async connect() {
    throw new Error('Instagram y Facebook se conectan con el botón «Conectar con Meta».');
  },

  authUrl(_platform, redirectUri, state) {
    return `https://www.facebook.com/${version()}/dialog/oauth?${form({ client_id: appId(), redirect_uri: redirectUri, state, response_type: 'code', scope: SCOPES.join(',') })}`;
  },

  async exchange(platform, code, redirectUri): Promise<ConnectResult> {
    const short = await get<{ access_token: string }>('/oauth/access_token', { client_id: appId(), client_secret: appSecret(), redirect_uri: redirectUri, code });
    const long = await get<{ access_token: string }>('/oauth/access_token', { grant_type: 'fb_exchange_token', client_id: appId(), client_secret: appSecret(), fb_exchange_token: short.access_token });
    const pages = (await get<{ data?: Page[] }>('/me/accounts', { fields: 'id,name,access_token,instagram_business_account{id,username}', limit: '50', access_token: long.access_token })).data ?? [];
    if (!pages.length) throw new Error('Esa cuenta no administra ninguna página de Facebook. Crea la página (o pide acceso de administrador) y vuelve a conectar.');
    const wanted = process.env.META_PAGE_ID?.trim();
    const page = (wanted ? pages.find((p) => p.id === wanted) : undefined) ?? (platform === 'instagram' ? pages.find((p) => p.instagram_business_account) : undefined) ?? pages[0];
    const ig = page.instagram_business_account;
    if (platform === 'instagram' && !ig) throw new Error(`La página «${page.name}» no tiene una cuenta de Instagram profesional vinculada. Vincúlala en la configuración de la página y vuelve a conectar.`);
    const facebook = { accountName: page.name, accountId: page.id, accessToken: page.access_token };
    const instagram = ig ? { accountName: ig.username ? `@${ig.username}` : page.name, accountId: ig.id, accessToken: page.access_token } : undefined;
    return platform === 'instagram' ? { ...instagram!, also: { facebook } } : { ...facebook, also: instagram ? { instagram } : undefined };
  },

  async publish(platform: Platform, req: PublishRequest): Promise<PublishResult> {
    if (!req.accountId) throw new Error('Falta el identificador de la cuenta: vuelve a conectar Meta.');
    if (!req.mediaUrl.startsWith('https://')) throw new Error('Meta necesita descargar el archivo desde una dirección pública https: revisa PANEL_URL en el .env.');
    return platform === 'instagram' ? publishInstagram(req) : publishFacebook(req);
  },
};

async function publishFacebook(req: PublishRequest): Promise<PublishResult> {
  const token = req.accessToken;
  if (req.mediaType === 'image') {
    const r = await post<{ id: string; post_id?: string }>(`/${req.accountId}/photos`, { url: req.mediaUrl, caption: caption(req.text, { title: true, max: 2000 }), published: 'true', access_token: token });
    const id = r.post_id ?? r.id;
    return { externalId: id, externalUrl: `https://www.facebook.com/${id}` };
  }
  const r = await post<{ id: string }>(`/${req.accountId}/videos`, { file_url: req.mediaUrl, title: req.text.title.slice(0, 100), description: caption(req.text, { max: 2000 }), access_token: token }, 300_000);
  return { externalId: r.id, externalUrl: `https://www.facebook.com/${req.accountId}/videos/${r.id}` };
}

async function publishInstagram(req: PublishRequest): Promise<PublishResult> {
  const token = req.accessToken;
  const text = caption(req.text, { title: true });
  const container =
    req.mediaType === 'image'
      ? await post<{ id: string }>(`/${req.accountId}/media`, { image_url: req.mediaUrl, caption: text, access_token: token })
      : await post<{ id: string }>(`/${req.accountId}/media`, { media_type: 'REELS', video_url: req.mediaUrl, caption: text, share_to_feed: 'true', access_token: token });
  // Videos are processed by Instagram first: wait until the container is FINISHED.
  if (req.mediaType === 'video') {
    const wait = Number(process.env.META_POLL_MS) || 10_000;
    for (let i = 0; ; i++) {
      const s = await get<{ status_code?: string; status?: string }>(`/${container.id}`, { fields: 'status_code,status', access_token: token });
      if (s.status_code === 'FINISHED') break;
      if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') throw new Error(`Instagram no pudo procesar el video: ${s.status ?? s.status_code}.`);
      if (i >= 40) throw new Error('Instagram tardó demasiado en procesar el video.');
      await sleep(wait);
    }
  }
  const published = await post<{ id: string }>(`/${req.accountId}/media_publish`, { creation_id: container.id, access_token: token });
  const link = await get<{ permalink?: string }>(`/${published.id}`, { fields: 'permalink', access_token: token }).catch(() => ({ permalink: undefined }));
  return { externalId: published.id, externalUrl: link.permalink ?? 'https://www.instagram.com/' };
}
