import type { ConnectResult, Platform, PublisherProvider, PublishRequest, PublishResult } from '../publisher.types.js';

/**
 * YouTube (Google): OAuth 2.0 + resumable upload of the video (Data API v3).
 * .env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET (an OAuth client of type «Aplicación web» whose redirect URI is
 * <PANEL_URL>/api/publisher-oauth/callback). YOUTUBE_PRIVACY = private | unlisted | public (default private:
 * Google keeps the videos of apps that haven't passed its audit as private no matter what is asked).
 */
const SCOPES = ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly'];
const clientId = () => process.env.GOOGLE_CLIENT_ID?.trim() ?? '';
const clientSecret = () => process.env.GOOGLE_CLIENT_SECRET?.trim() ?? '';

async function json<T>(res: Response, what: string): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } | string; error_description?: string };
  if (!res.ok) {
    const msg = typeof body.error === 'string' ? (body.error_description ?? body.error) : (body.error?.message ?? `HTTP ${res.status}`);
    throw new Error(`${what}: ${msg}`);
  }
  return body as T;
}

async function tokenRequest(params: Record<string, string>): Promise<{ access_token: string; refresh_token?: string; expires_in: number }> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId(), client_secret: clientSecret(), ...params }),
    signal: AbortSignal.timeout(30_000),
  });
  return json(res, 'Google');
}

const expiry = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString();

export const youtubeProvider: PublisherProvider = {
  key: 'google',
  label: 'YouTube (Google)',
  loginName: 'Google',
  available: true,
  oauth: true,
  envVars: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
  configured: () => !!(clientId() && clientSecret()),

  async connect() {
    throw new Error('YouTube se conecta con el botón «Conectar con Google».');
  },

  authUrl(_platform, redirectUri, state) {
    const q = new URLSearchParams({
      client_id: clientId(),
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPES.join(' '),
      access_type: 'offline', // so Google returns a refresh token
      prompt: 'consent',
      include_granted_scopes: 'true',
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
  },

  async exchange(_platform, code, redirectUri): Promise<ConnectResult> {
    const t = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri });
    const res = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { headers: { Authorization: `Bearer ${t.access_token}` }, signal: AbortSignal.timeout(30_000) });
    const channels = await json<{ items?: { snippet?: { title?: string } }[] }>(res, 'YouTube');
    const name = channels.items?.[0]?.snippet?.title;
    if (!name) throw new Error('Esa cuenta de Google no tiene un canal de YouTube. Crea el canal y vuelve a conectar.');
    return { accountName: name, accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: expiry(t.expires_in) };
  },

  async refresh(_platform, refreshToken) {
    const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken });
    return { accessToken: t.access_token, expiresAt: expiry(t.expires_in) };
  },

  async publish(_platform: Platform, req: PublishRequest): Promise<PublishResult> {
    if (req.mediaType !== 'video') throw new Error('YouTube solo recibe videos.');
    const bytes = await req.readMedia();
    const privacy = ['private', 'unlisted', 'public'].includes(process.env.YOUTUBE_PRIVACY ?? '') ? process.env.YOUTUBE_PRIVACY! : 'private';
    const description = [req.text.description, req.text.hashtags.map((h) => `#${h}`).join(' ')].filter(Boolean).join('\n\n');
    const metadata = {
      snippet: { title: req.text.title.slice(0, 100), description: description.slice(0, 5000), tags: req.text.hashtags.slice(0, 15), categoryId: '22' },
      status: { privacyStatus: privacy, selfDeclaredMadeForKids: false },
    };
    // 1) open the resumable session
    const start = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${req.accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Length': String(bytes.length),
        'X-Upload-Content-Type': 'video/mp4',
      },
      body: JSON.stringify(metadata),
      signal: AbortSignal.timeout(30_000),
    });
    if (!start.ok) await json(start, 'YouTube');
    const location = start.headers.get('location');
    if (!location) throw new Error('YouTube no abrió la sesión de subida.');
    // 2) upload the file
    const up = await fetch(location, { method: 'PUT', headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(bytes.length) }, body: new Uint8Array(bytes), signal: AbortSignal.timeout(15 * 60_000) });
    const video = await json<{ id?: string }>(up, 'YouTube');
    if (!video.id) throw new Error('YouTube no devolvió el identificador del video.');
    // 3) thumbnail: best effort, needs a verified channel
    if (req.thumbnailUrl.startsWith('http')) {
      try {
        const img = await fetch(req.thumbnailUrl, { signal: AbortSignal.timeout(30_000) });
        if (img.ok) {
          await fetch(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${video.id}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${req.accessToken}`, 'Content-Type': img.headers.get('content-type') ?? 'image/jpeg' },
            body: new Uint8Array(await img.arrayBuffer()),
            signal: AbortSignal.timeout(60_000),
          });
        }
      } catch {
        /* the video is already up; a missing thumbnail is harmless */
      }
    }
    return { externalId: video.id, externalUrl: `https://www.youtube.com/watch?v=${video.id}` };
  },
};
