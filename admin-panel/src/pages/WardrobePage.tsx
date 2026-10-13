import { useEffect, useMemo, useState } from 'react';
import { Heart, Trash2, Shirt, Pencil, HelpCircle, RefreshCw, CheckCircle2, UserCheck } from 'lucide-react';
import { useApi, errMsg, type Api } from '../lib/api.ts';
import type { GarmentCard, GarmentDetail, GarmentFieldValue, GarmentQuestionView, WardrobeReviewStatus, WardrobeTaxonomy } from '../lib/types.ts';
import { Page, Notice, Tabs } from '../components/ui/Page.tsx';
import { Card } from '../components/ui/Card.tsx';
import { Button } from '../components/ui/Button.tsx';
import { Badge } from '../components/ui/Badge.tsx';
import { EmptyState } from '../components/ui/EmptyState.tsx';
import { Modal } from '../components/ui/Modal.tsx';
import { Input, Label, Select, Textarea, Hint } from '../components/ui/Input.tsx';
import { useToast } from '../components/ui/Toast.tsx';

const PAGE = 60;
type Tab = 'wardrobe' | 'review';

const pretty = (value: string | null | undefined) => (value ? value.replace(/_/g, ' ') : '');

export function WardrobePage() {
  const api = useApi();
  // The link Canix sends over WhatsApp opens straight on the questions (#/wardrobe?tab=review).
  const [tab, setTab] = useState<Tab>(() => (window.location.hash.includes('tab=review') ? 'review' : 'wardrobe'));
  const [taxonomy, setTaxonomy] = useState<WardrobeTaxonomy | null>(null);
  const [status, setStatus] = useState<WardrobeReviewStatus | null>(null);
  const [review, setReview] = useState<GarmentDetail[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Bumped whenever a garment changes from the other tab, so the grid reloads.
  const [version, setVersion] = useState(0);

  async function loadReview() {
    try {
      const data = await api.get<{ status: WardrobeReviewStatus; garments: GarmentDetail[] }>('/api/garments/review');
      setStatus(data.status);
      setReview(data.garments);
    } catch (e) {
      setError(errMsg(e));
    }
  }
  useEffect(() => {
    api.get<WardrobeTaxonomy>('/api/garments/taxonomy').then(setTaxonomy).catch((e) => setError(errMsg(e)));
    loadReview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // While the background classification is going through the wardrobe, keep the numbers moving.
  useEffect(() => {
    if (!status?.pending) return;
    const timer = setInterval(loadReview, 20_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.pending]);

  return (
    <Page
      title="Mi armario"
      wide
      description="Para agregar prendas, mándale la foto a Canix por WhatsApp. Cada foto se clasifica sola; lo que no quede claro te lo pregunto aquí."
    >
      {error && <Notice tone="error">{error}</Notice>}
      <Tabs<Tab>
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'wardrobe', label: 'Armario', count: status?.total },
          { id: 'review', label: 'Por revisar', count: status?.main_garments ?? 0 },
        ]}
      />
      {tab === 'wardrobe' ? (
        <WardrobeGrid api={api} taxonomy={taxonomy} version={version} onChanged={loadReview} onError={setError} />
      ) : (
        <ReviewTab
          api={api}
          taxonomy={taxonomy}
          status={status}
          garments={review}
          onChanged={() => {
            setVersion((v) => v + 1);
            return loadReview();
          }}
          onError={setError}
        />
      )}
    </Page>
  );
}

// ---------------------------------------------------------------------------------------------
// Armario
// ---------------------------------------------------------------------------------------------

function WardrobeGrid({ api, taxonomy, version, onChanged, onError }: { api: Api; taxonomy: WardrobeTaxonomy | null; version: number; onChanged: () => void; onError: (e: string | null) => void }) {
  const [rows, setRows] = useState<GarmentCard[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [type, setType] = useState('');
  const [onlyFav, setOnlyFav] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);

  async function load(offset = 0) {
    try {
      const data = await api.get<{ total: number; rows: GarmentCard[] }>(`/api/garments?limit=${PAGE}&offset=${offset}${type ? `&type=${type}` : ''}`);
      setRows((prev) => (offset ? [...prev, ...data.rows] : data.rows));
      setTotal(data.total);
    } catch (e) {
      onError(errMsg(e));
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, version]);

  async function toggleFav(g: GarmentCard) {
    setRows(rows.map((r) => (r.id === g.id ? { ...r, favorite: !r.favorite } : r)));
    await api.put(`/api/garments/${g.id}/favorite`, { favorite: !g.favorite }).catch((e) => onError(errMsg(e)));
  }

  async function remove(g: GarmentCard) {
    if (!confirm('¿Borrar esta prenda de tu armario? No se puede deshacer.')) return;
    try {
      await api.del(`/api/garments/${g.id}`);
      setRows(rows.filter((r) => r.id !== g.id));
      setTotal((t) => (t ? t - 1 : t));
      onChanged();
    } catch (e) {
      onError(errMsg(e));
    }
  }

  const shown = onlyFav ? rows.filter((r) => r.favorite) : rows;
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <FilterChip active={!type} onClick={() => setType('')}>
          Todo
        </FilterChip>
        {taxonomy?.types.map((t) => (
          <FilterChip key={t.value} active={type === t.value} onClick={() => setType(t.value)}>
            {t.label}
          </FilterChip>
        ))}
        <span className="mx-1 hidden h-5 w-px bg-gray-medium sm:block dark:bg-white/10" />
        <FilterChip active={onlyFav} onClick={() => setOnlyFav(!onlyFav)}>
          <Heart size={13} fill={onlyFav ? 'currentColor' : 'none'} /> Favoritas
        </FilterChip>
      </div>

      {total === 0 && <EmptyState icon={<Shirt />} title={type ? 'No tienes prendas de este tipo' : 'Tu armario está vacío'} />}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {shown.map((g) => (
          <Card key={g.id} className="group overflow-hidden">
            <div className="relative aspect-square bg-gray-light dark:bg-white/5">
              <button className="block h-full w-full" onClick={() => setEditing(g.id)} aria-label="Ver y editar">
                <img src={g.image_url} alt={g.short_description ?? g.category_label} loading="lazy" className="h-full w-full object-cover" />
              </button>
              {g.needs_review && (
                <span className="absolute left-2 top-2">
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-500 px-2 py-0.5 text-[11px] font-semibold text-white shadow">
                    <HelpCircle size={12} /> Por revisar
                  </span>
                </span>
              )}
              <button
                onClick={() => toggleFav(g)}
                className={`absolute right-2 top-2 rounded-full bg-white/90 p-1.5 ${g.favorite ? 'text-error' : 'text-gray-dark'}`}
                aria-label="Favorita"
              >
                <Heart size={15} fill={g.favorite ? 'currentColor' : 'none'} />
              </button>
              <div className="absolute bottom-2 right-2 hidden gap-1.5 group-hover:flex">
                <button onClick={() => setEditing(g.id)} className="rounded-full bg-white/90 p-1.5 text-ink" aria-label="Editar">
                  <Pencil size={15} />
                </button>
                <button onClick={() => remove(g)} className="rounded-full bg-white/90 p-1.5 text-error" aria-label="Borrar">
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
            <div className="p-2.5">
              <p className="truncate text-sm font-medium text-ink dark:text-white">{g.category_label}</p>
              <p className="truncate text-xs text-gray-dark">{pretty(g.color) || 'sin color'}</p>
            </div>
          </Card>
        ))}
      </div>
      {total !== null && rows.length < total && (
        <div className="mt-5 text-center">
          <Button variant="secondary" onClick={() => load(rows.length)}>
            Cargar más ({rows.length}/{total})
          </Button>
        </div>
      )}

      {editing !== null && taxonomy && (
        <GarmentEditor
          api={api}
          taxonomy={taxonomy}
          garmentId={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
            onChanged();
          }}
        />
      )}
    </>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset transition-all ${
        active
          ? 'bg-primary text-white ring-primary'
          : 'bg-white text-gray-dark ring-gray-medium hover:text-ink hover:ring-primary/40 dark:bg-white/5 dark:ring-white/10 dark:hover:text-white'
      }`}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------------------------
// Editar una prenda
// ---------------------------------------------------------------------------------------------

function GarmentEditor({ api, taxonomy, garmentId, onClose, onSaved }: { api: Api; taxonomy: WardrobeTaxonomy; garmentId: number; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [garment, setGarment] = useState<GarmentDetail | null>(null);
  const [fields, setFields] = useState<Record<string, GarmentFieldValue>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<GarmentDetail>(`/api/garments/${garmentId}`)
      .then((g) => {
        setGarment(g);
        setFields(g.fields);
      })
      .catch((e) => setError(errMsg(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [garmentId]);

  const type = useMemo(() => taxonomy.types.find((t) => t.categories.some((c) => c.value === fields.category))?.value, [taxonomy, fields.category]);

  function change(key: string, value: GarmentFieldValue) {
    setFields((f) => ({ ...f, [key]: value }));
    setDirty((d) => new Set(d).add(key));
  }

  async function save() {
    if (dirty.size === 0) return onClose();
    setSaving(true);
    setError(null);
    try {
      // Only what was touched is sent: each of those becomes "dicho por ti" and is never re-guessed.
      await api.put(`/api/garments/${garmentId}`, { fields: Object.fromEntries([...dirty].map((k) => [k, fields[k]])) });
      toast.success('Prenda actualizada');
      onSaved();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Prenda" description={garment?.long_description ?? undefined} onClose={onClose} size="lg">
      {error && <Notice tone="error">{error}</Notice>}
      {garment && (
        <div className="grid gap-5 sm:grid-cols-[minmax(0,240px)_1fr]">
          <div>
            <a href={garment.full_image_url} target="_blank" rel="noreferrer">
              <img src={garment.full_image_url} alt={garment.category_label} className="w-full rounded-2xl object-cover" />
            </a>
            {garment.seen && (
              <p className="mt-3 rounded-xl bg-secondary/60 p-3 text-xs leading-relaxed text-gray-dark dark:bg-white/5">
                <span className="font-semibold text-ink dark:text-white">Lo que vi en la foto: </span>
                {garment.seen}
              </p>
            )}
            <p className="mt-2 text-xs text-gray-dark">
              {garment.classified_by === 'vision' ? 'Clasificada mirando la foto.' : garment.classified_by === 'local' ? 'Clasificada con el método anterior; está en cola para revisarse.' : 'Clasificada a mano.'}
            </p>
          </div>

          <div className="grid content-start gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label>Prenda {garment.by_user.includes('category') && <ByUser />}</Label>
              <Select value={(fields.category as string) ?? ''} onChange={(e) => change('category', e.target.value)}>
                {taxonomy.types.map((t) => (
                  <optgroup key={t.value} label={t.label}>
                    {t.categories.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
            </div>
            {taxonomy.fields
              .filter((f) => !f.only_types || !type || f.only_types.includes(type))
              .map((f) => (
                <div key={f.key} className={f.kind === 'many' || f.key === 'notes' ? 'sm:col-span-2' : ''}>
                  <Label>
                    {f.label} {garment.by_user.includes(f.key) && <ByUser />}
                  </Label>
                  {f.kind === 'one' && (
                    <Select value={(fields[f.key] as string) ?? ''} onChange={(e) => change(f.key, e.target.value || null)}>
                      <option value="">Sin definir</option>
                      {f.options.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                  )}
                  {f.kind === 'many' && (
                    <div className="flex flex-wrap gap-1.5">
                      {f.options.map((o) => {
                        const current = (fields[f.key] as string[] | null) ?? [];
                        const on = current.includes(o.value);
                        return (
                          <FilterChip key={o.value} active={on} onClick={() => change(f.key, on ? current.filter((v) => v !== o.value) : [...current, o.value])}>
                            {o.label}
                          </FilterChip>
                        );
                      })}
                    </div>
                  )}
                  {f.kind === 'text' &&
                    (f.key === 'notes' ? (
                      <Textarea rows={2} value={(fields[f.key] as string) ?? ''} onChange={(e) => change(f.key, e.target.value)} />
                    ) : (
                      <Input value={(fields[f.key] as string) ?? ''} onChange={(e) => change(f.key, e.target.value)} />
                    ))}
                </div>
              ))}
            <div className="sm:col-span-2">
              <Hint>Lo que cambies aquí queda como dicho por ti: ninguna revisión automática lo vuelve a tocar.</Hint>
              <div className="mt-3 flex justify-end gap-2">
                <Button variant="ghost" onClick={onClose}>
                  Cancelar
                </Button>
                <Button onClick={save} loading={saving}>
                  Guardar
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

function ByUser() {
  return (
    <span className="ml-1 inline-flex items-center gap-0.5 align-middle text-[11px] font-semibold text-emerald-600 dark:text-emerald-300">
      <UserCheck size={11} /> dicho por ti
    </span>
  );
}

// ---------------------------------------------------------------------------------------------
// Por revisar
// ---------------------------------------------------------------------------------------------

function ReviewTab({
  api,
  taxonomy,
  status,
  garments,
  onChanged,
  onError,
}: {
  api: Api;
  taxonomy: WardrobeTaxonomy | null;
  status: WardrobeReviewStatus | null;
  garments: GarmentDetail[];
  onChanged: () => Promise<void>;
  onError: (e: string | null) => void;
}) {
  const toast = useToast();
  const [showDetails, setShowDetails] = useState(false);
  const [requeueing, setRequeueing] = useState(false);

  async function reclassifyAll() {
    if (!confirm('¿Volver a revisar todas las fotos del armario? Lo que tú mismo hayas respondido o editado no se toca. Tarda unos minutos.')) return;
    setRequeueing(true);
    try {
      await api.post('/api/garments/reclassify');
      toast.success('Listo, voy revisando foto por foto');
      await onChanged();
    } catch (e) {
      onError(errMsg(e));
    } finally {
      setRequeueing(false);
    }
  }

  // Garments with something important to answer go first; the ones with only details are optional.
  const main = garments.filter((g) => g.questions.some((q) => q.main));
  const detailOnly = garments.filter((g) => !g.questions.some((q) => q.main));
  const details = (status?.open_questions ?? 0) - (status?.main_questions ?? 0);
  const done = status ? status.classified + status.unreadable : 0;
  const percent = status?.total ? Math.round((done / status.total) * 100) : 0;

  return (
    <>
      {status && (
        <Card className="mb-5 p-5">
          <div className="flex flex-wrap items-center gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-ink dark:text-white">
                {!status.enabled
                  ? 'La clasificación por foto no está activa en el servidor'
                  : status.pending > 0
                    ? `Revisando tu armario: ${status.classified} de ${status.total} prendas`
                    : `${status.classified} de ${status.total} prendas clasificadas mirando la foto`}
              </p>
              <p className="mt-0.5 text-xs text-gray-dark">
                {!status.enabled
                  ? 'Falta la llave FAL_KEY en el .env del servidor. Mientras tanto se usa el clasificador anterior.'
                  : status.pending > 0
                    ? `Faltan ${status.pending}. Va sola, en segundo plano; esta página se actualiza cada 20 segundos.`
                    : status.main_questions > 0
                      ? `Me faltan ${status.main_questions} respuesta(s) tuyas sobre qué prenda es o su color.`
                      : 'No tengo dudas importantes pendientes.'}
                {status.unreadable > 0 && ` ${status.unreadable} foto(s) no se pudieron leer.`}
              </p>
              {status.enabled && (
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-medium/60 dark:bg-white/10">
                  <div className="brand-gradient h-full rounded-full transition-all" style={{ width: `${percent}%` }} />
                </div>
              )}
            </div>
            {status.enabled && (
              <Button variant="secondary" size="sm" onClick={reclassifyAll} loading={requeueing} disabled={status.pending > 0}>
                <RefreshCw size={14} /> Revisar todo de nuevo
              </Button>
            )}
          </div>
        </Card>
      )}

      {main.length === 0 && (
        <EmptyState
          icon={<CheckCircle2 />}
          title={status?.pending ? 'Todavía no tengo preguntas' : 'Nada importante por revisar'}
          description={status?.pending ? 'A medida que revise las fotos, aquí aparece lo que no logre definir.' : 'Cuando una foto no me deje saber qué prenda es o de qué color, te lo pregunto aquí.'}
        />
      )}
      <div className="space-y-4">
        {main.map((g) => (
          <ReviewCard key={g.id} api={api} taxonomy={taxonomy} garment={g} onChanged={onChanged} onError={onError} />
        ))}
      </div>

      {detailOnly.length > 0 && (
        <div className="mt-8">
          <button onClick={() => setShowDetails(!showDetails)} className="text-sm font-semibold text-primary hover:underline">
            {showDetails ? 'Ocultar' : 'Ver'} detalles opcionales ({details} pregunta(s) en {detailOnly.length} prenda(s))
          </button>
          <p className="mt-1 text-xs text-gray-dark">Material, ajuste y cosas así que por foto no se pueden asegurar. Si no las respondes, queda lo que me pareció.</p>
          {showDetails && (
            <div className="mt-4 space-y-4">
              {detailOnly.map((g) => (
                <ReviewCard key={g.id} api={api} taxonomy={taxonomy} garment={g} onChanged={onChanged} onError={onError} />
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}

function ReviewCard({ api, taxonomy, garment, onChanged, onError }: { api: Api; taxonomy: WardrobeTaxonomy | null; garment: GarmentDetail; onChanged: () => Promise<void>; onError: (e: string | null) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState<number | null>(null);

  async function answer(q: GarmentQuestionView, value: string) {
    if (q.field === 'is_garment' && value === 'borrar' && !confirm('¿Borrar esta foto del armario? No se puede deshacer.')) return;
    setBusy(q.id);
    try {
      await api.post(`/api/garment-questions/${q.id}/answer`, { value });
      toast.success(value === 'borrar' ? 'Foto borrada' : 'Anotado, gracias');
      await onChanged();
    } catch (e) {
      onError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function skip(q: GarmentQuestionView) {
    setBusy(q.id);
    try {
      await api.post(`/api/garment-questions/${q.id}/skip`);
      await onChanged();
    } catch (e) {
      onError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="overflow-hidden">
      <div className="grid gap-0 sm:grid-cols-[220px_1fr]">
        <a href={garment.full_image_url} target="_blank" rel="noreferrer" className="block bg-gray-light dark:bg-white/5">
          <img src={garment.full_image_url} alt={garment.category_label} loading="lazy" className="h-full max-h-80 w-full object-cover sm:max-h-none" />
        </a>
        <div className="p-5">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-display text-base font-bold text-ink dark:text-white">
              {garment.category_label}
              {garment.color ? ` · ${pretty(garment.color)}` : ''}
            </p>
            <Badge tone="neutral">#{garment.id}</Badge>
          </div>
          {garment.seen && <p className="mt-1.5 text-sm leading-relaxed text-gray-dark">Lo que veo: {garment.seen}</p>}

          <div className="mt-4 space-y-4">
            {[...garment.questions].sort((a, b) => Number(b.main) - Number(a.main)).map((q) => (
              <div key={q.id} className="rounded-2xl border border-gray-medium/70 p-4 dark:border-white/10">
                <div className="mb-1.5 flex items-center gap-2">
                  <Badge tone={q.main ? 'warning' : 'info'}>{q.label}</Badge>
                </div>
                <p className="text-sm leading-relaxed text-ink dark:text-white">{q.question}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {q.options.map((o) => (
                    <Button key={o.value} size="sm" variant={o.value === q.suggested ? 'soft' : 'secondary'} disabled={busy === q.id} onClick={() => answer(q, o.value)}>
                      {o.label}
                    </Button>
                  ))}
                  <OtherOption taxonomy={taxonomy} question={q} disabled={busy === q.id} onPick={(value) => answer(q, value)} />
                  {q.field !== 'is_garment' && (
                    <Button size="sm" variant="ghost" disabled={busy === q.id} onClick={() => skip(q)}>
                      No sé, déjalo así
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

/** Every other allowed value of the question's field, for when none of the offered ones is right. */
function OtherOption({ taxonomy, question, disabled, onPick }: { taxonomy: WardrobeTaxonomy | null; question: GarmentQuestionView; disabled: boolean; onPick: (value: string) => void }) {
  if (!taxonomy || question.field === 'is_garment') return null;
  const offered = new Set(question.options.map((o) => o.value));
  const select = '!w-auto !py-1.5 !text-xs';

  if (question.field === 'category') {
    return (
      <Select className={select} value="" disabled={disabled} onChange={(e) => e.target.value && onPick(e.target.value)}>
        <option value="">Es otra prenda…</option>
        {taxonomy.types.map((t) => (
          <optgroup key={t.value} label={t.label}>
            {t.categories
              .filter((c) => !offered.has(c.value))
              .map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
          </optgroup>
        ))}
      </Select>
    );
  }
  const rest = (taxonomy.fields.find((f) => f.key === question.field)?.options ?? []).filter((o) => !offered.has(o.value));
  if (rest.length === 0) return null;
  return (
    <Select className={select} value="" disabled={disabled} onChange={(e) => e.target.value && onPick(e.target.value)}>
      <option value="">Otra opción…</option>
      {rest.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </Select>
  );
}
