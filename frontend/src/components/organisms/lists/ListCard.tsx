import { useEffect, useState, type FormEvent } from 'react';
import { Plus, Trash2, ChevronDown, Copy } from 'lucide-react';
import { useApi, errMsg } from '../../../services/api.ts';
import type { Checklist, ListKind } from '../../../types/index.ts';
import { Select } from '../../atoms/Input.tsx';
import { useToast } from '../../molecules/Toast.tsx';
import { Card } from '../../atoms/Card.tsx';
import { Badge } from '../../atoms/Badge.tsx';
import { Button, IconButton } from '../../atoms/Button.tsx';
import { Input } from '../../atoms/Input.tsx';
import { ItemRow } from '../../molecules/lists/ItemRow.tsx';
import { Item, KINDS, kindInfo } from '../../../config/lists.ts';

/** The list as clean text to paste anywhere: title, then one item per line. */
export function asText(list: Checklist, items: Item[]): string {
  const pending = items.filter((i) => !i.checked).map((i) => `- ${i.title}`);
  const done = items.filter((i) => i.checked).map((i) => `- ${i.title}`);
  const lines = [`${kindInfo(list.kind).emoji} ${list.name}`];
  if (pending.length) lines.push('', ...(done.length ? ['Pendientes:'] : []), ...pending);
  if (done.length) lines.push('', 'Ya marcados:', ...done);
  return lines.join('\n');
}

export function ListCard({ list, onChanged, onError }: { list: Checklist; onChanged: () => Promise<void>; onError: (m: string) => void }) {
  const api = useApi();
  const toast = useToast();
  const kind = kindInfo(list.kind);
  const [items, setItems] = useState<Item[]>(list.items);
  const [draft, setDraft] = useState('');
  const [showDone, setShowDone] = useState(false);
  const [adding, setAdding] = useState(false);
  useEffect(() => setItems(list.items), [list.items]);

  const pending = items.filter((i) => !i.checked);
  const done = items.filter((i) => i.checked);
  const percent = items.length ? Math.round((done.length / items.length) * 100) : 0;
  const complete = items.length > 0 && done.length === items.length;

  async function toggle(item: Item) {
    // Shown at once; put back if the server says no.
    setItems((all) => all.map((i) => (i.id === item.id ? { ...i, checked: i.checked ? 0 : 1 } : i)));
    try {
      await api.put(`/api/lists/items/${item.id}`, { checked: !item.checked });
    } catch (e) {
      setItems((all) => all.map((i) => (i.id === item.id ? item : i)));
      onError(errMsg(e));
    }
  }

  async function remove(item: Item) {
    try {
      await api.del(`/api/lists/items/${item.id}`);
      await onChanged();
    } catch (e) {
      onError(errMsg(e));
    }
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    const title = draft.trim();
    if (!title) return;
    setAdding(true);
    try {
      await api.post(`/api/lists/${list.id}/items`, { title });
      setDraft('');
      await onChanged();
    } catch (err) {
      onError(errMsg(err));
    } finally {
      setAdding(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(asText(list, items));
      toast.success(`"${list.name}" copiada: pégala donde quieras.`);
    } catch {
      onError('No se pudo copiar. Tu navegador no dio permiso para usar el portapapeles.');
    }
  }

  async function changeKind(next: ListKind) {
    try {
      await api.put(`/api/lists/${list.id}`, { kind: next });
      await onChanged();
    } catch (e) {
      onError(errMsg(e));
    }
  }

  async function removeList() {
    if (!confirm(`¿Borrar la lista "${list.name}" con todo lo que tiene?`)) return;
    try {
      await api.del(`/api/lists/${list.id}`);
      await onChanged();
    } catch (e) {
      onError(errMsg(e));
    }
  }

  return (
    <Card className="flex flex-col p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-secondary text-xl dark:bg-primary/15" aria-hidden>
          {kind.emoji}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-lg font-extrabold leading-tight text-ink dark:text-white">{list.name}</h3>
          <p className="mt-0.5 text-sm text-gray-dark">{items.length === 0 ? 'Vacía, agrégale algo abajo' : `${done.length} de ${items.length} marcados`}</p>
        </div>
        {complete && <Badge tone="success">Completa</Badge>}
        <IconButton label={`Copiar la lista ${list.name} como texto`} onClick={copy} className="shrink-0">
          <Copy size={16} />
        </IconButton>
        <IconButton label={`Borrar la lista ${list.name}`} onClick={removeList} className="shrink-0 hover:!bg-error/10 hover:!text-error">
          <Trash2 size={16} />
        </IconButton>
      </div>

      <label className="mt-3 flex items-center gap-2 text-xs font-semibold text-gray-dark">
        Tipo de lista
        <Select value={list.kind} onChange={(e) => changeKind(e.target.value as ListKind)} className="!w-auto !py-1.5 !text-xs" aria-label={`Tipo de la lista ${list.name}`}>
          {KINDS.map((k) => (
            <option key={k.id} value={k.id}>
              {k.emoji} {k.label}
            </option>
          ))}
        </Select>
      </label>

      {items.length > 0 && (
        <div
          className="mt-4 h-2 overflow-hidden rounded-full bg-gray-medium/60 dark:bg-white/10"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${percent}% marcado`}
        >
          <div className={`h-full rounded-full transition-all duration-300 ${complete ? 'bg-success' : 'brand-gradient'}`} style={{ width: `${percent}%` }} />
        </div>
      )}

      {pending.length > 0 && (
        <ul className="mt-3 max-h-80 space-y-0.5 overflow-y-auto pr-1">
          {pending.map((i) => (
            <ItemRow key={i.id} item={i} onToggle={() => toggle(i)} onRemove={() => remove(i)} />
          ))}
        </ul>
      )}

      {done.length > 0 && (
        <div className="mt-2">
          <button
            type="button"
            aria-expanded={showDone}
            onClick={() => setShowDone((v) => !v)}
            className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-bold uppercase tracking-[0.1em] text-gray-dark hover:bg-gray-light focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/25 dark:hover:bg-white/5"
          >
            <ChevronDown size={14} className={`transition-transform ${showDone ? 'rotate-180' : ''}`} /> Marcados · {done.length}
          </button>
          {showDone && (
            <ul className="mt-1 max-h-60 space-y-0.5 overflow-y-auto pr-1">
              {done.map((i) => (
                <ItemRow key={i.id} item={i} onToggle={() => toggle(i)} onRemove={() => remove(i)} />
              ))}
            </ul>
          )}
        </div>
      )}

      <form onSubmit={add} className="mt-4 flex gap-2">
        <Input placeholder="Agregar algo a la lista…" aria-label={`Agregar a ${list.name}`} value={draft} onChange={(e) => setDraft(e.target.value)} />
        <Button type="submit" variant="soft" disabled={!draft.trim()} loading={adding} aria-label="Agregar">
          <Plus size={16} />
        </Button>
      </form>
    </Card>
  );
}
