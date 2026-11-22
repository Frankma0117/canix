import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { errMsg, type Api } from '../../../services/api.ts';
import type { Callout, Pose, Scene, StudioResponse, StudioVideo, VideoSpec } from '../../../types/video-studio.ts';
import { Notice } from '../../molecules/Notice.tsx';
import { useToast } from '../../molecules/Toast.tsx';
import { Card } from '../../atoms/Card.tsx';
import { Button } from '../../atoms/Button.tsx';
import { Input, Label, Select } from '../../atoms/Input.tsx';
import { Skeleton } from '../../atoms/Skeleton.tsx';

const BASE = '/api/admin/video-studio';
const POSES: { id: Pose; label: string }[] = [
  { id: 'wave', label: 'Saluda' },
  { id: 'point', label: 'Señala' },
  { id: 'celebrate', label: 'Celebra' },
  { id: 'idle', label: 'En reposo' },
  { id: 'none', label: 'Sin mascota' },
];
const STATUS: Record<StudioVideo['status'], string> = { draft: 'Borrador', rendering: 'Generando…', review: 'Por revisar', approved: 'Aprobado', error: 'Con error' };
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const pct = (v: string) => Math.min(100, Math.max(0, Number(v) || 0));

/** Image of the taller (protected endpoint) shown through a blob URL, loaded once per path. */
function useAsset(api: Api, path: string): string {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let alive = true;
    let url = '';
    api.fileUrl(`${BASE}/asset/${path}`).then((u) => {
      url = u;
      if (alive) setSrc(u);
    }).catch(() => undefined);
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [api, path]);
  return src;
}

/** The scene's screenshot with its callouts as numbered dots; clicking moves the selected one. */
function ScenePreview({ api, scene, active, onMove }: { api: Api; scene: Scene; active: number; onMove: (x: number, y: number) => void }) {
  const src = useAsset(api, scene.image);
  return (
    <div
      className="relative mx-auto w-full max-w-[220px] cursor-crosshair select-none overflow-hidden rounded-2xl border border-gray-medium bg-gray-medium/40 dark:border-white/10"
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        onMove(Math.round(((e.clientX - r.left) / r.width) * 100), Math.round(((e.clientY - r.top) / r.height) * 100));
      }}
    >
      {src ? <img src={src} alt="" draggable={false} className="block w-full" /> : <Skeleton className="h-72" />}
      {(scene.callouts ?? []).map((c, i) => (
        <span
          key={i}
          style={{ left: `${c.x}%`, top: `${c.y}%` }}
          className={`absolute grid h-6 w-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full text-xs font-bold text-white shadow ${i === active ? 'brand-gradient ring-2 ring-white' : 'bg-ink/70'}`}
        >
          {i + 1}
        </span>
      ))}
    </div>
  );
}

function SceneEditor({ api, scene, index, assets, onChange, onRemove }: { api: Api; scene: Scene; index: number; assets: string[]; onChange: (s: Scene) => void; onRemove: () => void }) {
  const [active, setActive] = useState(0);
  const callouts = scene.callouts ?? [];
  const setCallout = (i: number, patch: Partial<Callout>) => onChange({ ...scene, callouts: callouts.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const id = `sc${index}`;
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-display text-base font-extrabold text-ink dark:text-white">Escena {index + 1}</h3>
        <Button size="sm" variant="ghost" onClick={onRemove} aria-label={`Quitar la escena ${index + 1}`}>
          <Trash2 size={14} />
        </Button>
      </div>
      <div className="grid gap-4 md:grid-cols-[220px_1fr]">
        <div>
          <ScenePreview api={api} scene={scene} active={active} onMove={(x, y) => callouts[active] && setCallout(active, { x, y })} />
          <p className="mt-2 text-center text-xs text-gray-dark">Elige un recuadro y toca la imagen para moverlo.</p>
        </div>
        <div className="grid content-start gap-3">
          <div>
            <Label htmlFor={`${id}-img`}>Pantalla</Label>
            <Select id={`${id}-img`} value={scene.image} onChange={(e) => onChange({ ...scene, image: e.target.value })}>
              {!assets.includes(scene.image) && <option value={scene.image}>{scene.image}</option>}
              {assets.map((a) => (
                <option key={a} value={a}>
                  {a.replace(/^proyectos\//, '')}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor={`${id}-t`}>Título</Label>
              <Input id={`${id}-t`} value={scene.title} maxLength={60} onChange={(e) => onChange({ ...scene, title: e.target.value })} />
            </div>
            <div>
              <Label htmlFor={`${id}-s`}>Subtítulo</Label>
              <Input id={`${id}-s`} value={scene.sub ?? ''} maxLength={90} onChange={(e) => onChange({ ...scene, sub: e.target.value })} />
            </div>
            <div>
              <Label htmlFor={`${id}-p`}>Mascota</Label>
              <Select id={`${id}-p`} value={scene.mascot?.pose ?? 'none'} onChange={(e) => onChange({ ...scene, mascot: { pose: e.target.value as Pose, side: scene.mascot?.side ?? 'right' } })}>
                {POSES.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor={`${id}-d`}>Lado de la mascota</Label>
              <Select id={`${id}-d`} value={scene.mascot?.side ?? 'right'} onChange={(e) => onChange({ ...scene, mascot: { pose: scene.mascot?.pose ?? 'none', side: e.target.value as 'left' | 'right' } })}>
                <option value="right">Derecha</option>
                <option value="left">Izquierda</option>
              </Select>
            </div>
          </div>
          <div>
            <Label>Recuadros con mensaje ({callouts.length}/5)</Label>
            <div className="grid gap-2">
              {callouts.map((c, i) => (
                <div key={i} className={`flex flex-wrap items-center gap-2 rounded-xl border p-2 ${i === active ? 'border-primary' : 'border-gray-medium dark:border-white/10'}`}>
                  <button type="button" onClick={() => setActive(i)} aria-label={`Elegir el recuadro ${i + 1}`} className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold text-white ${i === active ? 'brand-gradient' : 'bg-ink/70'}`}>
                    {i + 1}
                  </button>
                  <Input className="min-w-[10rem] flex-1" value={c.text} maxLength={60} placeholder="Qué explica este punto" aria-label={`Texto del recuadro ${i + 1}`} onFocus={() => setActive(i)} onChange={(e) => setCallout(i, { text: e.target.value })} />
                  <Input className="w-16" inputMode="numeric" value={c.x} aria-label="Posición horizontal (%)" onChange={(e) => setCallout(i, { x: pct(e.target.value) })} />
                  <Input className="w-16" inputMode="numeric" value={c.y} aria-label="Posición vertical (%)" onChange={(e) => setCallout(i, { y: pct(e.target.value) })} />
                  <Button size="sm" variant="ghost" aria-label={`Quitar el recuadro ${i + 1}`} onClick={() => { onChange({ ...scene, callouts: callouts.filter((_, j) => j !== i) }); setActive(0); }}>
                    <Trash2 size={14} />
                  </Button>
                </div>
              ))}
            </div>
            {callouts.length < 5 && (
              <Button className="mt-2" size="sm" variant="soft" onClick={() => { onChange({ ...scene, callouts: [...callouts, { x: 50, y: 50, text: '' }] }); setActive(callouts.length); }}>
                <Plus size={14} /> Añadir recuadro
              </Button>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

function Editor({ api, video, data, onSaved, onClose }: { api: Api; video: StudioVideo; data: StudioResponse; onSaved: (items: StudioVideo[]) => void; onClose: () => void }) {
  const toast = useToast();
  const [title, setTitle] = useState(video.title);
  const [spec, setSpec] = useState<VideoSpec>(() => clone(video.spec));
  const [saving, setSaving] = useState(false);
  const project = spec.brand.logo.split('/')[1];
  const assets = data.assets.filter((a) => a.project === project && !a.path.includes('/marca/') && !a.path.includes('/mascota/')).map((a) => a.path);
  const setScene = (i: number, s: Scene) => setSpec({ ...spec, scenes: spec.scenes.map((x, j) => (j === i ? s : x)) });

  async function save() {
    setSaving(true);
    try {
      const res = await api.put<{ items: StudioVideo[] }>(`${BASE}/${video.id}`, { title, spec });
      onSaved(res.items);
      toast.success('Guardado. Genera el video para ver los cambios.');
      onClose();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mb-8 grid gap-4">
      <Card className="p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="vs-title">Nombre del video</Label>
            <Input id="vs-title" value={title} maxLength={90} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="vs-format">Formato</Label>
            <Select id="vs-format" value={spec.format} onChange={(e) => setSpec({ ...spec, format: e.target.value as VideoSpec['format'] })}>
              <option value="9x16">Vertical 9:16 (reels, historias)</option>
              <option value="16x9">Horizontal 16:9 (YouTube, web)</option>
              <option value="1x1">Cuadrado 1:1 (feed)</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="vs-it">Título de la intro</Label>
            <Input id="vs-it" value={spec.intro.title} maxLength={50} onChange={(e) => setSpec({ ...spec, intro: { ...spec.intro, title: e.target.value } })} />
          </div>
          <div>
            <Label htmlFor="vs-is">Subtítulo de la intro</Label>
            <Input id="vs-is" value={spec.intro.sub ?? ''} maxLength={90} onChange={(e) => setSpec({ ...spec, intro: { ...spec.intro, sub: e.target.value } })} />
          </div>
          <div>
            <Label htmlFor="vs-ot">Título del cierre</Label>
            <Input id="vs-ot" value={spec.outro.title} maxLength={60} onChange={(e) => setSpec({ ...spec, outro: { ...spec.outro, title: e.target.value } })} />
          </div>
          <div>
            <Label htmlFor="vs-oc">Llamado a la acción</Label>
            <Input id="vs-oc" value={spec.outro.cta} maxLength={60} onChange={(e) => setSpec({ ...spec, outro: { ...spec.outro, cta: e.target.value } })} />
          </div>
        </div>
      </Card>
      {spec.scenes.map((s, i) => (
        <SceneEditor key={i} api={api} scene={s} index={i} assets={assets} onChange={(n) => setScene(i, n)} onRemove={() => setSpec({ ...spec, scenes: spec.scenes.filter((_, j) => j !== i) })} />
      ))}
      <div className="flex flex-wrap gap-2">
        {spec.scenes.length < 10 && assets[0] && (
          <Button variant="soft" onClick={() => setSpec({ ...spec, scenes: [...spec.scenes, { image: assets[0], title: 'Nueva escena', callouts: [], mascot: { pose: 'wave', side: 'right' } }] })}>
            <Plus size={15} /> Añadir escena
          </Button>
        )}
        <Button onClick={save} loading={saving} disabled={spec.scenes.length === 0}>
          Guardar cambios
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

function VideoCard({ api, video, available, onItems, onEdit, onReload }: { api: Api; video: StudioVideo; available: boolean; onItems: (i: StudioVideo[]) => void; onEdit: () => void; onReload: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [src, setSrc] = useState('');
  useEffect(() => {
    if (video.status === 'approved') return void setSrc(video.url);
    if (video.status !== 'review') return void setSrc('');
    let url = '';
    let alive = true;
    api.fileUrl(`${BASE}/${video.id}/file`).then((u) => {
      url = u;
      if (alive) setSrc(u);
    }).catch(() => undefined);
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [api, video.id, video.status, video.url]);

  async function run(fn: () => Promise<{ items: StudioVideo[] } | void>, ok?: string) {
    setBusy(true);
    try {
      const res = await fn();
      if (res) onItems(res.items);
      if (ok) toast.success(ok);
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  }
  const vertical = video.spec.format === '9x16';

  return (
    <Card className="p-4">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <h3 className="font-display text-base font-extrabold text-ink dark:text-white">{video.title}</h3>
          <p className="text-xs text-gray-dark">
            {video.spec.format.replace('x', ':')} · {video.spec.scenes.length} escenas · {video.spec.scenes.reduce((n, s) => n + (s.callouts?.length ?? 0), 0)} recuadros
          </p>
        </div>
        <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold text-primary-dark dark:bg-primary/15 dark:text-white">{STATUS[video.status]}</span>
      </div>
      {video.status === 'rendering' && <p className="my-3 text-sm text-gray-dark">{video.detail || 'Generando…'} Tarda unos minutos; puedes seguir usando el panel.</p>}
      {video.detail && video.status !== 'rendering' && <p className={`my-2 text-sm ${video.status === 'error' ? 'text-error' : 'text-gray-dark'}`}>{video.detail}</p>}
      {src && <video className={`my-3 w-full rounded-xl bg-black ${vertical ? 'max-h-[28rem] object-contain' : ''}`} src={src} controls playsInline preload="metadata" />}
      <div className="flex flex-wrap gap-2">
        {video.status === 'review' && (
          <>
            <Button size="sm" loading={busy} onClick={() => run(() => api.post(`${BASE}/${video.id}/review`, { approve: true }), 'Aprobado: se guardó en DigitalOcean y se liberó el espacio del servidor.')}>
              👍 Aprobar
            </Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(() => api.post(`${BASE}/${video.id}/review`, { approve: false }))}>
              👎 Descartar
            </Button>
          </>
        )}
        {video.status === 'approved' && src && (
          <a href={src} download={`${video.title}.mp4`} target="_blank" rel="noreferrer" className="inline-flex items-center rounded-lg bg-secondary px-3 py-1.5 text-xs font-semibold text-primary-dark hover:bg-primary/15 dark:bg-primary/15 dark:text-white">
            Descargar
          </a>
        )}
        {(video.status === 'draft' || video.status === 'error' || video.status === 'review') && (
          <>
            <Button size="sm" variant="soft" disabled={busy} onClick={onEdit}>
              Editar
            </Button>
            <Button size="sm" variant="secondary" loading={busy} disabled={!available} onClick={() => run(async () => { const r = await api.post<{ items: StudioVideo[] }>(`${BASE}/${video.id}/render`); onReload(); return r; }, 'Se puso a generar.')}>
              {video.status === 'review' ? 'Generar de nuevo' : 'Generar video'}
            </Button>
          </>
        )}
        {video.status !== 'rendering' && (
          <Button size="sm" variant="ghost" disabled={busy} aria-label="Eliminar el video" onClick={() => run(async () => { await api.del(`${BASE}/${video.id}`); onReload(); }, 'Eliminado.')}>
            <Trash2 size={14} />
          </Button>
        )}
      </div>
    </Card>
  );
}

/**
 * Remotion videos with message callouts and the full-body mascot. The admin edits the JSON spec
 * (scenes, callouts, mascot pose) here; the server's taller renders it and, once approved, the
 * file goes to DigitalOcean Spaces and leaves the server's disk.
 */
export function VideoStudio({ api }: { api: Api }) {
  const toast = useToast();
  const [data, setData] = useState<StudioResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      const res = await api.get<StudioResponse>(BASE);
      setData(res);
      window.clearTimeout(timer.current);
      if (res.items.some((i) => i.status === 'rendering')) timer.current = window.setTimeout(() => void load(), 5000);
    } catch (err) {
      setError(errMsg(err));
    }
  }, [api]);
  useEffect(() => {
    void load();
    return () => window.clearTimeout(timer.current);
  }, [load]);

  const setItems = (items: StudioVideo[]) => {
    setData((d) => (d ? { ...d, items } : d));
    if (items.some((i) => i.status === 'rendering')) void load();
  };

  async function create() {
    try {
      const res = await api.post<{ items: StudioVideo[] }>(BASE, { title: '', spec: data?.template });
      setItems(res.items);
      setEditing(res.items[0]?.id ?? null);
    } catch (err) {
      toast.error(errMsg(err));
    }
  }

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!data) return <Skeleton className="h-64" />;
  const current = data.items.find((i) => i.id === editing);

  return (
    <>
      {!data.available && <Notice tone="warning">El taller de video no está instalado en este servidor (falta VIDEO_TALLER_DIR). Puedes preparar los guiones, pero no generarlos aquí.</Notice>}
      <p className="mb-4 text-sm text-gray-dark">Videos con recuadros que explican cada parte y la mascota de cuerpo completo. Editas los textos y dónde apunta cada recuadro, generas el video y lo apruebas: al aprobarlo se guarda en DigitalOcean y se borra del servidor.</p>
      {current ? (
        <Editor key={current.id} api={api} video={current} data={data} onSaved={setItems} onClose={() => setEditing(null)} />
      ) : (
        <>
          <Button className="mb-4" onClick={create}>
            <Plus size={15} /> Nuevo video desde la plantilla
          </Button>
          {data.items.length === 0 && <p className="text-sm text-gray-dark">Todavía no hay videos del taller. Crea uno desde la plantilla de Canix.</p>}
          <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
            {data.items.map((v) => (
              <VideoCard key={v.id} api={api} video={v} available={data.available} onItems={setItems} onEdit={() => setEditing(v.id)} onReload={() => void load()} />
            ))}
          </div>
        </>
      )}
    </>
  );
}
