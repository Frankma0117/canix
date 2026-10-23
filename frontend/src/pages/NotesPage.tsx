import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Pencil, StickyNote, Search } from 'lucide-react';
import { useApi, errMsg } from '../services/api.ts';
import type { Category, Note } from '../types/index.ts';
import { Page } from '../components/templates/Page.tsx';
import { Notice } from '../components/molecules/Notice.tsx';
import { EmptyState } from '../components/molecules/EmptyState.tsx';
import { Button } from '../components/atoms/Button.tsx';
import { Input, Textarea, Label, Select } from '../components/atoms/Input.tsx';
import { Skeleton } from '../components/atoms/Skeleton.tsx';
import { Modal } from '../components/organisms/Modal.tsx';
import { GroupedTable, type Column } from '../components/organisms/GroupedTable.tsx';
import { formatMonth } from '../utils/dates.ts';

type Grouping = 'category' | 'month' | 'none';

/**
 * Notes as a table grouped the way the person wants - by category (default), by month, or not at
 * all - with search over title and content. Notes about a movie or a song also show up next to it
 * in the Library.
 */
export function NotesPage() {
  const api = useApi();
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [q, setQ] = useState('');
  const [grouping, setGrouping] = useState<Grouping>('category');
  const [editing, setEditing] = useState<Partial<Note> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (query: string) => {
      try {
        setNotes(await api.get<Note[]>(`/api/notes${query ? `?q=${encodeURIComponent(query)}` : ''}`));
      } catch (err) {
        setError(errMsg(err));
      }
    },
    [api],
  );
  useEffect(() => {
    const t = setTimeout(() => void load(q), 250);
    return () => clearTimeout(t);
  }, [q, load]);
  useEffect(() => {
    api.get<Category[]>('/api/categories').then(setCategories, () => setCategories([]));
  }, [api]);

  const categoryName = useCallback((id: number | null) => categories.find((c) => c.id === id)?.name ?? 'Sin categoría', [categories]);
  const groupOf = useCallback(
    (n: Note) => (grouping === 'month' ? formatMonth(n.created_at.slice(0, 10)) : categoryName(n.category_id)),
    [grouping, categoryName],
  );
  const rows = useMemo(
    () => [...(notes ?? [])].sort((a, b) => (grouping === 'none' ? 0 : groupOf(a).localeCompare(groupOf(b))) || b.created_at.localeCompare(a.created_at)),
    [notes, grouping, groupOf],
  );

  async function save() {
    if (!editing?.content?.trim()) return;
    const body = { title: editing.title?.trim() || null, content: editing.content, category_id: editing.category_id ?? null };
    try {
      if (editing.id) await api.put(`/api/notes/${editing.id}`, body);
      else await api.post('/api/notes', body);
      setEditing(null);
      await load(q);
    } catch (err) {
      setError(errMsg(err));
    }
  }

  async function remove(id: number) {
    if (!confirm('¿Borrar esta nota?')) return;
    await api.del(`/api/notes/${id}`).catch((e) => setError(errMsg(e)));
    await load(q);
  }

  const columns: Column<Note>[] = [
    {
      key: 'note',
      header: 'Nota',
      render: (n) => (
        <div className="min-w-0">
          {n.title && <p className="font-semibold text-ink dark:text-white">{n.title}</p>}
          <p className="line-clamp-3 whitespace-pre-wrap text-sm text-ink/80 dark:text-white/70">{n.content}</p>
          <p className="mt-0.5 text-xs text-gray-dark md:hidden">{categoryName(n.category_id)}</p>
        </div>
      ),
    },
    { key: 'category', header: 'Categoría', hideOnMobile: true, className: 'w-40', render: (n) => <span className="text-xs text-gray-dark">{categoryName(n.category_id)}</span> },
    { key: 'date', header: 'Fecha', hideOnMobile: true, className: 'w-32', render: (n) => <span className="text-xs text-gray-dark">{n.created_at.slice(0, 10)}</span> },
    {
      key: 'actions',
      header: '',
      className: 'w-24 text-right',
      render: (n) => (
        <div className="flex justify-end gap-0.5">
          <button className="rounded-lg p-2 text-gray-dark hover:bg-gray-medium/60" onClick={() => setEditing(n)} aria-label="Editar">
            <Pencil size={15} />
          </button>
          <button className="rounded-lg p-2 text-gray-dark hover:bg-error/10 hover:text-error" onClick={() => remove(n.id)} aria-label="Borrar">
            <Trash2 size={15} />
          </button>
        </div>
      ),
    },
  ];

  return (
    <Page
      title="Notas"
      wide
      actions={
        <Button onClick={() => setEditing({ title: '', content: '', category_id: null })}>
          <Plus size={16} /> Nueva nota
        </Button>
      }
    >
      {error && <Notice tone="error">{error}</Notice>}
      <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_auto]">
        <Input icon={<Search size={16} />} placeholder="Buscar en tus notas…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select value={grouping} onChange={(e) => setGrouping(e.target.value as Grouping)} aria-label="Agrupar">
          <option value="category">Por categoría</option>
          <option value="month">Por mes</option>
          <option value="none">Sin agrupar</option>
        </Select>
      </div>
      {!notes && <Skeleton className="h-40" />}
      {notes?.length === 0 && <EmptyState icon={<StickyNote />} title="Sin notas" description="Crea una aquí o pídele al bot: 'anota que…'" />}
      {!!notes?.length && <GroupedTable rows={rows} columns={columns} rowKey={(n) => n.id} groupOf={grouping === 'none' ? undefined : groupOf} />}

      {editing && (
        <Modal title={editing.id ? 'Editar nota' : 'Nueva nota'} onClose={() => setEditing(null)} size="md">
          <Label>Título (opcional)</Label>
          <Input value={editing.title ?? ''} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
          <div className="h-3" />
          <Label>Categoría</Label>
          <Select value={editing.category_id ?? ''} onChange={(e) => setEditing({ ...editing, category_id: e.target.value ? Number(e.target.value) : null })}>
            <option value="">Sin categoría</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <div className="h-3" />
          <Label>Contenido</Label>
          <Textarea rows={8} value={editing.content ?? ''} onChange={(e) => setEditing({ ...editing, content: e.target.value })} />
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancelar
            </Button>
            <Button onClick={save} disabled={!editing.content?.trim()}>
              Guardar
            </Button>
          </div>
        </Modal>
      )}
    </Page>
  );
}
