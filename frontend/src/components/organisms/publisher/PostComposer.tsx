import { useState } from 'react';
import { CalendarClock, Save, Send, Sparkles } from 'lucide-react';
import type { Api } from '../../../services/api.ts';
import { errMsg } from '../../../services/api.ts';
import type { PublisherConnection, PublisherPlatform, PublisherPost, SeoText } from '../../../types/publisher.ts';
import { Modal } from '../Modal.tsx';
import { Button } from '../../atoms/Button.tsx';
import { Hint, Input, Label, Textarea } from '../../atoms/Input.tsx';
import { useToast } from '../../molecules/Toast.tsx';

const tags = (list: string[]) => list.map((t) => `#${t}`).join(' ');
const parseTags = (text: string) => text.split(/[\s,]+/).map((t) => t.replace(/^#+/, '')).filter(Boolean);

/** Edit one post: texts, networks, SEO per network, and when it goes out. */
export function PostComposer({ api, post, connections, textAi, onClose, onChange }: { api: Api; post: PublisherPost; connections: PublisherConnection[]; textAi: boolean; onClose: () => void; onChange: () => void }) {
  const toast = useToast();
  const [title, setTitle] = useState(post.title);
  const [description, setDescription] = useState(post.description);
  const [hashtags, setHashtags] = useState(tags(post.hashtags));
  const [keywords, setKeywords] = useState(post.keywords.join(', '));
  const [platforms, setPlatforms] = useState<PublisherPlatform[]>(post.platforms);
  const [seo, setSeo] = useState(post.seo);
  const [active, setActive] = useState<PublisherPlatform | null>(post.platforms[0] ?? null);
  const [when, setWhen] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const locked = post.status === 'publishing' || post.status === 'published';

  const toggle = (p: PublisherPlatform) => {
    setPlatforms((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));
    setActive(p);
  };
  const setText = (p: PublisherPlatform, patch: Partial<SeoText>) => setSeo((s) => ({ ...s, [p]: { title: '', description: '', hashtags: [], ...s[p], ...patch } }));

  const body = () => ({
    title,
    description,
    hashtags: parseTags(hashtags),
    keywords: keywords.split(',').map((k) => k.trim()).filter(Boolean),
    seo,
    platforms,
  });

  async function run<T>(label: string, fn: () => Promise<T>, ok?: string) {
    setBusy(label);
    try {
      const res = await fn();
      if (ok) toast.success(ok);
      return res;
    } catch (err) {
      toast.error(errMsg(err));
      return undefined;
    } finally {
      setBusy(null);
    }
  }

  const save = () => api.put(`/api/admin/publisher/posts/${post.id}`, body());

  async function suggest() {
    const res = await run('seo', async () => {
      await save();
      return api.post<{ post: PublisherPost; usedAi: boolean }>(`/api/admin/publisher/posts/${post.id}/seo`, { platforms });
    });
    if (res) {
      setSeo(res.post.seo);
      toast.success(res.usedAi ? 'Listo: la IA sugirió los textos de cada red.' : 'Listo: textos sugeridos con tu perfil de marca (sin IA).');
    }
  }

  async function saveDraft() {
    if (await run('save', save, 'Guardado.')) {
      onChange();
      onClose();
    }
  }

  async function go(now: boolean) {
    if (!now && !when) return toast.error('Elige el día y la hora.');
    const res = await run(
      'go',
      async () => {
        await save();
        return api.post(`/api/admin/publisher/posts/${post.id}/schedule`, { at: now ? '' : new Date(when).toISOString() });
      },
      now ? 'Listo: se envió. Mira el resultado en la cola.' : 'Listo: quedó programada.',
    );
    if (res) {
      onChange();
      onClose();
    }
  }

  return (
    <Modal title="Preparar publicación" description="Elige las redes, ajusta los textos de cada una y programa el momento." onClose={onClose} size="lg">
      <div className="grid gap-5 md:grid-cols-[200px_1fr]">
        <div>
          {post.mediaType === 'video' ? (
            <video src={post.mediaUrl} poster={post.thumbnailUrl} controls playsInline preload="metadata" className="w-full rounded-2xl bg-black" />
          ) : (
            <img src={post.mediaUrl} alt={post.title} className="w-full rounded-2xl" />
          )}
        </div>
        <div className="space-y-4">
          <div>
            <Label htmlFor="pc-title">Título</Label>
            <Input id="pc-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} disabled={locked} />
          </div>
          <div>
            <Label htmlFor="pc-desc">Descripción general</Label>
            <Textarea id="pc-desc" rows={3} value={description} maxLength={2000} onChange={(e) => setDescription(e.target.value)} disabled={locked} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="pc-tags">Hashtags</Label>
              <Input id="pc-tags" value={hashtags} onChange={(e) => setHashtags(e.target.value)} placeholder="#canix #recordatorios" disabled={locked} />
            </div>
            <div>
              <Label htmlFor="pc-kw">Palabras clave (SEO)</Label>
              <Input id="pc-kw" value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="asistente whatsapp, recordatorios" disabled={locked} />
            </div>
          </div>
        </div>
      </div>

      <div className="mt-5">
        <Label>¿Dónde se publica?</Label>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {connections.map((c) => (
            <label key={c.platform} className={`inline-flex items-center gap-2 text-sm ${c.connected ? 'cursor-pointer text-ink dark:text-white/85' : 'text-gray-dark'}`}>
              <input type="checkbox" className="h-4 w-4 accent-[var(--color-primary)]" checked={platforms.includes(c.platform)} disabled={!c.connected || locked} onChange={() => toggle(c.platform)} />
              {c.name} {!c.connected && <span className="text-xs">(sin conectar)</span>}
            </label>
          ))}
        </div>
      </div>

      {platforms.length > 0 && (
        <div className="mt-5 rounded-2xl border border-gray-medium p-4 dark:border-white/10">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {platforms.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setActive(p)}
                className={`rounded-full border px-3 py-1 text-xs font-semibold ${active === p ? 'border-primary bg-primary/10 text-primary-dark dark:text-white' : 'border-gray-medium text-gray-dark dark:border-white/10'}`}
              >
                {connections.find((c) => c.platform === p)?.name}
              </button>
            ))}
            <Button variant="soft" size="sm" className="ml-auto" onClick={suggest} loading={busy === 'seo'} disabled={locked}>
              <Sparkles size={14} /> Sugerir SEO
            </Button>
          </div>
          {active && platforms.includes(active) ? (
            <div className="space-y-3">
              <div>
                <Label htmlFor="pc-st">Título en esta red</Label>
                <Input id="pc-st" value={seo[active]?.title ?? ''} onChange={(e) => setText(active, { title: e.target.value })} placeholder={title} disabled={locked} />
              </div>
              <div>
                <Label htmlFor="pc-sd">Descripción en esta red</Label>
                <Textarea id="pc-sd" rows={4} value={seo[active]?.description ?? ''} onChange={(e) => setText(active, { description: e.target.value })} placeholder={description} disabled={locked} />
              </div>
              <div>
                <Label htmlFor="pc-sh">Hashtags en esta red</Label>
                <Input id="pc-sh" value={tags(seo[active]?.hashtags ?? [])} onChange={(e) => setText(active, { hashtags: parseTags(e.target.value) })} disabled={locked} />
              </div>
            </div>
          ) : (
            <Hint>Toca una red para ver y ajustar sus textos.</Hint>
          )}
          <Hint>{textAi ? 'La IA adapta el título, la descripción y los hashtags a cada red con tu perfil de marca.' : 'Sin la clave de IA, los textos salen de una plantilla con tu perfil de marca.'}</Hint>
        </div>
      )}

      {!locked && (
        <div className="mt-5 flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="pc-when">Programar para</Label>
            <Input id="pc-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          </div>
          <Button onClick={() => go(false)} loading={busy === 'go'} disabled={!platforms.length}>
            <CalendarClock size={16} /> Programar
          </Button>
          <Button variant="secondary" onClick={() => go(true)} disabled={!platforms.length || busy !== null}>
            <Send size={16} /> Publicar ahora
          </Button>
          <Button variant="ghost" onClick={saveDraft} loading={busy === 'save'}>
            <Save size={16} /> Guardar borrador
          </Button>
        </div>
      )}
    </Modal>
  );
}
