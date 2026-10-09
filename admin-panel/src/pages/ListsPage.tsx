import { useEffect, useState, type FormEvent } from 'react';
import { Plus, Trash2, ListChecks } from 'lucide-react';
import { useApi, errMsg } from '../lib/api.ts';
import type { Checklist } from '../lib/types.ts';
import { Page, Notice } from '../components/ui/Page.tsx';
import { Card } from '../components/ui/Card.tsx';
import { Button } from '../components/ui/Button.tsx';
import { Input } from '../components/ui/Input.tsx';
import { EmptyState } from '../components/ui/EmptyState.tsx';
import { useCreated } from '../components/ui/Created.tsx';

export function ListsPage() {
  const api = useApi();
  const created = useCreated();
  const [lists, setLists] = useState<Checklist[] | null>(null);
  const [name, setName] = useState('');
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);

  const load = () => api.get<Checklist[]>('/api/lists').then(setLists).catch((e) => setError(errMsg(e)));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = (p: Promise<unknown>) => p.then(load).catch((e) => setError(errMsg(e)));

  async function createList(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await run(api.post('/api/lists', { name }));
    created({ kind: 'Lista', title: name.trim(), section: 'lists', sticker: 'compras' });
    setName('');
  }

  async function addItem(listId: number, e: FormEvent) {
    e.preventDefault();
    const title = drafts[listId]?.trim();
    if (!title) return;
    await run(api.post(`/api/lists/${listId}/items`, { title }));
    setDrafts({ ...drafts, [listId]: '' });
  }

  return (
    <Page title="Listas" description="Listas para ir marcando de a poco: películas, libros, compras, juegos…">
      {error && <Notice tone="error">{error}</Notice>}
      <form onSubmit={createList} className="mb-5 flex gap-2">
        <Input placeholder="Nombre de una lista nueva" value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" disabled={!name.trim()}>
          <Plus size={16} /> Crear
        </Button>
      </form>
      {lists?.length === 0 && <EmptyState icon={<ListChecks />} title="Sin listas todavía" />}
      <div className="grid gap-4 sm:grid-cols-2">
        {lists?.map((l) => {
          const done = l.items.filter((i) => i.checked).length;
          return (
            <Card key={l.id} className="p-4">
              <div className="mb-2 flex items-center justify-between">
                <p className="font-display font-semibold text-ink dark:text-white">{l.name}</p>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-dark">
                    {done}/{l.items.length}
                  </span>
                  <button
                    className="rounded-lg p-1.5 text-gray-dark hover:bg-error/10 hover:text-error"
                    onClick={() => confirm(`¿Borrar la lista "${l.name}"?`) && run(api.del(`/api/lists/${l.id}`))}
                    aria-label="Borrar lista"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <ul className="space-y-1">
                {l.items.map((i) => (
                  <li key={i.id} className="group flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={!!i.checked} onChange={(e) => run(api.put(`/api/lists/items/${i.id}`, { checked: e.target.checked }))} />
                    <span className={i.checked ? 'text-gray-dark line-through' : 'text-ink dark:text-white/90'}>{i.title}</span>
                    <button className="ml-auto hidden text-gray-dark hover:text-error group-hover:block" onClick={() => run(api.del(`/api/lists/items/${i.id}`))} aria-label="Quitar">
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
              <form onSubmit={(e) => addItem(l.id, e)} className="mt-3 flex gap-2">
                <Input placeholder="Agregar…" value={drafts[l.id] ?? ''} onChange={(e) => setDrafts({ ...drafts, [l.id]: e.target.value })} />
              </form>
            </Card>
          );
        })}
      </div>
    </Page>
  );
}
