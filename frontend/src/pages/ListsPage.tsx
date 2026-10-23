import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Plus } from 'lucide-react';
import { useApi, errMsg } from '../services/api.ts';
import type { Checklist, ListKind } from '../types/index.ts';
import { Page } from '../components/templates/Page.tsx';
import { Notice } from '../components/molecules/Notice.tsx';
import { Tabs } from '../components/molecules/Tabs.tsx';
import { Select } from '../components/atoms/Input.tsx';
import { Card } from '../components/atoms/Card.tsx';
import { Button } from '../components/atoms/Button.tsx';
import { Input } from '../components/atoms/Input.tsx';
import { EmptyState } from '../components/molecules/EmptyState.tsx';
import { Skeleton } from '../components/atoms/Skeleton.tsx';
import { ListCard } from '../components/organisms/lists/ListCard.tsx';
import { KINDS } from '../config/lists.ts';

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
