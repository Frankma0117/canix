import { useEffect, useState } from 'react';
import { Plus, Trash2, Pencil, StickyNote } from 'lucide-react';
import { useApi, errMsg } from '../lib/api.ts';
import type { Note } from '../lib/types.ts';
import { Page, Notice } from '../components/ui/Page.tsx';
import { Card } from '../components/ui/Card.tsx';
import { Button } from '../components/ui/Button.tsx';
import { Input, Textarea, Label } from '../components/ui/Input.tsx';
import { Modal } from '../components/ui/Modal.tsx';
import { EmptyState } from '../components/ui/EmptyState.tsx';
import { Skeleton } from '../components/ui/Skeleton.tsx';

export function NotesPage() {
  const api = useApi();
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Partial<Note> | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load(query = q) {
    try {
      setNotes(await api.get<Note[]>(`/api/notes${query ? `?q=${encodeURIComponent(query)}` : ''}`));
    } catch (err) {
      setError(errMsg(err));
    }
  }
  useEffect(() => {
    const t = setTimeout(() => load(q), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  async function save() {
    if (!editing?.content?.trim()) return;
    try {
      if (editing.id) await api.put(`/api/notes/${editing.id}`, { title: editing.title ?? null, content: editing.content });
      else await api.post('/api/notes', { title: editing.title ?? null, content: editing.content });
      setEditing(null);
      await load();
    } catch (err) {
      setError(errMsg(err));
    }
  }

  async function remove(id: number) {
    if (!confirm('¿Borrar esta nota?')) return;
    await api.del(`/api/notes/${id}`).catch((e) => setError(errMsg(e)));
    await load();
  }

  return (
    <Page
      title="Notas"
      actions={
        <Button onClick={() => setEditing({ title: '', content: '' })}>
          <Plus size={16} /> Nueva nota
        </Button>
      }
    >
      {error && <Notice tone="error">{error}</Notice>}
      <Input placeholder="Buscar en tus notas…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="mt-4 space-y-2">
        {!notes && <Skeleton className="h-20" />}
        {notes?.length === 0 && <EmptyState icon={<StickyNote />} title="Sin notas" description="Crea una aquí o pídele al bot: 'anota que…'" />}
        {notes?.map((n) => (
          <Card key={n.id} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                {n.title && <p className="font-medium text-ink dark:text-white">{n.title}</p>}
                <p className="whitespace-pre-wrap text-sm text-ink/80 dark:text-white/70">{n.content}</p>
                <p className="mt-1 text-xs text-gray-dark">{n.created_at.slice(0, 16)}</p>
              </div>
              <div className="flex shrink-0 gap-1">
                <button className="rounded-lg p-2 text-gray-dark hover:bg-gray-medium/60" onClick={() => setEditing(n)} aria-label="Editar">
                  <Pencil size={15} />
                </button>
                <button className="rounded-lg p-2 text-gray-dark hover:bg-error/10 hover:text-error" onClick={() => remove(n.id)} aria-label="Borrar">
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {editing && (
        <Modal title={editing.id ? 'Editar nota' : 'Nueva nota'} onClose={() => setEditing(null)} size="md">
          <Label>Título (opcional)</Label>
          <Input value={editing.title ?? ''} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
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
