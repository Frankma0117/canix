import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import type { Api } from '../../../services/api.ts';
import { errMsg } from '../../../services/api.ts';
import type { PromoKind, PromoMedia, PromoStatusInfo } from '../../../types/promo.ts';
import { Card } from '../../atoms/Card.tsx';
import { Button } from '../../atoms/Button.tsx';
import { Label, Select, Textarea, Hint } from '../../atoms/Input.tsx';
import { useToast } from '../../molecules/Toast.tsx';

const KINDS: { id: PromoKind; icon: string; label: string; hint: Record<PromoMedia, string> }[] = [
  { id: 'ad', icon: '📣', label: 'Anuncio', hint: { video: 'Corto y llamativo para redes (20–30 s).', image: 'Para que alguien pida la demo.' } },
  { id: 'howto', icon: '🧭', label: 'Cómo funciona', hint: { video: 'De principio a fin: escribirle, organizar, avisos (40–55 s).', image: 'Cómo funciona, en un vistazo.' } },
  { id: 'feature', icon: '⭐', label: 'Una función', hint: { video: 'Una función con un chat de ejemplo (25–40 s).', image: 'Una función con su chat de ejemplo.' } },
];
const FORMATS: Record<PromoMedia, { id: string; label: string }[]> = {
  video: [{ id: 'vertical', label: '📱 Vertical (reels, TikTok, estados)' }, { id: 'landscape', label: '🖥️ Horizontal (YouTube, web)' }],
  image: [{ id: 'square', label: '⬛ Cuadrado (publicaciones)' }, { id: 'story', label: '📱 Historia / estado' }, { id: 'landscape', label: '🖥️ Horizontal' }],
};
const LAYOUTS = [
  { id: 'auto', label: '✨ Variado' },
  { id: 'chat', label: '💬 Con chat' },
  { id: 'features', label: '✅ Con beneficios' },
  { id: 'mascot', label: '🤖 Con la mascota' },
];

const chip = (on: boolean) =>
  `rounded-full border px-3.5 py-1.5 text-sm font-semibold transition-all ${on ? 'border-primary bg-primary/10 text-primary-dark shadow-[0_3px_0_var(--color-primary)] dark:text-white' : 'border-gray-medium bg-white text-ink hover:border-primary/40 dark:border-white/10 dark:bg-white/5 dark:text-white'}`;

/** The form that asks for new videos or images. */
export function PromoCreator({ api, media, status, onCreated }: { api: Api; media: PromoMedia; status: PromoStatusInfo; onCreated: () => void }) {
  const toast = useToast();
  const [kind, setKind] = useState<PromoKind>('ad');
  const [feature, setFeature] = useState(status.features[0]?.key ?? '');
  const [formats, setFormats] = useState<string[]>(FORMATS[media].map((f) => f.id));
  const [layout, setLayout] = useState('auto');
  const [count, setCount] = useState(media === 'image' ? 3 : 1);
  const [idea, setIdea] = useState('');
  const [busy, setBusy] = useState(false);

  const toggle = (id: string) => setFormats((cur) => (cur.includes(id) ? cur.filter((f) => f !== id) : [...cur, id]));

  async function create() {
    if (!formats.length) return toast.error('Elige al menos un formato.');
    setBusy(true);
    try {
      await api.post('/api/admin/promo', { media, kind, feature: kind === 'feature' ? feature : null, formats, layout, count, idea });
      toast.success(media === 'video' ? 'Listo: el video se está creando. Aparece aquí abajo.' : 'Listo: las imágenes se están creando. Aparecen aquí abajo.');
      setIdea('');
      onCreated();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mb-6 p-5 sm:p-6">
      <h2 className="mb-4 font-display text-lg font-extrabold text-ink dark:text-white">{media === 'video' ? 'Nuevo video' : 'Nuevas imágenes'}</h2>
      <div className="mb-4 grid gap-2.5 sm:grid-cols-3">
        {KINDS.map((k) => (
          <button
            key={k.id}
            type="button"
            onClick={() => setKind(k.id)}
            className={`rounded-2xl border-2 p-3.5 text-left transition-all ${kind === k.id ? 'border-primary bg-primary/5 shadow-[0_3px_0_var(--color-primary)]' : 'border-gray-medium hover:border-primary/40 dark:border-white/10'}`}
          >
            <p className="font-display font-extrabold text-ink dark:text-white">
              {k.icon} {k.label}
            </p>
            <p className="mt-0.5 text-xs text-gray-dark">{k.hint[media]}</p>
          </button>
        ))}
      </div>

      {kind === 'feature' && (
        <div className="mb-4 max-w-md">
          <Label htmlFor="promo-feature">¿Qué función?</Label>
          <Select id="promo-feature" value={feature} onChange={(e) => setFeature(e.target.value)}>
            {status.features.map((f) => (
              <option key={f.key} value={f.key}>
                {f.emoji} {f.name}
              </option>
            ))}
          </Select>
        </div>
      )}

      <div className="mb-4">
        <Label>Formatos</Label>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {FORMATS[media].map((f) => (
            <label key={f.id} className="inline-flex cursor-pointer items-center gap-2 text-sm text-ink dark:text-white/85">
              <input type="checkbox" className="h-4 w-4 accent-[var(--color-primary)]" checked={formats.includes(f.id)} onChange={() => toggle(f.id)} /> {f.label}
            </label>
          ))}
        </div>
      </div>

      {media === 'image' && (
        <div className="mb-4 flex flex-wrap gap-x-8 gap-y-3">
          <div>
            <Label>Diseño</Label>
            <div className="flex flex-wrap gap-2">
              {LAYOUTS.map((l) => (
                <button key={l.id} type="button" className={chip(layout === l.id)} onClick={() => setLayout(l.id)}>
                  {l.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label>¿Cuántas?</Label>
            <div className="flex gap-2">
              {[1, 2, 3].map((n) => (
                <button key={n} type="button" className={`${chip(count === n)} min-w-11`} onClick={() => setCount(n)}>
                  {n}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="mb-4">
        <Label htmlFor="promo-idea">Indicación (opcional)</Label>
        <Textarea
          id="promo-idea"
          rows={2}
          maxLength={500}
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
          placeholder="Ej.: para emprendedores que atienden clientes por WhatsApp; resalta que no hay que instalar nada."
        />
        <Hint>{status.textAi ? 'La IA escribe el guion y los textos con las funciones reales de Canix; si quieres, oriéntala aquí.' : 'Sin la clave de IA se usan textos fijos de plantilla.'}</Hint>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={create} loading={busy} disabled={!status.canRender}>
          <Sparkles size={16} /> {media === 'video' ? 'Crear video' : 'Crear imágenes'}
        </Button>
        <span className="text-xs text-gray-dark">
          {media === 'video' ? 'Tarda unos minutos por formato: se graba con calma para no frenar a Canix.' : 'Tarda unos segundos por imagen; cada una sale en todos los formatos elegidos.'}
        </span>
      </div>
    </Card>
  );
}
