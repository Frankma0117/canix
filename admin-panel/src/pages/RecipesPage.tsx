import { useEffect, useState } from 'react';
import { Plus, Trash2, BookOpen } from 'lucide-react';
import { useApi, errMsg } from '../lib/api.ts';
import type { Recipe } from '../lib/types.ts';
import { Page, Notice } from '../components/ui/Page.tsx';
import { Card } from '../components/ui/Card.tsx';
import { Button } from '../components/ui/Button.tsx';
import { Input, Label, Textarea } from '../components/ui/Input.tsx';
import { Modal } from '../components/ui/Modal.tsx';
import { EmptyState } from '../components/ui/EmptyState.tsx';

export function RecipesPage() {
  const api = useApi();
  const [recipes, setRecipes] = useState<Recipe[] | null>(null);
  const [open, setOpen] = useState<Recipe | null>(null);
  const [draft, setDraft] = useState<{ title: string; ingredients: string; instructions: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => api.get<Recipe[]>('/api/recipes').then(setRecipes).catch((e) => setError(errMsg(e)));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    if (!draft?.title.trim()) return;
    try {
      await api.post('/api/recipes', draft);
      setDraft(null);
      await load();
    } catch (e) {
      setError(errMsg(e));
    }
  }

  return (
    <Page
      title="Recetas"
      actions={
        <Button onClick={() => setDraft({ title: '', ingredients: '', instructions: '' })}>
          <Plus size={16} /> Nueva receta
        </Button>
      }
      description="Tip: escríbele al bot los ingredientes que tienes y te sugiere qué cocinar."
    >
      {error && <Notice tone="error">{error}</Notice>}
      {recipes?.length === 0 && <EmptyState icon={<BookOpen />} title="Sin recetas guardadas" />}
      <div className="grid gap-3 sm:grid-cols-2">
        {recipes?.map((r) => (
          <Card key={r.id} className="cursor-pointer p-4 hover:border-primary/50" onClick={() => setOpen(r)}>
            <p className="font-medium text-ink dark:text-white">{r.title}</p>
            <p className="mt-1 line-clamp-2 text-sm text-gray-dark">{r.ingredients}</p>
          </Card>
        ))}
      </div>

      {open && (
        <Modal title={open.title} onClose={() => setOpen(null)} size="md">
          <p className="text-sm font-medium text-ink dark:text-white">Ingredientes</p>
          <p className="mb-3 whitespace-pre-wrap text-sm text-ink/80 dark:text-white/70">{open.ingredients || '—'}</p>
          <p className="text-sm font-medium text-ink dark:text-white">Preparación</p>
          <p className="whitespace-pre-wrap text-sm text-ink/80 dark:text-white/70">{open.instructions || '—'}</p>
          <div className="mt-4 flex justify-end">
            <Button
              variant="danger"
              onClick={async () => {
                if (!confirm('¿Borrar esta receta?')) return;
                await api.del(`/api/recipes/${open.id}`).catch((e) => setError(errMsg(e)));
                setOpen(null);
                await load();
              }}
            >
              <Trash2 size={15} /> Borrar
            </Button>
          </div>
        </Modal>
      )}

      {draft && (
        <Modal title="Nueva receta" onClose={() => setDraft(null)} size="md">
          <Label>Título</Label>
          <Input autoFocus value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          <div className="h-3" />
          <Label>Ingredientes</Label>
          <Textarea rows={5} value={draft.ingredients} onChange={(e) => setDraft({ ...draft, ingredients: e.target.value })} />
          <div className="h-3" />
          <Label>Preparación</Label>
          <Textarea rows={6} value={draft.instructions} onChange={(e) => setDraft({ ...draft, instructions: e.target.value })} />
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDraft(null)}>
              Cancelar
            </Button>
            <Button onClick={save} disabled={!draft.title.trim()}>
              Guardar
            </Button>
          </div>
        </Modal>
      )}
    </Page>
  );
}
