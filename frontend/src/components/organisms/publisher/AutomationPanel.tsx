import { useCallback, useEffect, useState } from 'react';
import { Check, CalendarClock, Pencil, Play, Plus, SkipForward, Trash2 } from 'lucide-react';
import type { Api } from '../../../services/api.ts';
import { errMsg } from '../../../services/api.ts';
import type { AutomationOverview, AutomationRun, AutomationSchedule, PublisherPlatform, RunStatus } from '../../../types/publisher.ts';
import { Modal } from '../Modal.tsx';
import { Card } from '../../atoms/Card.tsx';
import { Button } from '../../atoms/Button.tsx';
import { Hint, Input, Label, Select, Textarea } from '../../atoms/Input.tsx';
import { Skeleton } from '../../atoms/Skeleton.tsx';
import { EmptyState } from '../../molecules/EmptyState.tsx';
import { Notice } from '../../molecules/Notice.tsx';
import { useToast } from '../../molecules/Toast.tsx';

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DAY_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const FORMATS = [
  { id: 'square', label: 'Cuadrada (feed)' },
  { id: 'portrait', label: 'Vertical (feed)' },
  { id: 'story', label: 'Historia / Reel' },
];
const LAYOUTS = [
  { id: 'hero', label: 'Foto con titular · IA' },
  { id: 'split', label: 'Mitad arte, mitad texto · IA' },
  { id: 'tip', label: 'Consejo con puntos · gratis' },
  { id: 'quote', label: 'Frase grande · gratis' },
];
const NETWORKS: { id: PublisherPlatform; name: string; video: boolean; image: boolean }[] = [
  { id: 'instagram', name: 'Instagram', video: true, image: true },
  { id: 'facebook', name: 'Facebook', video: true, image: true },
  { id: 'youtube', name: 'YouTube', video: true, image: false },
  { id: 'tiktok', name: 'TikTok', video: true, image: false },
];
const RUN: Record<RunStatus, { label: string; tone: string }> = {
  generating: { label: 'Creándose', tone: 'bg-primary/10 text-primary-dark dark:text-white' },
  awaiting: { label: 'Por aprobar', tone: 'bg-warning/10 text-warning' },
  scheduled: { label: 'Programada', tone: 'bg-primary/10 text-primary-dark dark:text-white' },
  published: { label: 'Publicada', tone: 'bg-success/10 text-success' },
  partial: { label: 'Parcial', tone: 'bg-warning/10 text-warning' },
  failed: { label: 'Falló', tone: 'bg-error/10 text-error' },
  skipped: { label: 'Omitida', tone: 'bg-gray-medium text-gray-dark dark:bg-white/10' },
};

const chip = (on: boolean) =>
  `rounded-full border px-3.5 py-1.5 text-sm font-semibold transition-all ${on ? 'border-primary bg-primary/10 text-primary-dark dark:text-white' : 'border-gray-medium bg-white text-ink hover:border-primary/40 dark:border-white/10 dark:bg-white/5 dark:text-white'}`;

const hour = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'a. m.' : 'p. m.'}`;
};
const daysText = (days: number[]) => (days.length === 7 ? 'Todos los días' : DAY_ORDER.filter((d) => days.includes(d)).map((d) => DAY_SHORT[d]).join(', '));
const when = (iso: string | null, tz: string) => (iso ? new Date(iso).toLocaleString('es-CO', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '');

/** Automation: rules that make, write and schedule the content by themselves. */
export function AutomationPanel({ api, onChanged }: { api: Api; onChanged: () => void }) {
  const toast = useToast();
  const [data, setData] = useState<AutomationOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AutomationSchedule | 'new' | null>(null);
  const [asking, setAsking] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.get<AutomationOverview>('/api/admin/publisher/automation'));
      setError(null);
    } catch (err) {
      setError(errMsg(err));
    }
  }, [api]);
  useEffect(() => {
    void load();
  }, [load]);
  const open = data?.runs.some((r) => r.status === 'generating');
  useEffect(() => {
    if (!open) return;
    const t = window.setInterval(() => void load(), 6000);
    return () => window.clearInterval(t);
  }, [open, load]);

  async function act(key: string, fn: () => Promise<unknown>, ok?: string) {
    setBusy(key);
    try {
      await fn();
      if (ok) toast.success(ok);
      await load();
      onChanged();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(null);
      setAsking(null);
    }
  }

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!data) return <Skeleton className="h-64" />;
  const tz = data.timezone;
  const awaiting = data.runs.filter((r) => r.status === 'awaiting');
  const history = data.runs.filter((r) => r.status !== 'awaiting');

  return (
    <div className="space-y-6">
      <Notice tone="info">
        Define cuándo salen tus publicaciones y el estudio las hace solo: crea la pieza unas horas antes, escribe el SEO y te avisa por WhatsApp. Las horas son de <strong>{tz}</strong>. Si se acaba el tope del mes, usa los diseños gratis para no parar.
      </Notice>

      {awaiting.length > 0 && (
        <section>
          <h2 className="mb-3 font-display text-xl font-extrabold text-ink dark:text-white">
            Por aprobar <span className="text-gray-dark">({awaiting.length})</span>
          </h2>
          <div className="grid items-start gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {awaiting.map((r) => (
              <RunCard key={r.id} run={r} tz={tz}>
                <Button size="sm" loading={busy === `a${r.id}`} onClick={() => act(`a${r.id}`, () => api.post(`/api/admin/publisher/automation/runs/${r.id}/approve`), 'Listo: quedó programada.')}>
                  <Check size={13} /> Aprobar y programar
                </Button>
                <Button size="sm" variant="ghost" loading={busy === `s${r.id}`} onClick={() => act(`s${r.id}`, () => api.post(`/api/admin/publisher/automation/runs/${r.id}/skip`), 'Omitida.')}>
                  <SkipForward size={13} /> Omitir
                </Button>
              </RunCard>
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-xl font-extrabold text-ink dark:text-white">Programaciones</h2>
          <Button size="sm" onClick={() => setEditing('new')}>
            <Plus size={14} /> Nueva programación
          </Button>
        </div>
        {data.schedules.length === 0 ? (
          <EmptyState sticker="idea" title="Todavía no hay programaciones" description="Crea una para que, por ejemplo, cada lunes y jueves salga un consejo en Instagram y Facebook sin que tengas que hacer nada." />
        ) : (
          <div className="grid items-start gap-4 md:grid-cols-2">
            {data.schedules.map((s) => (
              <Card key={s.id} className={`p-5 ${s.enabled ? '' : 'opacity-70'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-display text-lg font-extrabold text-ink dark:text-white">{s.name}</p>
                    <p className="text-sm text-gray-dark">
                      {daysText(s.days)} · {hour(s.time)}
                    </p>
                  </div>
                  <label className="flex shrink-0 cursor-pointer items-center gap-2 text-xs font-semibold text-gray-dark">
                    <input type="checkbox" className="h-4 w-4 accent-[var(--color-primary)]" checked={s.enabled} onChange={(e) => void act(`e${s.id}`, () => api.post(`/api/admin/publisher/automation/schedules/${s.id}/enabled`, { enabled: e.target.checked }))} />
                    Activa
                  </label>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
                  <span className="rounded-full bg-secondary px-2.5 py-0.5 font-semibold text-primary-dark dark:bg-primary/15 dark:text-white">{s.media === 'video' ? '🎬 Video vertical' : `🖼️ ${FORMATS.find((f) => f.id === s.format)?.label ?? s.format}`}</span>
                  {s.platforms.map((p) => (
                    <span key={p} className="rounded-full bg-gray-medium px-2.5 py-0.5 font-semibold text-ink dark:bg-white/10 dark:text-white">
                      {NETWORKS.find((n) => n.id === p)?.name}
                    </span>
                  ))}
                  <span className="rounded-full bg-gray-medium px-2.5 py-0.5 font-semibold text-ink dark:bg-white/10 dark:text-white">{s.mode === 'auto' ? '⚡ Automática' : '✋ Con tu aprobación'}</span>
                </div>
                {s.missing.length > 0 && <p className="mt-2 text-xs text-error">Sin conectar: {s.missing.join(', ')}. Conéctalas en «Cuentas» o esa red se omitirá.</p>}
                {s.enabled && s.nextAt && <p className="mt-2 text-xs text-gray-dark">Próxima: {when(s.nextAt, tz)}</p>}
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button size="sm" variant="soft" loading={busy === `r${s.id}`} onClick={() => act(`r${s.id}`, () => api.post(`/api/admin/publisher/automation/schedules/${s.id}/run-now`), 'Listo: se está preparando la próxima. Aparece arriba en unos segundos.')}>
                    <Play size={13} /> Preparar ahora
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setEditing(s)}>
                    <Pencil size={13} /> Editar
                  </Button>
                  {asking === s.id ? (
                    <span className="ml-auto flex items-center gap-1.5 text-xs">
                      ¿Borrar?
                      <Button size="sm" variant="danger" loading={busy === `d${s.id}`} onClick={() => act(`d${s.id}`, () => api.del(`/api/admin/publisher/automation/schedules/${s.id}`), 'Borrada.')}>
                        Sí
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setAsking(null)}>
                        No
                      </Button>
                    </span>
                  ) : (
                    <Button size="sm" variant="ghost" className="ml-auto" aria-label="Borrar" onClick={() => setAsking(s.id)}>
                      <Trash2 size={13} />
                    </Button>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      {history.length > 0 && (
        <section>
          <h2 className="mb-3 font-display text-xl font-extrabold text-ink dark:text-white">Historial</h2>
          <div className="grid items-start gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {history.slice(0, 12).map((r) => (
              <RunCard key={r.id} run={r} tz={tz} />
            ))}
          </div>
        </section>
      )}

      {editing && <ScheduleForm api={api} schedule={editing === 'new' ? null : editing} timezone={tz} onClose={() => setEditing(null)} onSaved={() => (void load(), onChanged())} />}
    </div>
  );
}

function RunCard({ run: r, tz, children }: { run: AutomationRun; tz: string; children?: React.ReactNode }) {
  const st = RUN[r.status];
  return (
    <Card className="overflow-hidden">
      <div className="flex gap-3 p-4">
        {r.preview ? <img src={r.preview} alt="" className="h-24 w-24 shrink-0 rounded-xl bg-gray-medium/40 object-cover dark:bg-white/5" /> : <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-xl bg-gray-medium/40 text-gray-dark dark:bg-white/5">{r.media === 'video' ? '🎬' : '🖼️'}</div>}
        <div className="min-w-0 flex-1">
          <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${st.tone}`}>{st.label}</span>
          <p className="mt-1 line-clamp-2 font-display font-extrabold text-ink dark:text-white">{r.title || r.scheduleName}</p>
          <p className="text-xs text-gray-dark">
            {r.scheduleName} · {when(r.publishAt, tz)}
          </p>
          {r.detail && <p className="mt-1 text-xs text-error">{r.detail}</p>}
        </div>
      </div>
      {children && <div className="flex flex-wrap gap-2 border-t border-gray-medium px-4 py-3 dark:border-white/10">{children}</div>}
    </Card>
  );
}

function ScheduleForm({ api, schedule: s, timezone, onClose, onSaved }: { api: Api; schedule: AutomationSchedule | null; timezone: string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(s?.name ?? '');
  const [media, setMedia] = useState<'image' | 'video'>(s?.media ?? 'image');
  const [format, setFormat] = useState(s?.format ?? 'square');
  const [layouts, setLayouts] = useState<string[]>(s?.layouts ?? []);
  const [topics, setTopics] = useState((s?.topics ?? []).join('\n'));
  const [platforms, setPlatforms] = useState<PublisherPlatform[]>(s?.platforms ?? ['instagram', 'facebook']);
  const [days, setDays] = useState<number[]>(s?.days ?? [1, 4]);
  const [time, setTime] = useState(s?.time ?? '09:00');
  const [leadHours, setLeadHours] = useState(s?.leadHours ?? 8);
  const [mode, setMode] = useState<'approve' | 'auto'>(s?.mode ?? 'approve');
  const [busy, setBusy] = useState(false);

  const allowed = NETWORKS.filter((n) => (media === 'video' ? n.video : n.image));
  const shownPlatforms = platforms.filter((p) => allowed.some((n) => n.id === p));
  const toggle = <T,>(list: T[], set: (v: T[]) => void, v: T) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  async function save() {
    setBusy(true);
    try {
      const body = { name, media, format, layouts, topics: topics.split('\n').map((t) => t.trim()).filter(Boolean), platforms: shownPlatforms, days, time, leadHours, mode };
      if (s) await api.put(`/api/admin/publisher/automation/schedules/${s.id}`, body);
      else await api.post('/api/admin/publisher/automation/schedules', body);
      toast.success('Listo: la programación quedó guardada.');
      onSaved();
      onClose();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={s ? 'Editar programación' : 'Nueva programación'} description={`Las horas son de ${timezone}.`} onClose={onClose} size="lg">
      <div className="space-y-5">
        <div>
          <Label htmlFor="au-name">Nombre</Label>
          <Input id="au-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Consejo de la semana" />
        </div>

        <div>
          <Label>¿Qué se publica?</Label>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={chip(media === 'image')} onClick={() => setMedia('image')}>
              🖼️ Imagen (estudio)
            </button>
            <button type="button" className={chip(media === 'video')} onClick={() => setMedia('video')}>
              🎬 Video (publicidad)
            </button>
          </div>
        </div>

        {media === 'image' && (
          <>
            <div>
              <Label htmlFor="au-format">Formato</Label>
              <Select id="au-format" value={format} onChange={(e) => setFormat(e.target.value)}>
                {FORMATS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Diseños que se turnan</Label>
              <div className="flex flex-wrap gap-2">
                {LAYOUTS.map((l) => (
                  <button key={l.id} type="button" className={chip(layouts.includes(l.id))} onClick={() => toggle(layouts, setLayouts, l.id)}>
                    {l.label}
                  </button>
                ))}
              </div>
              <Hint>Si no eliges ninguno, se turnan todos. Los «gratis» no gastan IA de imagen.</Hint>
            </div>
          </>
        )}

        <div>
          <Label htmlFor="au-topics">Temas (uno por línea, opcional)</Label>
          <Textarea id="au-topics" rows={3} value={topics} onChange={(e) => setTopics(e.target.value)} placeholder={'Cómo organizar tu semana\nErrores al atender clientes por WhatsApp\nAutomatiza tus recordatorios'} />
          <Hint>Se turnan en orden. Sin temas, la IA elige un ángulo nuevo cada vez a partir de las palabras clave de tu marca.</Hint>
        </div>

        <div>
          <Label>Redes</Label>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {allowed.map((n) => (
              <label key={n.id} className="inline-flex cursor-pointer items-center gap-2 text-sm text-ink dark:text-white/85">
                <input type="checkbox" className="h-4 w-4 accent-[var(--color-primary)]" checked={platforms.includes(n.id)} onChange={() => toggle(platforms, setPlatforms, n.id)} /> {n.name}
              </label>
            ))}
          </div>
          {media === 'image' && <Hint>YouTube y TikTok solo reciben videos.</Hint>}
        </div>

        <div>
          <Label>Días</Label>
          <div className="mb-2 flex flex-wrap gap-2">
            {DAY_ORDER.map((d) => (
              <button key={d} type="button" className={`${chip(days.includes(d))} min-w-12`} onClick={() => toggle(days, setDays, d)}>
                {DAY_SHORT[d]}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <button type="button" className="font-semibold text-primary-dark underline dark:text-white" onClick={() => setDays([0, 1, 2, 3, 4, 5, 6])}>
              Todos los días
            </button>
            <button type="button" className="font-semibold text-primary-dark underline dark:text-white" onClick={() => setDays([1, 3, 5])}>
              Lun · Mié · Vie
            </button>
            <button type="button" className="font-semibold text-primary-dark underline dark:text-white" onClick={() => setDays([1])}>
              Una vez por semana
            </button>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="au-time">Hora de publicación</Label>
            <Input id="au-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="au-lead">Prepararla con</Label>
            <Select id="au-lead" value={String(leadHours)} onChange={(e) => setLeadHours(Number(e.target.value))}>
              {[4, 8, 12, 24, 48].map((h) => (
                <option key={h} value={h}>
                  {h} horas de anticipación
                </option>
              ))}
            </Select>
            <Hint>{media === 'video' ? 'Los videos tardan varios minutos: dale al menos 8 horas.' : 'Te da tiempo de revisarla antes de que salga.'}</Hint>
          </div>
        </div>

        <div>
          <Label>¿Quién da el visto bueno?</Label>
          <div className="grid gap-2.5 sm:grid-cols-2">
            <button type="button" onClick={() => setMode('approve')} className={`rounded-2xl border-2 p-3.5 text-left transition-all ${mode === 'approve' ? 'border-primary bg-primary/5' : 'border-gray-medium dark:border-white/10'}`}>
              <p className="font-display font-extrabold text-ink dark:text-white">✋ Yo la apruebo</p>
              <p className="mt-0.5 text-xs text-gray-dark">Te avisa por WhatsApp y sale cuando la apruebes. Recomendado al empezar.</p>
            </button>
            <button type="button" onClick={() => setMode('auto')} className={`rounded-2xl border-2 p-3.5 text-left transition-all ${mode === 'auto' ? 'border-primary bg-primary/5' : 'border-gray-medium dark:border-white/10'}`}>
              <p className="font-display font-extrabold text-ink dark:text-white">⚡ Automática</p>
              <p className="mt-0.5 text-xs text-gray-dark">Se crea, se programa y sale sola. Te avisa cuando la programa y cuando sale.</p>
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <Button onClick={save} loading={busy}>
            <CalendarClock size={16} /> Guardar programación
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
        </div>
      </div>
    </Modal>
  );
}
