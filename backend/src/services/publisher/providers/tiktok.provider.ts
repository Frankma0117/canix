import type { ConnectResult, Platform, PublisherProvider, PublishRequest, PublishResult } from '../publisher.types.js';
import { caption, fetchJson, form, sleep } from './shared.js';

/**
 * TikTok: OAuth + Content Posting API (direct post, upload of the file in chunks).
 * .env: TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET (developers.tiktok.com app with «Login Kit» and «Content Posting API»,
 * redirect URI <PANEL_URL>/api/publisher-oauth/callback). TIKTOK_PRIVACY = SELF_ONLY | PUBLIC_TO_EVERYONE | ...
 * (default SELF_ONLY: until TikTok audits the app, every post must be private).
 */
const SCOPES = ['user.info.basic', 'video.publish'];
const clientKey = () => process.env.TIKTOK_CLIENT_KEY?.trim() ?? '';
const clientSecret = () => process.env.TIKTOK_CLIENT_SECRET?.trim() ?? '';
const API = 'https://open.tiktokapis.com';

/** TikTok answers 200 with an `error` object even when it fails. */
const tiktokError = (b: Record<string, unknown>): string | undefined => {
  const e = b.error as { code?: string; message?: string } | string | undefined;
  if (typeof e === 'string') return (b.error_description as string | undefined) ?? e;
  return e && e.code && e.code !== 'ok' ? `${e.message || e.code}` : undefined;
};

interface TokenBody {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  open_id?: string;
}

async function token(params: Record<string, string>): Promise<TokenBody> {
  return fetchJson<TokenBody>(`${API}/v2/oauth/token/`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ client_key: clientKey(), client_secret: clientSecret(), ...params }) }, 'TikTok', tiktokError);
}

const authed = (accessToken: string, json?: unknown): RequestInit => ({
  method: json === undefined ? 'GET' : 'POST',
  headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json; charset=UTF-8' },
  body: json === undefined ? undefined : JSON.stringify(json),
});

const CHUNK = 10 * 1024 * 1024;

export const tiktokProvider: PublisherProvider = {
  key: 'tiktok',
  label: 'TikTok',
  loginName: 'TikTok',
  available: true,
  oauth: true,
  envVars: ['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET'],
  configured: () => !!(clientKey() && clientSecret()),

  async connect() {
    throw new Error('TikTok se conecta con el botón «Conectar con TikTok».');
  },

  authUrl(_platform, redirectUri, state) {
    return `https://www.tiktok.com/v2/auth/authorize/?${form({ client_key: clientKey(), scope: SCOPES.join(','), response_type: 'code', redirect_uri: redirectUri, state })}`;
  },

  async exchange(_platform, code, redirectUri): Promise<ConnectResult> {
    const t = await token({ code, grant_type: 'authorization_code', redirect_uri: redirectUri });
    const info = await fetchJson<{ data?: { user?: { display_name?: string } } }>(`${API}/v2/user/info/?fields=open_id,display_name`, authed(t.access_token), 'TikTok', tiktokError);
    return {
      accountName: info.data?.user?.display_name || 'Cuenta de TikTok',
      accountId: t.open_id,
      accessToken: t.access_token,
      refreshToken: t.refresh_token,
      expiresAt: new Date(Date.now() + t.expires_in * 1000).toISOString(),
    };
  },

  async refresh(_platform, refreshToken) {
    const t = await token({ grant_type: 'refresh_token', refresh_token: refreshToken });
    return { accessToken: t.access_token, expiresAt: new Date(Date.now() + t.expires_in * 1000).toISOString() };
  },

  async publish(_platform: Platform, req: PublishRequest): Promise<PublishResult> {
    if (req.mediaType !== 'video') throw new Error('TikTok solo recibe videos.');
    const bytes = await req.readMedia();
    const size = bytes.length;

    // 1) which privacy levels this account can use right now
    const creator = await fetchJson<{ data?: { privacy_level_options?: string[] } }>(`${API}/v2/post/publish/creator_info/query/`, authed(req.accessToken, {}), 'TikTok', tiktokError);
    const options = creator.data?.privacy_level_options ?? [];
    const wanted = process.env.TIKTOK_PRIVACY?.trim() || 'SELF_ONLY';
    const privacy = options.includes(wanted) ? wanted : (options[0] ?? 'SELF_ONLY');

    // 2) start the post: one chunk up to 20 MB, otherwise 10 MB chunks (the last one takes the remainder)
    const chunk = size <= 2 * CHUNK ? size : CHUNK;
    const total = Math.floor(size / chunk) || 1;
    const init = await fetchJson<{ data?: { publish_id?: string; upload_url?: string } }>(
      `${API}/v2/post/publish/video/init/`,
      authed(req.accessToken, {
        post_info: { title: caption(req.text, { title: true, max: 2200 }), privacy_level: privacy, disable_duet: false, disable_comment: false, disable_stitch: false },
        source_info: { source: 'FILE_UPLOAD', video_size: size, chunk_size: chunk, total_chunk_count: total },
      }),
      'TikTok',
      tiktokError,
    );
    const { publish_id: publishId, upload_url: uploadUrl } = init.data ?? {};
    if (!publishId || !uploadUrl) throw new Error('TikTok no abrió la subida.');

    // 3) upload
    for (let i = 0; i < total; i++) {
      const start = i * chunk;
      const end = i === total - 1 ? size : start + chunk;
      const res = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(end - start), 'Content-Range': `bytes ${start}-${end - 1}/${size}` },
        body: new Uint8Array(bytes.subarray(start, end)),
        signal: AbortSignal.timeout(10 * 60_000),
      });
      if (!res.ok) throw new Error(`TikTok: la subida falló (HTTP ${res.status}).`);
    }

    // 4) wait for the result
    const wait = Number(process.env.TIKTOK_POLL_MS) || 5000;
    for (let i = 0; i < 60; i++) {
      const s = await fetchJson<{ data?: { status?: string; fail_reason?: string; publicaly_available_post_id?: (string | number)[] } }>(`${API}/v2/post/status/fetch/`, authed(req.accessToken, { publish_id: publishId }), 'TikTok', tiktokError);
      const status = s.data?.status;
      if (status === 'PUBLISH_COMPLETE') {
        const id = s.data?.publicaly_available_post_id?.[0];
        return { externalId: String(id ?? publishId), externalUrl: id ? `https://www.tiktok.com/@/video/${id}` : 'https://www.tiktok.com/' };
      }
      if (status === 'FAILED') throw new Error(`TikTok rechazó el video: ${s.data?.fail_reason ?? 'sin motivo'}.`);
      await sleep(wait);
    }
    throw new Error('TikTok tardó demasiado en procesar el video.');
  },
};
