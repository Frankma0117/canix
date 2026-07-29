import { useEffect, useState } from 'react';
import { Plus, Trash2, Check, ListTodo, Pencil } from 'lucide-react';
import { useApi } from '../lib/api.ts';
import type { Category, Todo, TodoScope } from '../lib/types.ts';
import { Card } from '../components/ui/Card.tsx';
import { Button } from '../components/ui/Button.tsx';
import { Input, Label, Select } from '../components/ui/Input.tsx';
import { Modal } from '../components/ui/Modal.tsx';
import { EmptyState } from '../components/ui/EmptyState.tsx';
import { Skeleton } from '../components/ui/Skeleton.tsx';

export function TodosPage({ scope, title }: { scope: TodoScope; title: string }) {
  const api = useApi();
  const [categories, setCategories] = useState<Category[]>([]);
  const [todos, setTodos] = useState<Todo[] | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Todo | null>(null);
  const [taskTitle, setTaskTitle] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() {
    const [cats, items] = await Promise.all([
      api.get<Category[]>('/api/categories'),
      api.get<Todo[]>(`/api/todos?scope=${scope}&status=${showDone ? 'done' : 'pending'}`),
    ]);
    setCategories(cats);
    setTodos(items);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, showDone]);

  function categoryName(id: number | null): string {
    return categories.find((c) => c.id === id)?.name ?? '';
  }

  async function handleCreate() {
    if (!taskTitle.trim()) return;
    setSaving(true);
    try {
      await api.post('/api/todos', {
        title: taskTitle.trim(),
        scope,
        category_id: categoryId ? Number(categoryId) : null,
        due_date: dueDate || undefined,
      });
      setTaskTitle('');
      setCategoryId('');
      setDueDate('');
      setShowForm(false);
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function handleComplete(id: number) {
    await api.post(`/api/todos/${id}/complete`);
    await load();
  }

  async function handleDelete(id: number) {
    if (!confirm('¿Eliminar esta tarea?')) return;
    await api.del(`/api/todos/${id}`);
    await load();
  }

  function openEdit(t: Todo) {
    setEditing(t);
    setTaskTitle(t.title);
    setCategoryId(t.category_id ? String(t.category_id) : '');
    setDueDate(t.due_date ?? '');
  }

  async function handleSaveEdit() {
    if (!editing || !taskTitle.trim()) return;
    setSaving(true);
    try {
      await api.put(`/api/todos/${editing.id}`, {
        title: taskTitle.trim(),
        category_id: categoryId ? Number(categoryId) : null,
        due_date: dueDate || null,
      });
      setEditing(null);
      setTaskTitle('');
      setCategoryId('');
      setDueDate('');
      await load();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold text-ink dark:text-white">{title}</h1>
        <div className="flex items-center gap-2">
          <Button variant={showDone ? 'primary' : 'secondary'} onClick={() => setShowDone((v) => !v)}>
            {showDone ? 'Ver pendientes' : 'Ver hechas'}
          </Button>
          <Button onClick={() => setShowForm(true)}>
            <Plus size={16} /> Nueva tarea
          </Button>
        </div>
      </div>

      {!todos && (
        <div className="space-y-3">
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </div>
      )}

      {todos && todos.length === 0 && (
        <EmptyState
          icon={<ListTodo />}
          title={showDone ? 'Nada marcado como hecho todavía' : '¡Sin pendientes!'}
          description={showDone ? undefined : 'Agrega una tarea aquí o pídesela al bot por WhatsApp.'}
        />
      )}

      {todos && todos.length > 0 && (
        <div className="space-y-2">
          {todos.map((t) => (
            <Card key={t.id} className="flex items-center justify-between gap-3 p-4">
              <div className="min-w-0 flex-1">
                <p className={`font-medium text-ink dark:text-white ${t.status === 'done' ? 'line-through opacity-60' : ''}`}>
                  {t.title}
                </p>
                <p className="text-xs text-gray-dark">
                  {[categoryName(t.category_id), t.due_date].filter(Boolean).join(' · ')}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {t.status !== 'done' && (
                  <button
                    onClick={() => handleComplete(t.id)}
                    className="rounded-lg p-2 text-gray-dark hover:bg-success/10 hover:text-success"
                    aria-label="Completar"
                  >
                    <Check size={16} />
                  </button>
                )}
                <button
                  onClick={() => openEdit(t)}
                  className="rounded-lg p-2 text-gray-dark hover:bg-gray-medium/60 dark:hover:bg-white/10"
                  aria-label="Editar"
                >
                  <Pencil size={16} />
                </button>
                <button
                  onClick={() => handleDelete(t.id)}
                  className="rounded-lg p-2 text-gray-dark hover:bg-error/10 hover:text-error"
                  aria-label="Eliminar"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {showForm && (
        <Modal title="Nueva tarea" onClose={() => setShowForm(false)}>
          <div className="space-y-3">
            <div>
              <Label htmlFor="todo-title">Qué hay que hacer</Label>
              <Input id="todo-title" value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} autoFocus />
            </div>
            <div>
              <Label htmlFor="todo-cat">Categoría (opcional)</Label>
              <Select id="todo-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">(sin categoría)</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="todo-date">Fecha (opcional)</Label>
              <Input id="todo-date" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            <Button className="w-full" onClick={handleCreate} disabled={saving || !taskTitle.trim()}>
              {saving ? 'Guardando…' : 'Crear tarea'}
            </Button>
          </div>
        </Modal>
      )}

      {editing && (
        <Modal title="Editar tarea" onClose={() => setEditing(null)}>
          <div className="space-y-3">
            <div>
              <Label htmlFor="todo-edit-title">Qué hay que hacer</Label>
              <Input id="todo-edit-title" value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} autoFocus />
            </div>
            <div>
              <Label htmlFor="todo-edit-cat">Categoría (opcional)</Label>
              <Select id="todo-edit-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">(sin categoría)</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="todo-edit-date">Fecha (opcional)</Label>
              <Input id="todo-edit-date" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            <Button className="w-full" onClick={handleSaveEdit} disabled={saving || !taskTitle.trim()}>
              {saving ? 'Guardando…' : 'Guardar cambios'}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
