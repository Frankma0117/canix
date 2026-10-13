import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Plus, Trash2, Check, X, ChevronDown, Copy } from 'lucide-react';
import { useApi, errMsg } from '../lib/api.ts';
import type { Checklist, ListKind } from '../lib/types.ts';
import { Page, Notice, Tabs } from '../components/ui/Page.tsx';
import { Select } from '../components/ui/Input.tsx';
import { useToast } from '../components/ui/Toast.tsx';
import { Card } from '../components/ui/Card.tsx';
import { Badge } from '../components/ui/Badge.tsx';
import { Button, IconButton } from '../components/ui/Button.tsx';
import { Input } from '../components/ui/Input.tsx';
import { EmptyState } from '../components/ui/EmptyState.tsx';
import { Skeleton } from '../components/ui/Skeleton.tsx';

type Item = Checklist['items'][number];

/** The kinds a list can be, in the order they're shown. Music, movies, series, books and games are
 *  their own kinds so they can be found together and copied out as clean text. */
const KINDS: { id: ListKind; label: string; emoji: string }[] = [
  { id: 'musica', label: 'Música', emoji: '🎵' },
  { id: 'peliculas', label: 'Películas', emoji: '🎬' },
  { id: 'series', label: 'Series', emoji: '📺' },
  { id: 'libros', label: 'Libros', emoji: '📚' },
  { id: 'juegos', label: 'Juegos', emoji: '🎮' },
  { id: 'compras', label: 'Compras', emoji: '🛒' },
  { id: 'general', label: 'Otras', emoji: '📋' },
];
const kindInfo = (kind: ListKind) => KINDS.find((k) => k.id === kind) ?? KINDS[KINDS.length - 1];

/** The list as clean text to paste anywhere: title, then one item per line. */
function asText(list: Checklist, items: Item[]): string {
  const pending = items.filter((i) => !i.checked).map((i) => `- ${i.title}`);
  const done = items.filter((i) => i.checked).map((i) => `- ${i.title}`);
  const lines = [`${kindInfo(list.kind).emoji} ${list.name}`];
  if (pending.length) lines.push('', ...(done.length ? ['Pendientes:'] : []), ...pending);
  if (done.length) lines.push('', 'Ya marcados:', ...done);
  return lines.join('\n');
}

/** One row of a list: a big tap target that checks/unchecks it, with remove on the side. */
function ItemRow({ item, onToggle, onRemove }: { item: Item; onToggle: () => void; onRemove: () => void }) {
  const checked = !!item.checked;
  return (
    <li className="group flex items-start gap-1">
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        onClick={onToggle}
        className="flex min-w-0 flex-1 items-start gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-gray-light focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/25 dark:hover:bg-white/5"
      >
        <span
          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition-colors ${
            checked ? 'border-success bg-success text-white' : 'border-gray-medium bg-white dark:border-white/25 dark:bg-transparent'
          }`}
          aria-hidden
        >
          {checked && <Check size={14} strokeWidth={3} />}
        </span>
        <span className={`min-w-0 text-sm leading-snug ${checked ? 'text-gray-dark line-through' : 'text-ink dark:text-white/90'}`}>{item.title}</span>
      </button>
      <IconButton
        label={`Quitar "${item.title}"`}
        onClick={onRemove}
        className="mt-0.5 h-8 w-8 shrink-0 opacity-0 hover:!bg-error/10 hover:!text-error focus-visible:opacity-100 group-hover:opacity-100"
      >
        <X size={15} />
      </IconButton>
    </li>
  );
}

function ListCard({ list, onChanged, onError }: { list: Checklist; onChanged: () => Promise<void>; onError: (m: string) => void }) {
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

export function ListsPage() {
  const api = useApi();
  const [lists, setLists] = useState<Checklist[] | null>(null);
  const [name, setName] = useState('');
  const [newKind, setNewKind] = useState<ListKind | 'auto'>('auto');
  const [filter, setFilter] = useState<ListKind | 'all'>('all');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLists(await api.get<Checklist[]>('/api/lists'));
      setError(null);
    } catch (e) {
      setError(errMsg(e));
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createList(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      await api.post('/api/lists', { name: name.trim(), ...(newKind === 'auto' ? {} : { kind: newKind }) });
      setName('');
      setNewKind('auto');
      await load();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setCreating(false);
    }
  }

  return (
    <Page
      title="Listas"
      eyebrow="Mi día"
      sticker="compras"
      description='Listas para ir marcando de a poco. Las de música, películas, series, libros y juegos tienen su propio tipo, y cualquiera se copia como texto para llevarla a otro lado. También por WhatsApp: "agrega Dune a mi lista de películas".'
    >
      {error && <Notice tone="error">{error}</Notice>}

      <Card className="mb-6 p-4">
        <form onSubmit={createList} className="flex flex-wrap gap-2">
          <div className="min-w-[12rem] flex-1">
            <Input placeholder="Nombre de una lista nueva (ej. Mercado)" aria-label="Nombre de la lista nueva" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <Select value={newKind} onChange={(e) => setNewKind(e.target.value as ListKind | 'auto')} className="!w-auto" aria-label="Tipo de la lista nueva">
            <option value="auto">Tipo: según el nombre</option>
            {KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.emoji} {k.label}
              </option>
            ))}
          </Select>
          <Button type="submit" disabled={!name.trim()} loading={creating}>
            <Plus size={16} /> Crear lista
          </Button>
        </form>
      </Card>

      {!lists && !error && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
      )}

      {lists?.length === 0 && <EmptyState sticker="compras" title="Sin listas todavía" description="Crea la primera arriba, o pídesela a Canix por WhatsApp." />}

      {lists && lists.length > 0 && (
        <Tabs
          tabs={[
            { id: 'all' as ListKind | 'all', label: 'Todas', count: lists.length },
            ...KINDS.filter((k) => lists.some((l) => l.kind === k.id)).map((k) => ({ id: k.id as ListKind | 'all', label: `${k.emoji} ${k.label}`, count: lists.filter((l) => l.kind === k.id).length })),
          ]}
          active={filter}
          onChange={setFilter}
        />
      )}

      <div className="grid items-start gap-4 lg:grid-cols-2">
        {lists
          ?.filter((l) => filter === 'all' || l.kind === filter)
          .map((l) => (
            <ListCard key={l.id} list={l} onChanged={load} onError={setError} />
          ))}
      </div>
    </Page>
  );
}
