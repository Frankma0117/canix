import { useEffect, useState } from 'react';
import { Pause, Play, Trash2 } from 'lucide-react';
import type { Api } from '../../../services/api.ts';
import type { PackSticker, StickerMomentDef } from '../../../types/index.ts';
import { Card } from '../../atoms/Card.tsx';
import { Badge } from '../../atoms/Badge.tsx';
import { Input, Textarea } from '../../atoms/Input.tsx';

export interface StickerChanges {
  label?: string;
  moments?: string[] | null;
  usage?: string | null;
  active?: boolean;
}

/**
 * One sticker of the pack: its image, name, the moments it fits (chips; "sugerido" while they only
 * come from the name), the admin's own "cuándo usarlo", how often it went out, pause and delete.
 */
export function PackStickerCard({
  api,
  sticker,
  moments,
  onChange,
  onDelete,
}: {
  api: Api;
  sticker: PackSticker;
  moments: StickerMomentDef[];
  onChange: (changes: StickerChanges) => void;
  onDelete: () => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [label, setLabel] = useState(sticker.label ?? '');
  const [usage, setUsage] = useState(sticker.usage ?? '');

  useEffect(() => {
    let url: string | null = null;
    api.fileUrl(`/api/admin/stickers/${sticker.id}/image`).then(
      (u) => setSrc((url = u)),
      () => setSrc(null),
    );
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [api, sticker.id]);

  function toggleMoment(key: string) {
    const next = sticker.moments.includes(key) ? sticker.moments.filter((k) => k !== key) : [...sticker.moments, key];
    onChange({ moments: next });
  }

  return (
    <Card className={`flex flex-col p-3 ${sticker.active ? '' : 'opacity-60'}`}>
      <div className="relative mb-2 flex aspect-square items-center justify-center rounded-xl bg-[#e5ddd5] dark:bg-white/5">
        {src ? <img src={src} alt={sticker.label ?? 'sticker'} className="h-full w-full object-contain p-2" /> : <span className="text-xs text-gray-dark">Cargando…</span>}
        {!sticker.active && <Badge className="absolute left-2 top-2">Pausado</Badge>}
        {!sticker.label && <Badge tone="warning" className="absolute left-2 top-2">Sin nombre</Badge>}
      </div>
      <Input
        value={label}
        placeholder="nombre_del_sticker"
        onChange={(e) => setLabel(e.target.value)}
        onBlur={() => label.trim() && label !== sticker.label && onChange({ label })}
        className="!py-1.5 text-sm font-semibold"
        aria-label="Nombre"
      />
      <p className="mt-2 text-[11px] font-bold uppercase tracking-wide text-gray-dark">
        Momentos {sticker.momentsSuggested && sticker.moments.length > 0 && <span className="normal-case text-amber-600">· sugeridos por el nombre</span>}
      </p>
      <div className="mt-1 flex flex-wrap gap-1">
        {moments.map((m) => {
          const on = sticker.moments.includes(m.key);
          return (
            <button
              key={m.key}
              type="button"
              title={m.when}
              onClick={() => toggleMoment(m.key)}
              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold transition-colors ${
                on
                  ? sticker.momentsSuggested
                    ? 'bg-amber-100 text-amber-800 ring-1 ring-amber-300 dark:bg-amber-500/15 dark:text-amber-200'
                    : 'bg-primary text-white'
                  : 'bg-gray-medium/50 text-gray-dark hover:bg-gray-medium dark:bg-white/5'
              }`}
            >
              {m.label}
            </button>
          );
        })}
      </div>
      <Textarea
        rows={2}
        value={usage}
        placeholder="Cuándo usarlo, con tus palabras (ej. cuando cumpla una meta difícil)"
        onChange={(e) => setUsage(e.target.value)}
        onBlur={() => usage !== (sticker.usage ?? '') && onChange({ usage: usage.trim() || null })}
        className="mt-2 !py-1.5 text-xs"
        aria-label="Cuándo usarlo"
      />
      <div className="mt-2 flex items-center justify-between text-[11px] text-gray-dark">
        <span>{sticker.sent_count ? `Enviado ${sticker.sent_count} ${sticker.sent_count === 1 ? 'vez' : 'veces'}` : 'Nunca enviado'}</span>
        <span className="flex gap-0.5">
          <button className="rounded-lg p-1.5 hover:bg-gray-medium/60" onClick={() => onChange({ active: !sticker.active })} aria-label={sticker.active ? 'Pausar' : 'Activar'} title={sticker.active ? 'Pausar' : 'Activar'}>
            {sticker.active ? <Pause size={14} /> : <Play size={14} />}
          </button>
          <button className="rounded-lg p-1.5 hover:bg-error/10 hover:text-error" onClick={onDelete} aria-label="Borrar" title="Borrar">
            <Trash2 size={14} />
          </button>
        </span>
      </div>
    </Card>
  );
}
