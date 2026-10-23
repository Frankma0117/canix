import { useState } from 'react';
import { errMsg, type Api } from '../../../services/api.ts';
import type { GarmentDetail, GarmentQuestionView, WardrobeTaxonomy } from '../../../types/index.ts';
import { Card } from '../../atoms/Card.tsx';
import { Button } from '../../atoms/Button.tsx';
import { Badge } from '../../atoms/Badge.tsx';
import { useToast } from '../../molecules/Toast.tsx';
import { OtherOption } from '../../molecules/wardrobe/OtherOption.tsx';
import { pretty } from '../../../utils/wardrobe.ts';

export function ReviewCard({ api, taxonomy, garment, onChanged, onError }: { api: Api; taxonomy: WardrobeTaxonomy | null; garment: GarmentDetail; onChanged: () => Promise<void>; onError: (e: string | null) => void }) {
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
