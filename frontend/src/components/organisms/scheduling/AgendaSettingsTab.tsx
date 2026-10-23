import { useState } from 'react';
import { useApi, errMsg } from '../../../services/api.ts';
import type { ProfessionalProfile } from '../../../types/index.ts';
import { Notice } from '../../molecules/Notice.tsx';
import { Card } from '../../atoms/Card.tsx';
import { Button } from '../../atoms/Button.tsx';
import { Input, Label } from '../../atoms/Input.tsx';

// ------------------------------------------------------------------ settings
export function AgendaSettingsTab({ profile, onSaved }: { profile: ProfessionalProfile; onSaved: () => void }) {
  const api = useApi();
  const [f, setF] = useState({
    display_name: profile.display_name,
    specialty: profile.specialty ?? '',
    slot_minutes: String(profile.slot_minutes),
    buffer_minutes: String(profile.buffer_minutes),
    min_notice_hours: String(Math.round(profile.min_notice_minutes / 60)),
    max_days_ahead: String(profile.max_days_ahead),
    reminder_morning_time: profile.reminder_morning_time ?? '',
    reminder_hours_before: profile.reminder_hours_before ? String(profile.reminder_hours_before) : '',
    auto_confirm: !!profile.auto_confirm,
  });
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);

  async function save() {
    try {
      await api.put('/api/scheduling/pro/settings', {
        display_name: f.display_name,
        specialty: f.specialty,
        slot_minutes: Number(f.slot_minutes),
        buffer_minutes: Number(f.buffer_minutes),
        min_notice_minutes: Number(f.min_notice_hours) * 60,
        max_days_ahead: Number(f.max_days_ahead),
        reminder_morning_time: f.reminder_morning_time || null,
        reminder_hours_before: f.reminder_hours_before ? Number(f.reminder_hours_before) : null,
        auto_confirm: f.auto_confirm,
      });
      setMsg({ tone: 'success', text: 'Configuración guardada.' });
      onSaved();
    } catch (e) {
      setMsg({ tone: 'error', text: errMsg(e) });
    }
  }

  const field = (key: keyof typeof f, label: string, props: Record<string, unknown> = {}, help?: string) => (
    <div>
      <Label>{label}</Label>
      <Input value={String(f[key])} onChange={(e) => setF({ ...f, [key]: e.target.value })} {...props} />
      {help && <p className="mt-1 text-xs text-gray-dark">{help}</p>}
    </div>
  );

  return (
    <Card className="max-w-2xl p-5">
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <div className="grid gap-4 sm:grid-cols-2">
        {field('display_name', 'Nombre que ven tus clientes')}
        {field('specialty', 'Especialidad', { placeholder: 'Ej. Psicología' })}
        {field('slot_minutes', 'Duración de cada cita (min)', { type: 'number', min: 5, max: 480 })}
        {field('buffer_minutes', 'Descanso entre citas (min)', { type: 'number', min: 0, max: 240 })}
        {field('min_notice_hours', 'Anticipación mínima (horas)', { type: 'number', min: 0 }, 'No se pueden pedir citas con menos tiempo que esto.')}
        {field('max_days_ahead', 'Hasta cuántos días adelante', { type: 'number', min: 1, max: 365 })}
        {field('reminder_morning_time', 'Recordatorio el día de la cita a las', { type: 'time' }, 'Vacío = sin este recordatorio. Si la cita es antes de esa hora, se avisa la noche anterior.')}
        {field('reminder_hours_before', 'Recordatorio extra (horas antes)', { type: 'number', min: 1, max: 72, placeholder: 'Opcional' })}
      </div>
      <label className="mt-4 flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={f.auto_confirm} onChange={(e) => setF({ ...f, auto_confirm: e.target.checked })} />
        <span>
          Confirmar automáticamente las solicitudes
          <span className="block text-xs text-gray-dark">Si lo apagas (recomendado), cada cita que pidan queda pendiente hasta que la apruebes.</span>
        </span>
      </label>
      <p className="mt-3 text-xs text-gray-dark">Los recordatorios les llegan a ti y a tu cliente por WhatsApp.</p>
      <div className="mt-4 flex justify-end">
        <Button onClick={save}>Guardar configuración</Button>
      </div>
    </Card>
  );
}
