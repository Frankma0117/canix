import { useState } from 'react';
import type { LibraryResponse, MediaItem, MediaKind } from '../../../types/index.ts';
import { Modal } from '../Modal.tsx';
import { Button } from '../../atoms/Button.tsx';
import { Input, Label, Select, Textarea, Hint } from '../../atoms/Input.tsx';
import { StarRating } from '../../atoms/StarRating.tsx';
import { MEDIA_KIND_INFO } from '../../../config/media.ts';

export interface MediaDraft {
  id?: number;
  kind: MediaKind;
  title: string;
  creator: string;
  genre: string;
  year: string;
  url: string;
  summary: string;
  notes: string;
  list: string;
  rating: number | null;
  done: boolean;
}

export function draftOf(item: MediaItem | null, kind: MediaKind): MediaDraft {
  return {
    id: item?.id,
    kind: item?.kind ?? kind,
    title: item?.title ?? '',
    creator: item?.creator ?? '',
    genre: item?.genre ?? '',
    year: item?.year ? String(item.year) : '',
    url: item?.url ?? '',
    summary: item?.summary ?? '',
    notes: item?.notes ?? '',
    list: item?.list_name ?? '',
    rating: item?.rating ?? null,
    done: !!item?.checked,
  };
}

/** Create or edit one library item. Lists of the chosen kind are offered; a new name creates one. */
export function MediaItemForm({
  initial,
  lists,
  onCancel,
  onSave,
}: {
  initial: MediaDraft;
  lists: LibraryResponse['lists'];
  onCancel: () => void;
  onSave: (draft: MediaDraft) => Promise<void>;
}) {
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof MediaDraft>(key: K, value: MediaDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const info = MEDIA_KIND_INFO[draft.kind];
  const listOptions = lists.filter((l) => l.kind === draft.kind);

  async function submit() {
    setSaving(true);
    try {
      await onSave(draft);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={draft.id ? `Editar ${info.item}` : `Agregar ${info.item}`} onClose={onCancel} size="md">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>Tipo</Label>
          <Select value={draft.kind} onChange={(e) => set('kind', e.target.value as MediaKind)} disabled={!!draft.id}>
            {Object.entries(MEDIA_KIND_INFO).map(([id, k]) => (
              <option key={id} value={id}>
                {k.emoji} {k.label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Título</Label>
          <Input value={draft.title} onChange={(e) => set('title', e.target.value)} placeholder={info.example} />
        </div>
        <div>
          <Label>{info.creatorLabel}</Label>
          <Input value={draft.creator} onChange={(e) => set('creator', e.target.value)} />
        </div>
        <div>
          <Label>Género</Label>
          <Input value={draft.genre} onChange={(e) => set('genre', e.target.value)} />
        </div>
        <div>
          <Label>Año</Label>
          <Input inputMode="numeric" value={draft.year} onChange={(e) => set('year', e.target.value.replace(/\D/g, '').slice(0, 4))} />
        </div>
        <div>
          <Label>Lista</Label>
          <Input list="media-lists" value={draft.list} onChange={(e) => set('list', e.target.value)} placeholder={info.label} />
          <datalist id="media-lists">
            {listOptions.map((l) => (
              <option key={l.id} value={l.name} />
            ))}
          </datalist>
          <Hint>Escribe un nombre nuevo para crear otra lista.</Hint>
        </div>
      </div>
      <div className="mt-3">
        <Label>Link</Label>
        <Input value={draft.url} onChange={(e) => set('url', e.target.value)} placeholder="https://…" />
        {!draft.id && <Hint>Se guarda también en tus links, en la categoría «{info.label}».</Hint>}
      </div>
      <div className="mt-3">
        <Label>De qué se trata</Label>
        <Textarea rows={3} value={draft.summary} onChange={(e) => set('summary', e.target.value)} />
      </div>
      <div className="mt-3">
        <Label>Tus notas</Label>
        <Textarea rows={2} value={draft.notes} onChange={(e) => set('notes', e.target.value)} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-4">
        <label className="inline-flex items-center gap-2 text-sm font-semibold text-ink dark:text-white/85">
          <input type="checkbox" checked={draft.done} onChange={(e) => set('done', e.target.checked)} className="h-4 w-4 accent-[var(--color-primary)]" />
          Ya {info.done}
        </label>
        <StarRating value={draft.rating} onChange={(v) => set('rating', v)} />
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
        <Button onClick={submit} loading={saving} disabled={!draft.title.trim()}>
          Guardar
        </Button>
      </div>
    </Modal>
  );
}
