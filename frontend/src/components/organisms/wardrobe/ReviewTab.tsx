import { useState } from 'react';
import { RefreshCw, CheckCircle2 } from 'lucide-react';
import { errMsg, type Api } from '../../../services/api.ts';
import type { GarmentDetail, WardrobeReviewStatus, WardrobeTaxonomy } from '../../../types/index.ts';
import { Card } from '../../atoms/Card.tsx';
import { Button } from '../../atoms/Button.tsx';
import { EmptyState } from '../../molecules/EmptyState.tsx';
import { useToast } from '../../molecules/Toast.tsx';
import { ReviewCard } from './ReviewCard.tsx';

export function ReviewTab({
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
