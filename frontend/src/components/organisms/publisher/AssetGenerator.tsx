import { useCallback, useEffect, useState } from 'react';
import { Sparkles, Trash2 } from 'lucide-react';
import type { Api } from '../../../services/api.ts';
import { errMsg } from '../../../services/api.ts';
import { Card } from '../../atoms/Card.tsx';
import { Button } from '../../atoms/Button.tsx';
import { Hint, Label, Textarea } from '../../atoms/Input.tsx';
import { useToast } from '../../molecules/Toast.tsx';
import type { GeneratedAsset, GenerationStatus } from '../../../types/publisher.ts';

type Aspect = 'square' | 'portrait' | 'landscape';
const ASPECTS: { id: Aspect; label: string }[] = [
  { id: 'portrait', label: 'Vertical (Reels, TikTok)' },
  { id: 'square', label: 'Cuadrado' },
  { id: 'landscape', label: 'Horizontal' },
];

const chip = (on: boolean) =>
  `rounded-full border px-3.5 py-1.5 text-sm font-semibold transition-all ${on ? 'border-primary bg-primary/10 text-primary-dark dark:text-white' : 'border-gray-medium bg-white text-ink hover:border-primary/40 dark:border-white/10 dark:bg-white/5 dark:text-white'}`;

const usd = (cents: number) => `USD ${(cents / 100).toFixed(2)}`;

/** Makes an image or a video from a description with the project's providers; the result joins the material to publish. */
export function AssetGenerator({ api, onChanged }: { api: Api; onChanged: () => void }) {
  const toast = useToast();
  const [info, setInfo] = useState<(GenerationStatus & { assets: GeneratedAsset[] }) | null>(null);
  const [media, setMedia] = useState<'image' | 'video'>('image');
  const [aspect, setAspect] = useState<Aspect>('square');
  const [seconds, setSeconds] = useState(5);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setInfo(await api.get('/api/admin/publisher/generation'));
    } catch {
      /* the panel keeps working without this block */
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  // While something is being made, look again every few seconds; when it finishes the material list refreshes.
  const working = info?.assets.some((a) => a.status === 'working') ?? false;
  useEffect(() => {
    if (!working) return;
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, [working, load]);
  useEffect(() => {
    if (info && !working) onChanged();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [working]);

  async function create() {
    setBusy(true);
    try {
      await api.post(`/api/admin/publisher/generation/${media}`, { prompt, aspect: media === 'video' && aspect === 'square' ? 'portrait' : aspect, seconds });
      setPrompt('');
      toast.success('Se está creando. Cuando termine aparece en el material para publicar.');
      await load();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    try {
      await api.del(`/api/admin/publisher/generation/${id}`);
      await load();
      onChanged();
    } catch (err) {
      toast.error(errMsg(err));
    }
  }

  const active = info ? (media === 'image' ? info.image : info.video).find((p) => p.active) : undefined;

  return (
    <Card className="p-5 sm:p-6">
      <h2 className="font-display text-lg font-extrabold text-ink dark:text-white">Crear con IA a partir de una descripción</h2>
      <p className="mb-4 mt-1 text-sm text-gray-dark">
        {info ? `Gasto del mes: ${usd(info.usage.spentCents)} de ${usd(info.usage.costCapCents)}. ` : ''}
        Usa el perfil de marca (colores, estilo y tono) y el resultado queda guardado para publicarlo cuando quieras.
      </p>
      <div className="mb-4 flex flex-wrap gap-2">
        <button type="button" className={chip(media === 'image')} onClick={() => setMedia('image')}>
          🖼️ Imagen
        </button>
        <button type="button" className={chip(media === 'video')} onClick={() => setMedia('video')}>
          🎬 Video corto
        </button>
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        {ASPECTS.filter((a) => media === 'image' || a.id !== 'square').map((a) => (
          <button key={a.id} type="button" className={chip(aspect === a.id)} onClick={() => setAspect(a.id)}>
            {a.label}
          </button>
        ))}
      </div>
      {media === 'video' && info && (
        <div className="mb-4">
          <Label>Duración</Label>
          <div className="flex flex-wrap gap-2">
            {[3, 5, 8, info.maxVideoSeconds].filter((n, i, l) => l.indexOf(n) === i).map((n) => (
              <button key={n} type="button" className={`${chip(seconds === n)} min-w-11`} onClick={() => setSeconds(n)}>
                {n} s
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="mb-4">
        <Label htmlFor="ag-prompt">¿Qué quieres ver?</Label>
        <Textarea id="ag-prompt" rows={2} maxLength={600} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Ej.: una taza de café humeante sobre una mesa de madera, luz de la mañana." />
        {active && <Hint>{active.simulated ? 'Proveedor de prueba: genera una muestra gratis con los colores de tu marca.' : `Proveedor: ${active.label}. Tiene costo.`}</Hint>}
      </div>
      <Button onClick={create} loading={busy} disabled={prompt.trim().length < 3}>
        <Sparkles size={16} /> {media === 'video' ? 'Crear video' : 'Crear imagen'}
      </Button>

      {info && info.assets.length > 0 && (
        <ul className="mt-5 space-y-2">
          {info.assets.slice(0, 8).map((a) => (
            <li key={a.id} className="flex items-center gap-3 rounded-xl border border-gray-medium p-2.5 dark:border-white/10">
              {a.status === 'ready' && a.media === 'image' ? <img src={a.url} alt="" className="size-12 rounded-lg object-cover" /> : <span className="grid size-12 place-items-center rounded-lg bg-gray-light text-xl dark:bg-white/5">{a.media === 'video' ? '🎬' : '🖼️'}</span>}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink dark:text-white">{a.title}</p>
                <p className="text-xs text-gray-dark">
                  {a.status === 'working' ? 'Creando…' : a.status === 'error' ? a.detail || 'Falló.' : a.simulated ? 'Lista (muestra gratis)' : `Lista · ${usd(a.costCents)}`}
                </p>
              </div>
              {a.status !== 'working' && (
                <button type="button" onClick={() => void remove(a.id)} className="grid size-9 place-items-center rounded-lg text-gray-dark transition-colors hover:bg-red-50 hover:text-red-600" aria-label="Eliminar">
                  <Trash2 size={16} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
