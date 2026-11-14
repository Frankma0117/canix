import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Download, Pencil, RotateCw, Send, Sparkles, Star, Trash2, X } from 'lucide-react';
import type { Api } from '../../../services/api.ts';
import { errMsg } from '../../../services/api.ts';
import type { DesignKind, StudioColors, StudioDesign, StudioResponse, StudioStatus } from '../../../types/publisher.ts';
import { Card } from '../../atoms/Card.tsx';
import { Button } from '../../atoms/Button.tsx';
import { Hint, Input, Label, Select, Textarea } from '../../atoms/Input.tsx';
import { Skeleton } from '../../atoms/Skeleton.tsx';
import { EmptyState } from '../../molecules/EmptyState.tsx';
import { Notice } from '../../molecules/Notice.tsx';
import { useToast } from '../../molecules/Toast.tsx';

const KINDS: { id: DesignKind; icon: string; label: string; hint: string }[] = [
  { id: 'logo', icon: '🔷', label: 'Logo', hint: 'El símbolo y el nombre de la marca.' },
  { id: 'profile', icon: '👤', label: 'Foto de perfil', hint: 'Con tu logo, lista para el círculo de cada red.' },
  { id: 'cover', icon: '🖼️', label: 'Portada / banner', hint: 'YouTube y Facebook, con la zona segura.' },
  { id: 'post', icon: '📸', label: 'Publicación', hint: 'Cuadrada o vertical, para el feed.' },
  { id: 'story', icon: '📱', label: 'Historia / Reel', hint: 'Vertical 9:16: historias, Reels y TikTok.' },
];
const COLOR_NAMES: Record<keyof StudioColors, string> = { primary: 'Principal', secondary: 'Suave', accent: 'Acento', dark: 'Oscuro', light: 'Claro' };
const STATUS: Record<string, string> = { review: 'Por revisar', approved: 'Aprobado', rejected: 'Descartado', pending: 'En cola', working: 'Creándose', error: 'Error' };

const chip = (on: boolean) =>
  `rounded-full border px-3.5 py-1.5 text-sm font-semibold transition-all ${on ? 'border-primary bg-primary/10 text-primary-dark dark:text-white' : 'border-gray-medium bg-white text-ink hover:border-primary/40 dark:border-white/10 dark:bg-white/5 dark:text-white'}`;

/** Brand studio: identity (colors, type, logo) and the designs made with it. */
export function StudioPanel({ api, onUse }: { api: Api; onUse: (designId: number) => void }) {
  const toast = useToast();
  const [data, setData] = useState<StudioResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      const res = await api.get<StudioResponse>('/api/admin/publisher/studio');
      setData(res);
      window.clearTimeout(timer.current);
      if (res.designs.some((d) => d.status === 'pending' || d.status === 'working')) timer.current = window.setTimeout(() => void load(), 4000);
    } catch (err) {
      setError(errMsg(err));
    }
  }, [api]);
  useEffect(() => {
    void load();
    return () => window.clearTimeout(timer.current);
  }, [load]);

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!data) return <Skeleton className="h-64" />;
  const { status, designs } = data;
  const GROUPS = [
    { id: 'review', title: 'Por revisar', match: ['review'] },
    { id: 'working', title: 'En proceso', match: ['pending', 'working', 'error'] },
    { id: 'approved', title: 'Aprobados', match: ['approved'] },
    { id: 'rejected', title: 'Descartados', match: ['rejected'] },
  ];

  return (
    <div className="space-y-6">
      {!status.canCompose && <Notice tone="warning">Falta instalar el navegador de diseño en el servidor. Se instala solo al actualizar: <code>cd /opt/canix && sudo ./deploy.sh</code>.</Notice>}
      {status.art.key === 'mock' && <Notice tone="info">Sin la clave de IA de imágenes (FAL_KEY) el arte es un degradado de tu marca. Los diseños sin IA («Consejo» y «Frase») salen igual de bien y no cuestan.</Notice>}
      <IdentityCard api={api} status={status} onSaved={() => void load()} />
      <Creator api={api} status={status} onCreated={() => void load()} />
      {designs.length === 0 && <EmptyState sticker="idea" title="Todavía no hay diseños" description="Empieza por el logo; después se dibuja en todas tus publicaciones." />}
      {GROUPS.map((g) => {
        const list = designs.filter((d) => g.match.includes(d.status));
        if (!list.length) return null;
        return (
          <section key={g.id}>
            <h2 className="mb-3 font-display text-xl font-extrabold text-ink dark:text-white">
              {g.title} <span className="text-gray-dark">({list.length})</span>
            </h2>
            <div className="grid items-start gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {list.map((d) => (
                <DesignCard key={`${d.id}-${d.status}-${d.url}`} api={api} design={d} isLogo={d.kind === 'logo' && d.url === status.identity.logoUrl} onChange={() => void load()} onUse={() => onUse(d.id)} toast={toast} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function IdentityCard({ api, status, onSaved }: { api: Api; status: StudioStatus; onSaved: () => void }) {
  const toast = useToast();
  const [colors, setColors] = useState<StudioColors>(status.identity.colors);
  const [style, setStyle] = useState(status.identity.style);
  const [font, setFont] = useState(status.identity.font);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await api.put('/api/admin/publisher/studio/identity', { colors, style, font });
      toast.success('Listo: los próximos diseños usan esta identidad.');
      onSaved();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5 sm:p-6">
      <h2 className="font-display text-lg font-extrabold text-ink dark:text-white">Identidad visual</h2>
      <p className="mb-4 mt-1 text-sm text-gray-dark">Colores, letra y estilo con los que se dibuja todo. Cámbialos una vez y todas las piezas nuevas salen coherentes.</p>
      <div className="mb-4 flex flex-wrap gap-4">
        {(Object.keys(COLOR_NAMES) as (keyof StudioColors)[]).map((k) => (
          <label key={k} className="flex flex-col items-center gap-1.5 text-xs font-semibold text-gray-dark">
            <input type="color" aria-label={`Color ${COLOR_NAMES[k]}`} value={colors[k]} onChange={(e) => setColors((c) => ({ ...c, [k]: e.target.value.toUpperCase() }))} className="h-12 w-12 cursor-pointer rounded-xl border border-gray-medium bg-transparent p-0.5 dark:border-white/10" />
            {COLOR_NAMES[k]}
          </label>
        ))}
        {status.identity.logoUrl && (
          <div className="ml-auto flex flex-col items-center gap-1.5 text-xs font-semibold text-gray-dark">
            <img src={status.identity.logoUrl} alt="Logo en uso" className="h-12 w-12 rounded-xl border border-gray-medium object-cover dark:border-white/10" />
            Logo en uso
          </div>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="id-font">Tipo de letra</Label>
          <Select id="id-font" value={font} onChange={(e) => setFont(e.target.value)}>
            {status.fonts.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="id-style">Estilo del arte</Label>
          <Input id="id-style" value={style} maxLength={300} onChange={(e) => setStyle(e.target.value)} placeholder="Moderno, cálido, ilustración plana con degradados suaves" />
          <Hint>La IA de imagen pinta el arte con este estilo y tus colores.</Hint>
        </div>
      </div>
      <Button className="mt-4" size="sm" onClick={save} loading={busy}>
        Guardar identidad
      </Button>
    </Card>
  );
}

function Creator({ api, status, onCreated }: { api: Api; status: StudioStatus; onCreated: () => void }) {
  const toast = useToast();
  const [kind, setKind] = useState<DesignKind>('post');
  const [layout, setLayout] = useState('auto');
  const [formats, setFormats] = useState<string[]>(['square']);
  const [brief, setBrief] = useState('');
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState(false);

  const kindFormats = status.formats.filter((f) => f.kind === kind);
  const layouts = status.layouts.filter((l) => l.kinds.includes(kind));
  const pick = (k: DesignKind) => {
    setKind(k);
    setLayout('auto');
    setFormats(status.formats.filter((f) => f.kind === k).slice(0, k === 'cover' ? 2 : 1).map((f) => f.key));
  };
  const toggle = (key: string) => setFormats((cur) => (cur.includes(key) ? cur.filter((f) => f !== key) : [...cur, key]));

  async function create() {
    if (!formats.length) return toast.error('Elige al menos un formato.');
    setBusy(true);
    try {
      await api.post('/api/admin/publisher/studio/designs', { kind, layout, formats, brief, count });
      toast.success('Listo: se está diseñando. Aparece aquí abajo en unos segundos.');
      setBrief('');
      onCreated();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  const single = kind === 'logo' || kind === 'profile' || kind === 'cover';
  return (
    <Card className="p-5 sm:p-6">
      <h2 className="mb-4 font-display text-lg font-extrabold text-ink dark:text-white">Nuevo diseño</h2>
      <div className="mb-4 grid gap-2.5 sm:grid-cols-3 xl:grid-cols-5">
        {KINDS.map((k) => (
          <button key={k.id} type="button" onClick={() => pick(k.id)} className={`rounded-2xl border-2 p-3 text-left transition-all ${kind === k.id ? 'border-primary bg-primary/5' : 'border-gray-medium hover:border-primary/40 dark:border-white/10'}`}>
            <p className="font-display font-extrabold text-ink dark:text-white">
              {k.icon} {k.label}
            </p>
            <p className="mt-0.5 text-xs text-gray-dark">{k.hint}</p>
          </button>
        ))}
      </div>
      <div className="mb-4">
        <Label>Formato</Label>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {kindFormats.map((f) => (
            <label key={f.key} className="inline-flex cursor-pointer items-center gap-2 text-sm text-ink dark:text-white/85">
              <input type="checkbox" className="h-4 w-4 accent-[var(--color-primary)]" checked={formats.includes(f.key)} onChange={() => toggle(f.key)} /> {f.label}
            </label>
          ))}
        </div>
      </div>
      {layouts.length > 1 && (
        <div className="mb-4">
          <Label>Diseño</Label>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={chip(layout === 'auto')} onClick={() => setLayout('auto')}>
              ✨ Variado
            </button>
            {layouts.map((l) => (
              <button key={l.key} type="button" className={chip(layout === l.key)} onClick={() => setLayout(l.key)}>
                {l.label}
                {l.usesArt ? '' : ' · gratis'}
              </button>
            ))}
          </div>
        </div>
      )}
      {!single && (
        <div className="mb-4">
          <Label>¿Cuántos?</Label>
          <div className="flex gap-2">
            {[1, 2, 3, 4].map((n) => (
              <button key={n} type="button" className={`${chip(count === n)} min-w-11`} onClick={() => setCount(n)}>
                {n}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="mb-4">
        <Label htmlFor="st-brief">Indicación (opcional)</Label>
        <Textarea id="st-brief" rows={2} maxLength={500} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder={kind === 'logo' ? 'Ej.: una nube con un check, amigable.' : 'Ej.: tres consejos para organizar la semana de un emprendedor.'} />
        <Hint>
          {status.textAi ? 'La IA escribe los textos con tu perfil de marca; los puedes corregir después.' : 'Sin la clave de IA de texto se usan textos de plantilla con tu perfil de marca.'} Este mes llevas {status.budget.used} de {status.budget.cap} piezas con costo.
        </Hint>
      </div>
      <Button onClick={create} loading={busy} disabled={!status.canCompose}>
        <Sparkles size={16} /> Crear
      </Button>
    </Card>
  );
}

function DesignCard({ api, design: d, isLogo, onChange, onUse, toast }: { api: Api; design: StudioDesign; isLogo: boolean; onChange: () => void; onUse: () => void; toast: ReturnType<typeof useToast> }) {
  const [editing, setEditing] = useState(false);
  const [headline, setHeadline] = useState(d.content.headline ?? d.title);
  const [sub, setSub] = useState(d.content.sub ?? '');
  const [cta, setCta] = useState(d.content.cta ?? '');
  const [caption, setCaption] = useState(d.caption);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const working = d.status === 'pending' || d.status === 'working';

  async function act(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true);
    try {
      await fn();
      if (ok) toast.success(ok);
      onChange();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
      setAsking(false);
    }
  }
  const base = `/api/admin/publisher/studio/designs/${d.id}`;

  return (
    <Card className="overflow-hidden">
      <div className="relative bg-gray-medium/40 dark:bg-white/5">
        {d.url && !working ? <img src={d.url} alt={d.title} className="max-h-[420px] w-full object-contain" /> : <div className="flex aspect-square items-center justify-center p-6 text-center text-sm text-gray-dark">{d.status === 'error' ? d.detail : d.detail || 'En cola…'}</div>}
        <span className="absolute left-3 top-3 rounded-full bg-white/90 px-2.5 py-0.5 text-xs font-semibold text-ink shadow dark:bg-navy/80 dark:text-white">{isLogo ? 'Logo en uso' : STATUS[d.status]}</span>
      </div>
      <div className="p-4">
        <p className="line-clamp-2 font-display font-extrabold text-ink dark:text-white">{d.title || d.formatLabel}</p>
        <p className="text-xs text-gray-dark">{d.formatLabel}{d.useAi ? ' · arte con IA' : ''}</p>
        {editing && (
          <div className="mt-3 space-y-2.5">
            <div>
              <Label htmlFor={`h-${d.id}`}>Titular</Label>
              <Input id={`h-${d.id}`} value={headline} maxLength={90} onChange={(e) => setHeadline(e.target.value)} />
            </div>
            <div>
              <Label htmlFor={`s-${d.id}`}>Apoyo</Label>
              <Input id={`s-${d.id}`} value={sub} maxLength={110} onChange={(e) => setSub(e.target.value)} />
            </div>
            <div>
              <Label htmlFor={`c-${d.id}`}>Botón</Label>
              <Input id={`c-${d.id}`} value={cta} maxLength={28} onChange={(e) => setCta(e.target.value)} />
            </div>
            <div>
              <Label htmlFor={`t-${d.id}`}>Texto para publicar</Label>
              <Textarea id={`t-${d.id}`} rows={3} value={caption} maxLength={600} onChange={(e) => setCaption(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <Button size="sm" loading={busy} onClick={() => act(async () => { await api.put(base, { headline, sub, cta, caption }); setEditing(false); }, 'Listo: se vuelve a dibujar con tus textos.')}>
                Guardar y redibujar
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancelar
              </Button>
            </div>
          </div>
        )}
      </div>
      {!working && (
        <div className="flex flex-wrap gap-2 border-t border-gray-medium px-4 py-3 dark:border-white/10">
          {d.status === 'review' && (
            <>
              <Button size="sm" loading={busy} onClick={() => act(() => api.post(`${base}/review`, { approve: true }), 'Aprobado.')}>
                <Check size={13} /> Aprobar
              </Button>
              <Button size="sm" variant="secondary" onClick={() => act(() => api.post(`${base}/review`, { approve: false }))}>
                <X size={13} /> Descartar
              </Button>
            </>
          )}
          {d.status === 'approved' && d.kind === 'logo' && !isLogo && (
            <Button size="sm" loading={busy} onClick={() => act(() => api.post(`${base}/logo`), 'Listo: este es ahora el logo de todas las piezas.')}>
              <Star size={13} /> Usar como logo
            </Button>
          )}
          {d.status === 'approved' && (d.kind === 'post' || d.kind === 'story') && (
            <Button size="sm" onClick={onUse}>
              <Send size={13} /> Publicar
            </Button>
          )}
          {d.url && (
            <a href={d.url} download target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-gray-medium px-3 py-1.5 text-xs font-semibold text-ink hover:border-primary/50 dark:border-white/10 dark:text-white">
              <Download size={13} /> Descargar
            </a>
          )}
          {d.status !== 'error' && (
            <Button size="sm" variant="ghost" onClick={() => setEditing((v) => !v)} aria-label="Editar textos">
              <Pencil size={13} />
            </Button>
          )}
          <Button size="sm" variant="ghost" loading={busy} onClick={() => act(() => api.post(`${base}/redo`), 'Listo: se está creando otra versión.')} aria-label="Otra versión">
            <RotateCw size={13} />
          </Button>
          {asking ? (
            <span className="ml-auto flex items-center gap-1.5 text-xs">
              ¿Borrar?
              <Button size="sm" variant="danger" loading={busy} onClick={() => act(() => api.del(base), 'Borrado.')}>
                Sí
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>
                No
              </Button>
            </span>
          ) : (
            <Button size="sm" variant="ghost" className="ml-auto" aria-label="Borrar" onClick={() => setAsking(true)}>
              <Trash2 size={13} />
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
