import { useEffect, useState } from 'react';
import { Plus, Trash2, Link2, Shuffle } from 'lucide-react';
import { useApi } from '../lib/api.ts';
import type { Category, Link } from '../lib/types.ts';
import { Card } from '../components/ui/Card.tsx';
import { Button } from '../components/ui/Button.tsx';
import { Input, Label, Select, Textarea } from '../components/ui/Input.tsx';
import { Modal } from '../components/ui/Modal.tsx';
import { EmptyState } from '../components/ui/EmptyState.tsx';
import { Skeleton } from '../components/ui/Skeleton.tsx';

export function LinksPage() {
  const api = useApi();
  const [categories, setCategories] = useState<Category[]>([]);
  const [links, setLinks] = useState<Link[] | null>(null);
  const [filterCategory, setFilterCategory] = useState<string>('');
  const [showForm, setShowForm] = useState(false);
  const [url, setUrl] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [suggestion, setSuggestion] = useState<Link | null>(null);

  async function load() {
    const [cats, allLinks] = await Promise.all([
      api.get<Category[]>('/api/categories'),
      api.get<Link[]>(filterCategory ? `/api/links?categoryId=${filterCategory}` : '/api/links'),
    ]);
    setCategories(cats);
    setLinks(allLinks);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterCategory]);

  function categoryName(id: number | null): string {
    return categories.find((c) => c.id === id)?.name ?? '(sin categoría)';
  }

  async function handleCreate() {
    if (!url.trim()) return;
    setSaving(true);
    try {
      await api.post('/api/links', {
        url: url.trim(),
        category_id: categoryId ? Number(categoryId) : null,
        title: title.trim() || undefined,
        description: description.trim() || undefined,
      });
      setUrl('');
      setTitle('');
      setDescription('');
      setShowForm(false);
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm('¿Eliminar este link?')) return;
    await api.del(`/api/links/${id}`);
    await load();
  }

  async function pickRandom() {
    if (!filterCategory) return;
    const candidates = links?.filter((l) => l.category_id === Number(filterCategory)) ?? [];
    if (candidates.length === 0) return;
    setSuggestion(candidates[Math.floor(Math.random() * candidates.length)]);
  }

  return (
    <div className="mx-auto max-w-4xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold text-ink dark:text-white">Links</h1>
        <Button onClick={() => setShowForm(true)}>
          <Plus size={16} /> Nuevo link
        </Button>
      </div>

      <div className="mb-4 flex items-center gap-3">
        <Select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} className="max-w-xs">
          <option value="">Todas las categorías</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        {filterCategory && (
          <Button variant="secondary" onClick={pickRandom}>
            <Shuffle size={16} /> Sugerir uno
          </Button>
        )}
      </div>

      {suggestion && (
        <Card className="mb-4 flex items-center justify-between p-4 border-primary/40 bg-primary/5">
          <div>
            <p className="text-sm text-gray-dark">Sugerencia:</p>
            <a href={suggestion.url} target="_blank" rel="noreferrer" className="font-medium text-primary-dark underline">
              {suggestion.title || suggestion.description || suggestion.url}
            </a>
          </div>
          <button onClick={() => setSuggestion(null)} className="text-gray-dark hover:text-ink">✕</button>
        </Card>
      )}

      {!links && (
        <div className="space-y-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      )}

      {links && links.length === 0 && (
        <EmptyState
          icon={<Link2 />}
          title="Sin links todavía"
          description="Envíale un link al bot por WhatsApp y te preguntará cómo clasificarlo, o agrégalo aquí."
        />
      )}

      {links && links.length > 0 && (
        <div className="space-y-2">
          {links.map((l) => (
            <Card key={l.id} className="flex items-center justify-between gap-4 p-4">
              <div className="min-w-0 flex-1">
                <a href={l.url} target="_blank" rel="noreferrer" className="truncate font-medium text-primary-dark underline">
                  {l.title || l.url}
                </a>
                {l.description && <p className="text-sm text-gray-dark">{l.description}</p>}
                <p className="mt-1 text-xs text-gray-dark">
                  {categoryName(l.category_id)} · usado {l.used_count}x
                </p>
              </div>
              <button
                onClick={() => handleDelete(l.id)}
                className="shrink-0 rounded-lg p-2 text-gray-dark hover:bg-error/10 hover:text-error"
                aria-label="Eliminar"
              >
                <Trash2 size={16} />
              </button>
            </Card>
          ))}
        </div>
      )}

      {showForm && (
        <Modal title="Nuevo link" onClose={() => setShowForm(false)}>
          <div className="space-y-3">
            <div>
              <Label htmlFor="link-url">URL</Label>
              <Input id="link-url" value={url} onChange={(e) => setUrl(e.target.value)} autoFocus placeholder="https://..." />
            </div>
            <div>
              <Label htmlFor="link-cat">Categoría</Label>
              <Select id="link-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">(sin categoría)</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="link-title">Título (opcional)</Label>
              <Input id="link-title" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="link-desc">Descripción (opcional)</Label>
              <Textarea id="link-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <Button className="w-full" onClick={handleCreate} disabled={saving || !url.trim()}>
              {saving ? 'Guardando…' : 'Guardar link'}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
