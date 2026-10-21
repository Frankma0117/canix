import { useEffect, useState } from 'react';
import { Plus, Trash2, Tags } from 'lucide-react';
import { useApi } from '../lib/api.ts';
import type { Category } from '../lib/types.ts';
import { Card } from '../components/ui/Card.tsx';
import { Button } from '../components/ui/Button.tsx';
import { Input, Label, Textarea } from '../components/ui/Input.tsx';
import { Modal } from '../components/ui/Modal.tsx';
import { EmptyState } from '../components/ui/EmptyState.tsx';
import { Skeleton } from '../components/ui/Skeleton.tsx';
import { Badge } from '../components/ui/Badge.tsx';

function usageChips(c: Category): string[] {
  const u = c.usage;
  if (!u) return [];
  const chip = (n: number, one: string, many: string, icon: string) => (n ? `${icon} ${n} ${n === 1 ? one : many}` : '');
  return [
    chip(u.links, 'link', 'links', '🔗'),
    chip(u.notes, 'nota', 'notas', '💡'),
    chip(u.reminders, 'recordatorio', 'recordatorios', '⏰'),
    chip(u.todos, 'tarea', 'tareas', '✅'),
    chip(u.recipes, 'receta', 'recetas', '📖'),
  ].filter(Boolean);
}

export function CategoriesPage() {
  const api = useApi();
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() {
    setCategories(await api.get<Category[]>('/api/categories'));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await api.post('/api/categories', { name: name.trim(), description: description.trim() || undefined });
      setName('');
      setDescription('');
      setShowForm(false);
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm('¿Eliminar esta categoría? Lo que tenga (links, notas, recordatorios, tareas, recetas) quedará sin categoría, no se borra.')) return;
    await api.del(`/api/categories/${id}`);
    await load();
  }

  return (
    <div className="mx-auto max-w-3xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold text-ink dark:text-white">Categorías</h1>
        <Button onClick={() => setShowForm(true)}>
          <Plus size={16} /> Nueva categoría
        </Button>
      </div>
      <p className="-mt-3 mb-6 text-sm text-gray-dark">
        Son generales: una misma categoría (por ejemplo “Salud”) agrupa tus links, notas, recordatorios, tareas y recetas.
      </p>

      {!categories && (
        <div className="space-y-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      )}

      {categories && categories.length === 0 && (
        <EmptyState
          icon={<Tags />}
          title="Sin categorías todavía"
          description="Créalas aquí o pídele al bot que cree una nueva por WhatsApp."
        />
      )}

      {categories && categories.length > 0 && (
        <div className="space-y-2">
          {categories.map((c) => (
            <Card key={c.id} className="flex items-center justify-between p-4">
              <div>
                <p className="font-medium text-ink dark:text-white">{c.name}</p>
                {c.description && <p className="text-sm text-gray-dark">{c.description}</p>}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {usageChips(c).length === 0 ? <Badge tone="neutral">Vacía</Badge> : usageChips(c).map((chip) => <Badge key={chip} tone="neutral">{chip}</Badge>)}
                </div>
              </div>
              <button
                onClick={() => handleDelete(c.id)}
                className="rounded-lg p-2 text-gray-dark hover:bg-error/10 hover:text-error"
                aria-label="Eliminar"
              >
                <Trash2 size={16} />
              </button>
            </Card>
          ))}
        </div>
      )}

      {showForm && (
        <Modal title="Nueva categoría" onClose={() => setShowForm(false)}>
          <div className="space-y-3">
            <div>
              <Label htmlFor="cat-name">Nombre</Label>
              <Input id="cat-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </div>
            <div>
              <Label htmlFor="cat-desc">Descripción (opcional)</Label>
              <Textarea id="cat-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <Button className="w-full" onClick={handleCreate} disabled={saving || !name.trim()}>
              {saving ? 'Guardando…' : 'Crear categoría'}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
