import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import type { Api } from '../../../services/api.ts';
import { errMsg } from '../../../services/api.ts';
import { Card } from '../../atoms/Card.tsx';
import { Button } from '../../atoms/Button.tsx';
import { Hint, Label, Textarea } from '../../atoms/Input.tsx';
import { useToast } from '../../molecules/Toast.tsx';

type Media = 'video' | 'image';
const KINDS = [
  { id: 'ad', label: '📣 Anuncio' },
  { id: 'howto', label: '🧭 Cómo funciona' },
] as const;

const chip = (on: boolean) =>
  `rounded-full border px-3.5 py-1.5 text-sm font-semibold transition-all ${on ? 'border-primary bg-primary/10 text-primary-dark dark:text-white' : 'border-gray-medium bg-white text-ink hover:border-primary/40 dark:border-white/10 dark:bg-white/5 dark:text-white'}`;

/** Asks for new video or images (they cost money: the project has a monthly cap). */
export function MediaGenerator({ api, cap, used, textAi, onCreated }: { api: Api; cap: number; used: number; textAi: boolean; onCreated: () => void }) {
  const toast = useToast();
  const [media, setMedia] = useState<Media>('video');
  const [kind, setKind] = useState<'ad' | 'howto'>('ad');
  const [count, setCount] = useState(1);
  const [idea, setIdea] = useState('');
  const [busy, setBusy] = useState(false);
  const left = Math.max(0, cap - used);

  async function create() {
    setBusy(true);
    try {
      await api.post('/api/admin/publisher/generate', {
        media,
        kind,
        formats: media === 'video' ? ['vertical', 'landscape'] : ['square', 'story'],
        count: media === 'image' ? count : 1,
        idea,
      });
      toast.success('Listo: se está creando. Cuando lo apruebes en «Videos y publicidad» aparece aquí para publicar.');
      setIdea('');
      onCreated();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5 sm:p-6">
      <h2 className="font-display text-lg font-extrabold text-ink dark:text-white">Crear material nuevo</h2>
      <p className="mb-4 mt-1 text-sm text-gray-dark">
        Este mes llevas {used} de {cap} piezas ({left} disponibles). Lo que crees pasa por tu revisión antes de poder publicarse.
      </p>
      <div className="mb-4 flex flex-wrap gap-2">
        <button type="button" className={chip(media === 'video')} onClick={() => setMedia('video')}>
          🎬 Video
        </button>
        <button type="button" className={chip(media === 'image')} onClick={() => setMedia('image')}>
          🖼️ Imágenes
        </button>
        <span className="mx-1 w-px bg-gray-medium dark:bg-white/10" />
        {KINDS.map((k) => (
          <button key={k.id} type="button" className={chip(kind === k.id)} onClick={() => setKind(k.id)}>
            {k.label}
          </button>
        ))}
      </div>
      {media === 'image' && (
        <div className="mb-4">
          <Label>¿Cuántas?</Label>
          <div className="flex gap-2">
            {[1, 2, 3].map((n) => (
              <button key={n} type="button" className={`${chip(count === n)} min-w-11`} onClick={() => setCount(n)}>
                {n}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="mb-4">
        <Label htmlFor="mg-idea">Indicación (opcional)</Label>
        <Textarea id="mg-idea" rows={2} maxLength={500} value={idea} onChange={(e) => setIdea(e.target.value)} placeholder="Ej.: dirigido a quienes atienden clientes por WhatsApp." />
        <Hint>{textAi ? 'La IA escribe el guion y los textos.' : 'Sin la clave de IA se usan textos de plantilla.'}</Hint>
      </div>
      <Button onClick={create} loading={busy} disabled={left === 0}>
        <Sparkles size={16} /> {media === 'video' ? 'Crear video' : 'Crear imágenes'}
      </Button>
    </Card>
  );
}
