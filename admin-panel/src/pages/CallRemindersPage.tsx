import { useEffect, useState } from 'react';
import { Plus, Trash2, X, Pencil, PhoneCall, PhoneOutgoing } from 'lucide-react';
import { useApi, ApiError } from '../lib/api.ts';
import type { CallReminder, CallReminderStatus, CallReminderType, RecurrenceFreq } from '../lib/types.ts';
import { Card } from '../components/ui/Card.tsx';
import { Button } from '../components/ui/Button.tsx';
import { Badge } from '../components/ui/Badge.tsx';
import { Input, Label, Select, Textarea } from '../components/ui/Input.tsx';
import { Modal } from '../components/ui/Modal.tsx';
import { EmptyState } from '../components/ui/EmptyState.tsx';
import { Skeleton } from '../components/ui/Skeleton.tsx';

const STATUS_TONE: Record<CallReminderStatus, 'success' | 'warning' | 'error' | 'neutral' | 'info'> = {
  pending: 'warning',
  processing: 'info',
  completed: 'success',
  failed: 'error',
  cancelled: 'neutral',
};

const TYPE_LABEL: Record<CallReminderType, string> = { reminder: '📞 Recordatorio', alarm: '⏰ Alarma' };
const RECURRENCE_LABEL: Record<RecurrenceFreq, string> = {
  none: 'única vez',
  daily: 'día(s)',
  weekly: 'semana(s)',
  monthly: 'mes(es)',
  yearly: 'año(s)',
};

function recurrenceNote(freq: RecurrenceFreq, interval: number): string {
  if (freq === 'none') return '';
  return ` · cada ${interval > 1 ? `${interval} ` : ''}${RECURRENCE_LABEL[freq]}`;
}

export function CallRemindersPage() {
  const api = useApi();
  const [reminders, setReminders] = useState<CallReminder[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [callType, setCallType] = useState<CallReminderType>('reminder');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [recurrenceFreq, setRecurrenceFreq] = useState<RecurrenceFreq>('none');
  const [recurrenceInterval, setRecurrenceInterval] = useState('1');
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setReminders(await api.get<CallReminder[]>('/api/call-reminders'));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function resetForm() {
    setPhone('');
    setMessage('');
    setCallType('reminder');
    setDate('');
    setTime('');
    setRecurrenceFreq('none');
    setRecurrenceInterval('1');
    setError(null);
    setEditingId(null);
  }

  function openCreate() {
    resetForm();
    setShowForm(true);
  }

  function openEdit(r: CallReminder) {
    setEditingId(r.id);
    setPhone(r.phone_number);
    setMessage(r.message);
    setCallType(r.call_type);
    setDate(r.scheduled_at.slice(0, 10));
    setTime(r.scheduled_at.slice(11, 16));
    setRecurrenceFreq(r.recurrence_freq);
    setRecurrenceInterval(String(r.recurrence_interval));
    setError(null);
    setShowForm(true);
  }

  async function handleSave() {
    if (!phone.trim() || !date || !time || (callType === 'reminder' && !message.trim())) return;
    setSaving(true);
    setError(null);
    const body = {
      phone_number: phone.trim(),
      message: message.trim(),
      call_type: callType,
      scheduled_at: `${date} ${time}:00`,
      recurrence_freq: recurrenceFreq,
      recurrence_interval: Number(recurrenceInterval) || 1,
    };
    try {
      if (editingId) await api.put(`/api/call-reminders/${editingId}`, body);
      else await api.post('/api/call-reminders', body);
      resetForm();
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo guardar el recordatorio.');
    } finally {
      setSaving(false);
    }
  }

  async function handleCancel(id: number) {
    await api.post(`/api/call-reminders/${id}/cancel`);
    await load();
  }

  async function handleDelete(id: number) {
    if (!confirm('¿Eliminar este recordatorio por llamada?')) return;
    await api.del(`/api/call-reminders/${id}`);
    await load();
  }

  async function handleTest(id: number) {
    setTestingId(id);
    try {
      await api.post(`/api/call-reminders/${id}/test`);
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'No se pudo iniciar la llamada de prueba.');
    } finally {
      setTestingId(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold text-ink dark:text-white">Recordatorios por llamada</h1>
        <Button onClick={openCreate}>
          <Plus size={16} /> Nueva llamada
        </Button>
      </div>

      <p className="mb-4 text-sm text-gray-dark">
        Especial - no es para recordatorios normales (esos se piden por WhatsApp). Es una llamada telefónica real
        (Twilio) para algo verdaderamente importante, o una alarma que hace timbrar el teléfono y cuelga sola al
        contestar. Puede repetirse (ej. cada 2 días).
      </p>

      {!reminders && (
        <div className="space-y-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      )}

      {reminders && reminders.length === 0 && <EmptyState icon={<PhoneCall />} title="Sin llamadas programadas" />}

      {reminders && reminders.length > 0 && (
        <div className="space-y-2">
          {reminders.map((r) => (
            <Card key={r.id} className="flex items-center justify-between gap-3 p-4">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-ink dark:text-white">
                  {TYPE_LABEL[r.call_type]} {r.call_type === 'reminder' ? `· ${r.message}` : ''}
                </p>
                <p className="text-xs text-gray-dark">
                  {r.phone_number} · {r.scheduled_at}
                  {recurrenceNote(r.recurrence_freq, r.recurrence_interval)}
                  {r.twilio_call_status ? ` · Twilio: ${r.twilio_call_status}` : ''}
                  {r.attempts > 0 ? ` · intento ${r.attempts}` : ''}
                </p>
                {r.last_error && <p className="text-xs text-error">{r.last_error}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>
                <button
                  onClick={() => handleTest(r.id)}
                  disabled={testingId === r.id}
                  className="rounded-lg p-2 text-gray-dark hover:bg-primary/10 hover:text-primary-dark disabled:opacity-50"
                  aria-label="Probar llamada ahora"
                  title="Probar llamada ahora"
                >
                  <PhoneOutgoing size={16} />
                </button>
                {r.status !== 'processing' && (
                  <button
                    onClick={() => openEdit(r)}
                    className="rounded-lg p-2 text-gray-dark hover:bg-primary/10 hover:text-primary-dark"
                    aria-label="Editar"
                    title="Editar"
                  >
                    <Pencil size={16} />
                  </button>
                )}
                {(r.status === 'pending' || r.status === 'processing') && (
                  <button
                    onClick={() => handleCancel(r.id)}
                    className="rounded-lg p-2 text-gray-dark hover:bg-error/10 hover:text-error"
                    aria-label="Cancelar"
                  >
                    <X size={16} />
                  </button>
                )}
                <button
                  onClick={() => handleDelete(r.id)}
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
        <Modal
          title={editingId ? 'Editar llamada' : 'Nueva llamada'}
          onClose={() => {
            setShowForm(false);
            resetForm();
          }}
        >
          <div className="space-y-3">
            <div>
              <Label htmlFor="call-type">Tipo</Label>
              <Select id="call-type" value={callType} onChange={(e) => setCallType(e.target.value as CallReminderType)}>
                <option value="reminder">📞 Recordatorio (dice un mensaje)</option>
                <option value="alarm">⏰ Alarma (solo timbra y cuelga al contestar)</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="call-phone">Teléfono (con indicativo de país)</Label>
              <Input id="call-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+57 300 123 4567" autoFocus />
            </div>
            {callType === 'reminder' && (
              <div>
                <Label htmlFor="call-message">Mensaje que dirá la llamada</Label>
                <Textarea
                  id="call-message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={2}
                  placeholder="Recuerda sacar la basura."
                />
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="call-date">Fecha</Label>
                <Input id="call-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="call-time">Hora</Label>
                <Input id="call-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="call-recurrence">Repetir</Label>
                <Select
                  id="call-recurrence"
                  value={recurrenceFreq}
                  onChange={(e) => setRecurrenceFreq(e.target.value as RecurrenceFreq)}
                >
                  <option value="none">No repetir</option>
                  <option value="daily">Cada N días</option>
                  <option value="weekly">Cada N semanas</option>
                  <option value="monthly">Cada N meses</option>
                  <option value="yearly">Cada N años</option>
                </Select>
              </div>
              {recurrenceFreq !== 'none' && (
                <div>
                  <Label htmlFor="call-interval">Cada cuántos</Label>
                  <Input
                    id="call-interval"
                    type="number"
                    min={1}
                    value={recurrenceInterval}
                    onChange={(e) => setRecurrenceInterval(e.target.value)}
                  />
                </div>
              )}
            </div>
            {error && <p className="text-sm text-error">{error}</p>}
            <Button
              className="w-full"
              onClick={handleSave}
              disabled={saving || !phone.trim() || !date || !time || (callType === 'reminder' && !message.trim())}
            >
              {saving ? 'Guardando…' : editingId ? 'Guardar cambios' : 'Programar llamada'}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
