import { useState } from 'react';
import { Check, Copy, Download, RefreshCw, Trash2, X } from 'lucide-react';
import type { Api } from '../../../services/api.ts';
import { errMsg } from '../../../services/api.ts';
import type { PromoItem } from '../../../types/promo.ts';
import { Card } from '../../atoms/Card.tsx';
import { Badge, type Tone } from '../../atoms/Badge.tsx';
import { Button } from '../../atoms/Button.tsx';
import { Input, Label, Textarea } from '../../atoms/Input.tsx';
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
export function PromoCard({ api, item, onChange }: { api: Api; item: PromoItem; onChange: () => void }) {
  const toast = useToast();
  const formats = item.formats.filter((f) => item.files[f]);
  const [fmt, setFmt] = useState(formats[0]);
  const [title, setTitle] = useState(item.title);
  const [caption, setCaption] = useState(item.caption);
  const [copy, setCopy] = useState({ headline: item.content.headline ?? '', sub: item.content.sub ?? '', cta: item.content.cta ?? '', bullets: item.content.bullets ?? [] });
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

          {item.media === 'video' && item.content.scenes && (
            <details className="text-sm">
              <summary className="cursor-pointer font-semibold text-ink dark:text-white">Ver el guion</summary>
              <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-gray-dark">
                {item.content.scenes.map((s, i) => (
                  <li key={i}>
                    <b className="text-ink dark:text-white">{s.text}</b> — {s.say}
                  </li>
                ))}
              </ol>
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

      {!busy && (
        <Button
          size="sm"
          variant="ghost"
          className="self-start"
          onClick={() => {
            if (confirm('¿Eliminar para siempre? Se borra en todos sus formatos.')) void run(() => api.del(`/api/admin/promo/${item.id}`));
          }}
        >
          <Trash2 size={14} /> Eliminar
        </Button>
      )}
    </Card>
  );
}
