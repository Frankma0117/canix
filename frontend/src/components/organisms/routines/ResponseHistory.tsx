import { useEffect, useState } from 'react';
import { useApi, errMsg } from '../../../services/api.ts';
import type { PromptSource, PromptWithResponses } from '../../../types/index.ts';
import { formatDayLong, formatWhen } from '../../../utils/dates.ts';
import { Badge } from '../../atoms/Badge.tsx';
import { Skeleton } from '../../atoms/Skeleton.tsx';
import { cap } from '../../../utils/text.ts';
import { clockText, delayText } from '../../../utils/routines.ts';

export const SOURCE_LABEL: Record<PromptSource, string> = {
  poll: 'con la encuesta de WhatsApp',
  reply: 'reaccionando o respondiendo al aviso',
  chat: 'diciéndoselo a Canix',
  web: 'desde el portal',
};

// ---------------------------------------------------------------------------------------------
// History of answers for one routine
// ---------------------------------------------------------------------------------------------
export function ResponseHistory({ routineId }: { routineId: number }) {
  const api = useApi();
  const [items, setItems] = useState<PromptWithResponses[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<PromptWithResponses[]>(`/api/todos/${routineId}/responses?limit=30`)
      .then(setItems)
      .catch((e) => setError(errMsg(e)));
  }, [api, routineId]);

  if (error) return <p className="text-sm text-error">{error}</p>;
  if (!items) return <Skeleton className="h-16" />;
  if (items.length === 0) {
    return <p className="text-sm text-gray-dark">Todavía no hay respuestas. Aparecen aquí cada vez que marcas la rutina, con la hora exacta.</p>;
  }

  return (
    <ol className="space-y-3">
      {items.map((p) => (
        <li key={p.id} className="rounded-xl bg-gray-light/70 p-3 dark:bg-white/5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-ink dark:text-white">{cap(formatDayLong(p.occurrence_date))}</p>
            {p.answer === 'yes' ? <Badge tone="success">Cumplida</Badge> : p.answer === 'no' ? <Badge tone="error">No se hizo</Badge> : <Badge tone="warning">Sin respuesta</Badge>}
          </div>
          <p className="mt-0.5 text-xs text-gray-dark">{p.sent_at ? `Aviso enviado a las ${clockText(p.sent_at.slice(11, 16))}` : 'Marcada sin aviso previo'}</p>
          {p.responses.length > 0 && (
            <ul className="mt-2 space-y-1.5 border-l-2 border-gray-medium pl-3 dark:border-white/15">
              {p.responses.map((r, i) => (
                <li key={r.id} className="text-sm text-ink dark:text-white/90">
                  <span className="font-semibold">{r.answer === 'yes' ? '✅ Sí' : '❌ No'}</span> · {formatWhen(r.created_at)}
                  <span className="block text-xs text-gray-dark">
                    {cap(SOURCE_LABEL[r.source])}
                    {delayText(p.sent_at, r.created_at) && ` · ${delayText(p.sent_at, r.created_at)}`}
                    {i > 0 && ' · cambió la respuesta'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  );
}
