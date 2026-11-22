import { useState } from 'react';
import { Check, Copy, Download, History, RefreshCw, Trash2, Wand2, X } from 'lucide-react';
import type { Api } from '../../../services/api.ts';
import { errMsg } from '../../../services/api.ts';
import type { PromoItem } from '../../../types/promo.ts';
import { Card } from '../../atoms/Card.tsx';
import { Badge, type Tone } from '../../atoms/Badge.tsx';
import { Button } from '../../atoms/Button.tsx';
import { Input, Label, Select, Textarea } from '../../atoms/Input.tsx';
import { StagePreview } from './StagePreview.tsx';
import { useToast } from '../../molecules/Toast.tsx';

const KIND: Record<string, string> = { ad: '📣 Anuncio', howto: '🧭 Cómo funciona', feature: '⭐ Función' };
const FORMAT: Record<string, string> = { vertical: '📱 Vertical', landscape: '🖥️ Horizontal', square: '⬛ Cuadrado', story: '📱 Historia' };
const LAYOUT: Record<string, string> = { chat: 'con chat', features: 'con beneficios', mascot: 'con la mascota' };
const STATUS: Record<string, [string, Tone]> = {
  pending: ['En cola', 'neutral'],
  working: ['Creando…', 'info'],
  review: ['Por revisar', 'warning'],
  approved: ['Aprobado', 'success'],
  rejected: ['Descartado', 'neutral'],
  error: ['Con error', 'error'],
};

/** One video or image: preview by format, review, texts to post, downloads and (images) text corrections. */
export function PromoCard({ api, item, voices, defaultVoice, onChange }: { api: Api; item: PromoItem; voices: { key: string; name: string; gender: string; style: string }[]; defaultVoice: string; onChange: () => void }) {
  const toast = useToast();
  const formats = item.formats.filter((f) => item.files[f]);
  const [fmt, setFmt] = useState(formats[0]);
  const [title, setTitle] = useState(item.title);
  const [caption, setCaption] = useState(item.caption);
  const [copy, setCopy] = useState({ headline: item.content.headline ?? '', sub: item.content.sub ?? '', cta: item.content.cta ?? '', bullets: item.content.bullets ?? [] });
  const [scenes, setScenes] = useState(() => (item.content.scenes ?? []).map((s) => ({ text: s.text, say: s.say })));
  const [ask, setAsk] = useState('');
  const [showPrev, setShowPrev] = useState(false);
  const [askDelete, setAskDelete] = useState(false);
  const [sound, setSound] = useState(true);
  const [voiceKey, setVoiceKey] = useState(item.voice ?? defaultVoice);
  const [live, setLive] = useState<{ text: string; say: string }[] | null>(null);
  const prevFile = fmt ? item.prev?.[fmt] : undefined;
  const qa = item.content.qa ?? [];
  const busy = item.status === 'pending' || item.status === 'working';
  const file = fmt ? item.files[fmt] : undefined;
  const [label, tone] = STATUS[item.status];

  async function run(fn: () => Promise<unknown>, ok?: string) {
    try {
      await fn();
      if (ok) toast.success(ok);
      onChange();
    } catch (err) {
      toast.error(errMsg(err));
    }
  }
  const saveTexts = () => api.put(`/api/admin/promo/${item.id}`, { title, caption });
  const review = (approve: boolean) =>
    run(async () => {
      await saveTexts();
      await api.post(`/api/admin/promo/${item.id}/review`, { approve });
    }, approve ? 'Aprobado: ya puedes descargarlo y publicarlo.' : 'Descartado.');

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-display font-extrabold text-ink dark:text-white">
          {KIND[item.kind]}
          {item.featureName && <span className="font-semibold text-gray-dark"> · {item.featureName}</span>}
          {item.layout && <span className="font-semibold text-gray-dark"> · {LAYOUT[item.layout]}</span>}
        </p>
        <Badge tone={tone}>{label}</Badge>
      </div>
      <p className="-mt-2 text-xs text-gray-dark">{new Date(item.createdAt).toLocaleString('es-CO')}</p>

      {busy && (
        <p className="flex items-center gap-2 text-sm text-gray-dark">
          <RefreshCw size={14} className="animate-spin" /> {item.detail || 'En cola'}
        </p>
      )}
      {item.status === 'error' && <p className="rounded-xl bg-error/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">⚠️ {item.detail}</p>}

      {file && !busy && (
        <>
          {formats.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {formats.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFmt(f)}
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${fmt === f ? 'bg-primary/10 text-primary-dark dark:text-white' : 'text-gray-dark hover:bg-gray-medium/60'}`}
                >
                  {FORMAT[f]}
                </button>
              ))}
            </div>
          )}
          <div className="overflow-hidden rounded-xl bg-[#0b0e24]">
            {item.media === 'video' ? (
              <video key={file.url} className={`mx-auto block ${fmt === 'vertical' ? 'max-h-[560px]' : 'w-full'}`} src={file.url} poster={file.poster} controls preload="metadata" playsInline />
            ) : (
              <a href={file.url} target="_blank" rel="noopener">
                <img src={file.url} alt={item.content.headline ?? item.title} className={`mx-auto block ${fmt === 'story' ? 'max-h-[560px]' : 'w-full'}`} />
              </a>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {item.status !== 'approved' && (
              <Button size="sm" onClick={() => review(true)}>
                <Check size={14} /> Aprobar
              </Button>
            )}
            {item.status !== 'rejected' && (
              <Button size="sm" variant="secondary" onClick={() => review(false)}>
                <X size={14} /> Descartar
              </Button>
            )}
            {formats.map((f) => (
              <a
                key={f}
                href={item.files[f].url}
                download={`canix-${item.kind}-${f}.${item.media === 'video' ? 'mp4' : 'jpg'}`}
                target="_blank"
                rel="noopener"
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-gray-dark hover:bg-gray-medium/60 hover:text-ink dark:hover:bg-white/10 dark:hover:text-white"
              >
                <Download size={14} /> {FORMAT[f]}
              </a>
            ))}
          </div>

          <div>
            <Label htmlFor={`t-${item.id}`}>Título</Label>
            <Input id={`t-${item.id}`} maxLength={90} value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <Label htmlFor={`c-${item.id}`}>Texto para publicar</Label>
            <Textarea id={`c-${item.id}`} rows={3} maxLength={400} value={caption} onChange={(e) => setCaption(e.target.value)} />
            <div className="mt-1.5 flex flex-wrap gap-2">
              <Button size="sm" variant="ghost" onClick={() => navigator.clipboard.writeText(caption).then(() => toast.success('Texto copiado.'), () => undefined)}>
                <Copy size={14} /> Copiar texto
              </Button>
              <Button size="sm" variant="ghost" onClick={() => run(saveTexts, 'Guardado.')}>
                Guardar
              </Button>
            </div>
          </div>

          {item.media === 'video' && qa.length > 0 && (
            <ul className="space-y-1 rounded-xl bg-warning/10 px-3 py-2 text-xs text-gray-dark">
              {qa.map((q, i) => (
                <li key={i}>
                  {q.level === 'error' ? '⛔' : '⚠️'} {q.msg}
                </li>
              ))}
            </ul>
          )}

          {item.media === 'video' && item.content.scenes && (
            <details className="text-sm">
              <summary className="cursor-pointer font-semibold text-ink dark:text-white">✏️ Corregir el guion y volver a grabar</summary>
              <div className="mt-3 grid gap-3">
                <div className="rounded-xl bg-gray-medium/40 p-3">
                  <Label htmlFor={`a-${item.id}`}>Pide un cambio con tus palabras</Label>
                  <Textarea id={`a-${item.id}`} rows={2} maxLength={600} placeholder="Ej.: el gancho más corto y que la escena 3 hable del recordatorio por voz" value={ask} onChange={(e) => setAsk(e.target.value)} />
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="soft"
                      disabled={!ask.trim()}
                      onClick={() => run(async () => { await api.post(`/api/admin/promo/${item.id}/revise`, { instruction: ask }); setAsk(''); }, 'Aplicando el cambio y grabando de nuevo…')}
                    >
                      <Wand2 size={14} /> Aplicar y volver a grabar
                    </Button>
                    <span className="text-xs text-gray-dark">Usa un poco de IA de texto; la voz solo se paga en lo que cambie.</span>
                  </div>
                </div>
                {item.content.stage && (
                  <div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="ghost" onClick={() => setLive(scenes.map((x) => ({ ...x })))}>
                        ▶ {live ? 'Actualizar' : 'Ver'} la vista previa con mis textos (con la voz ya grabada)
                      </Button>
                      {live && (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => setSound(!sound)}>
                            {sound ? '🔊 Con voz y música' : '🔇 Sin sonido'}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setLive(null)}>
                            Ocultar
                          </Button>
                        </>
                      )}
                    </div>
                    {live && <StagePreview stage={item.content.stage} format={fmt === 'landscape' ? 'landscape' : 'vertical'} texts={live} audio={item.audio} original={(item.content.scenes ?? []).map((x) => x.say)} sound={sound} />}
                  </div>
                )}
                {voices.length > 0 && (
                  <div>
                    <Label htmlFor={`v-${item.id}`}>Voz de este video</Label>
                    <div className="flex flex-wrap items-center gap-2">
                      <Select id={`v-${item.id}`} value={voiceKey} onChange={(e) => setVoiceKey(e.target.value)}>
                        {voices.map((v) => (
                          <option key={v.key} value={v.key}>
                            {v.name} · {v.style}
                            {v.key === defaultVoice ? ' (por defecto)' : ''}
                          </option>
                        ))}
                      </Select>
                      <Button size="sm" variant="soft" disabled={voiceKey === (item.voice ?? defaultVoice)} onClick={() => run(() => api.post(`/api/admin/promo/${item.id}/revise`, { voice: voiceKey }), 'Grabando con la nueva voz…')}>
                        Cambiar la voz y volver a grabar
                      </Button>
                    </div>
                  </div>
                )}
                {scenes.map((s, i) => (
                  <div key={i} className="grid gap-1.5">
                    <Label>
                      Escena {i + 1} · {item.content.scenes?.[i].shot}
                    </Label>
                    <Input maxLength={80} value={s.text} aria-label="Texto en pantalla" onChange={(e) => setScenes(scenes.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
                    <Textarea rows={2} maxLength={400} value={s.say} aria-label="Lo que dice la voz" onChange={(e) => setScenes(scenes.map((x, j) => (j === i ? { ...x, say: e.target.value } : x)))} />
                  </div>
                ))}
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="soft" onClick={() => run(() => api.post(`/api/admin/promo/${item.id}/revise`, { scenes }), 'Grabando de nuevo…')}>
                    <RefreshCw size={14} /> Guardar textos y volver a grabar
                  </Button>
                  <span className="text-xs text-gray-dark">No gasta IA de texto; solo regraba las escenas que cambiaron.</span>
                </div>
              </div>
            </details>
          )}

          {item.media === 'video' && (prevFile || (item.content.revisions?.length ?? 0) > 0) && (
            <details className="text-sm">
              <summary className="cursor-pointer font-semibold text-ink dark:text-white">
                <History size={14} className="mr-1 inline" /> Versiones ({(item.content.revisions?.length ?? 0) + 1})
              </summary>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-gray-dark">
                {(item.content.revisions ?? []).map((r, i) => (
                  <li key={i}>
                    {new Date(r.at).toLocaleString('es-CO')} — {r.note}
                  </li>
                ))}
              </ol>
              {prevFile && (
                <div className="mt-2">
                  <Button size="sm" variant="ghost" onClick={() => setShowPrev(!showPrev)}>
                    {showPrev ? 'Ocultar la versión anterior' : 'Ver la versión anterior'}
                  </Button>
                  {showPrev && <video key={prevFile.url} className="mx-auto mt-2 block max-h-[420px] rounded-xl" src={prevFile.url} poster={prevFile.poster} controls preload="metadata" playsInline />}
                </div>
              )}
            </details>
          )}

          {item.media === 'image' && (
            <details className="text-sm">
              <summary className="cursor-pointer font-semibold text-ink dark:text-white">✏️ Corregir los textos de la imagen</summary>
              <div className="mt-3 grid gap-3">
                <div>
                  <Label>Titular</Label>
                  <Input maxLength={60} value={copy.headline} onChange={(e) => setCopy({ ...copy, headline: e.target.value })} />
                </div>
                <div>
                  <Label>Frase de apoyo</Label>
                  <Textarea rows={2} maxLength={160} value={copy.sub} onChange={(e) => setCopy({ ...copy, sub: e.target.value })} />
                </div>
                {item.layout === 'features' && (
                  <div>
                    <Label>Beneficios (con un emoji al inicio)</Label>
                    <div className="grid gap-2">
                      {[0, 1, 2].map((i) => (
                        <Input
                          key={i}
                          maxLength={40}
                          value={copy.bullets[i] ?? ''}
                          onChange={(e) => setCopy({ ...copy, bullets: [0, 1, 2].map((j) => (j === i ? e.target.value : (copy.bullets[j] ?? ''))) })}
                        />
                      ))}
                    </div>
                  </div>
                )}
                <div>
                  <Label>Botón</Label>
                  <Input maxLength={32} value={copy.cta} onChange={(e) => setCopy({ ...copy, cta: e.target.value })} />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="soft" onClick={() => run(() => api.post(`/api/admin/promo/${item.id}/redraw`, copy), 'Dibujando de nuevo…')}>
                    <RefreshCw size={14} /> Guardar y volver a dibujar
                  </Button>
                  <span className="text-xs text-gray-dark">No gasta IA: usa tus textos.</span>
                </div>
              </div>
            </details>
          )}
        </>
      )}

      {!busy &&
        (askDelete ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-gray-dark">¿Eliminar para siempre, en todos sus formatos?</span>
            <Button size="sm" variant="secondary" onClick={() => void run(() => api.del(`/api/admin/promo/${item.id}`))}>
              <Trash2 size={14} /> Sí, eliminar
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAskDelete(false)}>
              Cancelar
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="ghost" className="self-start" onClick={() => setAskDelete(true)}>
            <Trash2 size={14} /> Eliminar
          </Button>
        ))}
    </Card>
  );
}
