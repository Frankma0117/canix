import { useEffect, useState } from 'react';
import { Plus, Trash2, Trophy } from 'lucide-react';
import { useApi } from '../lib/api.ts';
import type { RewardPunishment, RewardPunishmentType, Todo } from '../lib/types.ts';
import { Card } from '../components/ui/Card.tsx';
import { Badge } from '../components/ui/Badge.tsx';
import { Button } from '../components/ui/Button.tsx';
import { Input, Label, Select, Textarea } from '../components/ui/Input.tsx';
import { Modal } from '../components/ui/Modal.tsx';
import { EmptyState } from '../components/ui/EmptyState.tsx';
import { Skeleton } from '../components/ui/Skeleton.tsx';

type Filter = 'all' | RewardPunishmentType;

export function RewardsPage() {
  const api = useApi();
  const [routines, setRoutines] = useState<Todo[]>([]);
  const [items, setItems] = useState<RewardPunishment[] | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [showForm, setShowForm] = useState(false);
  const [type, setType] = useState<RewardPunishmentType>('reward');
  const [description, setDescription] = useState('');
  const [note, setNote] = useState('');
  const [routineId, setRoutineId] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() {
    const [rts, list] = await Promise.all([
      api.get<Todo[]>('/api/todos?scope=routine'),
      api.get<RewardPunishment[]>(filter === 'all' ? '/api/rewards' : `/api/rewards?type=${filter}`),
    ]);
    setRoutines(rts);
    setItems(list);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  function routineName(id: number | null): string {
    return routines.find((r) => r.id === id)?.title ?? '';
  }

  async function handleCreate() {
    if (!description.trim()) return;
    setSaving(true);
    try {
      await api.post('/api/rewards', {
        type,
        description: description.trim(),
        note: note.trim() || null,
        todo_id: routineId ? Number(routineId) : null,
      });
      setDescription('');
      setNote('');
      setRoutineId('');
      setShowForm(false);
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm('¿Eliminar este registro?')) return;
    await api.del(`/api/rewards/${id}`);
    await load();
  }

  return (
    <div className="mx-auto max-w-3xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold text-ink dark:text-white">Premios y castigos</h1>
        <Button onClick={() => setShowForm(true)}>
          <Plus size={16} /> Registrar
        </Button>
      </div>

      <p className="mb-4 text-sm text-gray-dark">
        Los que te pones tú mismo por cumplir (o no) tus rutinas. Pídeselo al bot por WhatsApp o regístralos aquí.
      </p>

      <div className="mb-4 flex gap-2">
        {(['all', 'reward', 'punishment'] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-xl px-3 py-1.5 text-sm font-medium transition-colors ${
              filter === f
                ? 'bg-primary/10 text-primary-dark'
                : 'text-gray-dark hover:bg-gray-light dark:hover:bg-white/5'
            }`}
          >
            {f === 'all' ? 'Todos' : f === 'reward' ? '🏆 Premios' : '⚠️ Castigos'}
          </button>
        ))}
      </div>

      {!items && (
        <div className="space-y-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      )}

      {items && items.length === 0 && (
        <EmptyState
          icon={<Trophy />}
          title="Sin registros todavía"
          description="Ej. «me premio con salir a comer si cumplo la semana de ejercicio» — díselo al bot o regístralo aquí."
        />
      )}

      {items && items.length > 0 && (
        <div className="space-y-2">
          {items.map((i) => (
            <Card key={i.id} className="flex items-center justify-between gap-3 p-4">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-ink dark:text-white">{i.description}</p>
                <p className="text-xs text-gray-dark">
                  {i.date}
                  {routineName(i.todo_id) && ` · ${routineName(i.todo_id)}`}
                  {i.note && ` · ${i.note}`}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge tone={i.type === 'reward' ? 'success' : 'error'}>{i.type === 'reward' ? '🏆 Premio' : '⚠️ Castigo'}</Badge>
                <button
                  onClick={() => handleDelete(i.id)}
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
        <Modal title="Registrar premio o castigo" onClose={() => setShowForm(false)}>
          <div className="space-y-3">
            <div>
              <Label htmlFor="rp-type">Tipo</Label>
              <Select id="rp-type" value={type} onChange={(e) => setType(e.target.value as RewardPunishmentType)}>
                <option value="reward">🏆 Premio</option>
                <option value="punishment">⚠️ Castigo</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="rp-desc">Descripción</Label>
              <Input
                id="rp-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                autoFocus
                placeholder="Ej. Salir a comer"
              />
            </div>
            <div>
              <Label htmlFor="rp-routine">Rutina ligada (opcional)</Label>
              <Select id="rp-routine" value={routineId} onChange={(e) => setRoutineId(e.target.value)}>
                <option value="">(sin rutina)</option>
                {routines.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="rp-note">Nota (opcional)</Label>
              <Textarea id="rp-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
            </div>
            <Button className="w-full" onClick={handleCreate} disabled={saving || !description.trim()}>
              {saving ? 'Guardando…' : 'Registrar'}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
