import { useEffect, useState } from 'react';
import { Plus, Trash2, Repeat, Flame, Pencil } from 'lucide-react';
import { useApi } from '../lib/api.ts';
import type { Category, HabitLog, Todo } from '../lib/types.ts';
import { Card } from '../components/ui/Card.tsx';
import { Button } from '../components/ui/Button.tsx';
import { Input, Label, Select } from '../components/ui/Input.tsx';
import { Modal } from '../components/ui/Modal.tsx';
import { EmptyState } from '../components/ui/EmptyState.tsx';
import { Skeleton } from '../components/ui/Skeleton.tsx';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function RoutineRow({
  routine,
  categoryName,
  onDeleted,
  onEdit,
}: {
  routine: Todo;
  categoryName: string;
  onDeleted: () => void;
  onEdit: (r: Todo) => void;
}) {
  const api = useApi();
  const [streak, setStreak] = useState<number | null>(null);
  const [checkedToday, setCheckedToday] = useState<boolean | null>(null);

  async function loadHistory() {
    const data = await api.get<{ history: HabitLog[]; streak: number }>(`/api/todos/${routine.id}/history?days=30`);
    setStreak(data.streak);
    setCheckedToday(data.history.some((h) => h.log_date === todayIso() && h.done === 1));
  }

  useEffect(() => {
    loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routine.id]);

  async function checkIn() {
    await api.post(`/api/todos/${routine.id}/checkin`, { date: todayIso(), done: true });
    await loadHistory();
  }

  async function handleDelete() {
    if (!confirm(`¿Eliminar la rutina "${routine.title}"? Se borra también su historial.`)) return;
    await api.del(`/api/todos/${routine.id}`);
    onDeleted();
  }

  return (
    <Card className="flex items-center justify-between gap-3 p-4">
      <div className="min-w-0 flex-1">
        <p className="font-medium text-ink dark:text-white">{routine.title}</p>
        <p className="flex items-center gap-1 text-xs text-gray-dark">
          {categoryName && `${categoryName} · `}
          {routine.recurrence_freq === 'weekly' ? 'Semanal' : 'Diaria'}
          {routine.reminder_time && ` · ⏰${routine.reminder_time} (${routine.duration_minutes}min)`}
          {streak !== null && (
            <span className="ml-1 inline-flex items-center gap-0.5 text-warning">
              <Flame size={12} /> {streak}
            </span>
          )}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button variant={checkedToday ? 'secondary' : 'primary'} onClick={checkIn} disabled={Boolean(checkedToday)}>
          {checkedToday ? 'Hecho hoy ✅' : 'Marcar hoy'}
        </Button>
        <button
          onClick={() => onEdit(routine)}
          className="rounded-lg p-2 text-gray-dark hover:bg-gray-medium/60 dark:hover:bg-white/10"
          aria-label="Editar"
        >
          <Pencil size={16} />
        </button>
        <button onClick={handleDelete} className="rounded-lg p-2 text-gray-dark hover:bg-error/10 hover:text-error" aria-label="Eliminar">
          <Trash2 size={16} />
        </button>
      </div>
    </Card>
  );
}

export function RoutinesPage() {
  const api = useApi();
  const [categories, setCategories] = useState<Category[]>([]);
  const [routines, setRoutines] = useState<Todo[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Todo | null>(null);
  const [title, setTitle] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [frequency, setFrequency] = useState<'daily' | 'weekly'>('daily');
  const [reminderTime, setReminderTime] = useState('08:00');
  const [durationMinutes, setDurationMinutes] = useState('30');
  const [saving, setSaving] = useState(false);

  async function load() {
    const [cats, items] = await Promise.all([
      api.get<Category[]>('/api/categories'),
      api.get<Todo[]>('/api/todos?scope=routine'),
    ]);
    setCategories(cats);
    setRoutines(items);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function categoryName(id: number | null): string {
    return categories.find((c) => c.id === id)?.name ?? '';
  }

  const durationValid = Number(durationMinutes) > 0;

  async function handleCreate() {
    if (!title.trim() || !reminderTime || !durationValid) return;
    setSaving(true);
    try {
      await api.post('/api/todos', {
        title: title.trim(),
        scope: 'routine',
        category_id: categoryId ? Number(categoryId) : null,
        recurrence_freq: frequency,
        reminder_time: reminderTime,
        duration_minutes: Number(durationMinutes),
      });
      setTitle('');
      setCategoryId('');
      setReminderTime('08:00');
      setDurationMinutes('30');
      setShowForm(false);
      await load();
    } finally {
      setSaving(false);
    }
  }

  function openEdit(r: Todo) {
    setEditing(r);
    setTitle(r.title);
    setCategoryId(r.category_id ? String(r.category_id) : '');
    setFrequency(r.recurrence_freq === 'weekly' ? 'weekly' : 'daily');
    setReminderTime(r.reminder_time ?? '08:00');
    setDurationMinutes(r.duration_minutes ? String(r.duration_minutes) : '30');
  }

  async function handleSaveEdit() {
    if (!editing || !title.trim() || !reminderTime || !durationValid) return;
    setSaving(true);
    try {
      await api.put(`/api/todos/${editing.id}`, {
        title: title.trim(),
        category_id: categoryId ? Number(categoryId) : null,
        recurrence_freq: frequency,
        reminder_time: reminderTime,
        duration_minutes: Number(durationMinutes),
      });
      setEditing(null);
      setTitle('');
      setCategoryId('');
      setReminderTime('08:00');
      setDurationMinutes('30');
      await load();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold text-ink dark:text-white">Rutinas y hábitos</h1>
        <Button onClick={() => setShowForm(true)}>
          <Plus size={16} /> Nueva rutina
        </Button>
      </div>

      {!routines && (
        <div className="space-y-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      )}

      {routines && routines.length === 0 && (
        <EmptyState
          icon={<Repeat />}
          title="Sin rutinas todavía"
          description="Ej. ejercicio, leer 20 minutos — hazle seguimiento diario aquí o por WhatsApp."
        />
      )}

      {routines && routines.length > 0 && (
        <div className="space-y-2">
          {routines.map((r) => (
            <RoutineRow key={r.id} routine={r} categoryName={categoryName(r.category_id)} onDeleted={load} onEdit={openEdit} />
          ))}
        </div>
      )}

      {showForm && (
        <Modal title="Nueva rutina" onClose={() => setShowForm(false)}>
          <div className="space-y-3">
            <div>
              <Label htmlFor="routine-title">Nombre</Label>
              <Input id="routine-title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus placeholder="Ej. Ejercicio" />
            </div>
            <div>
              <Label htmlFor="routine-cat">Categoría (opcional)</Label>
              <Select id="routine-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">(sin categoría)</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="routine-freq">Frecuencia</Label>
              <Select id="routine-freq" value={frequency} onChange={(e) => setFrequency(e.target.value as 'daily' | 'weekly')}>
                <option value="daily">Diaria</option>
                <option value="weekly">Semanal</option>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="routine-time">Hora de aviso</Label>
                <Input
                  id="routine-time"
                  type="time"
                  value={reminderTime}
                  onChange={(e) => setReminderTime(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="routine-duration">Duración (min)</Label>
                <Input
                  id="routine-duration"
                  type="number"
                  min={1}
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(e.target.value)}
                />
              </div>
            </div>
            <p className="text-xs text-gray-dark">
              El bot avisa a la hora elegida y, al pasar la duración, pregunta si cumpliste.
            </p>
            <Button className="w-full" onClick={handleCreate} disabled={saving || !title.trim() || !reminderTime || !durationValid}>
              {saving ? 'Guardando…' : 'Crear rutina'}
            </Button>
          </div>
        </Modal>
      )}

      {editing && (
        <Modal title="Editar rutina" onClose={() => setEditing(null)}>
          <div className="space-y-3">
            <div>
              <Label htmlFor="routine-edit-title">Nombre</Label>
              <Input id="routine-edit-title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
            </div>
            <div>
              <Label htmlFor="routine-edit-cat">Categoría (opcional)</Label>
              <Select id="routine-edit-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">(sin categoría)</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="routine-edit-freq">Frecuencia</Label>
              <Select id="routine-edit-freq" value={frequency} onChange={(e) => setFrequency(e.target.value as 'daily' | 'weekly')}>
                <option value="daily">Diaria</option>
                <option value="weekly">Semanal</option>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="routine-edit-time">Hora de aviso</Label>
                <Input
                  id="routine-edit-time"
                  type="time"
                  value={reminderTime}
                  onChange={(e) => setReminderTime(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="routine-edit-duration">Duración (min)</Label>
                <Input
                  id="routine-edit-duration"
                  type="number"
                  min={1}
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(e.target.value)}
                />
              </div>
            </div>
            <Button className="w-full" onClick={handleSaveEdit} disabled={saving || !title.trim() || !reminderTime || !durationValid}>
              {saving ? 'Guardando…' : 'Guardar cambios'}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
