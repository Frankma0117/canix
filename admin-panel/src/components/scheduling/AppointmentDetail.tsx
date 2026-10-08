import { useEffect, useRef, useState } from 'react';
import { Paperclip, FileText, Trash2, Check, X, Ban } from 'lucide-react';
import { useApi, errMsg } from '../../lib/api.ts';
import { useAuth } from '../../lib/auth.tsx';
import type { Appointment, AttachedFile } from '../../lib/types.ts';
import { formatWhen, time12 } from '../../lib/dates.ts';
import { Modal } from '../ui/Modal.tsx';
import { Button } from '../ui/Button.tsx';
import { Textarea } from '../ui/Input.tsx';
import { Notice } from '../ui/Page.tsx';
import { STATUS_STYLE } from './Calendar.tsx';

const EVENT_LABEL: Record<string, string> = {
  requested: 'Solicitada',
  confirmed: 'Confirmada',
  rejected: 'Rechazada',
  cancelled: 'Cancelada',
  scheduled_by_professional: 'Agendada por el profesional',
  expired: 'Vencida sin confirmar',
  completed: 'Realizada',
  notes_updated: 'Notas actualizadas',
};

interface Detail {
  appointment: Appointment;
  events: { action: string; detail: string | null; created_at: string; actor_name: string | null }[];
  files: AttachedFile[];
}

export function AppointmentDetail({
  id,
  perspective,
  onClose,
  onChanged,
}: {
  id: number;
  perspective: 'professional' | 'client';
  onClose: () => void;
  onChanged: () => void;
}) {
  const api = useApi();
  const { user } = useAuth();
  const [d, setD] = useState<Detail | null>(null);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = () =>
    api
      .get<Detail>(`/api/scheduling/appointments/${id}`)
      .then((r) => {
        setD(r);
        setNotes(r.appointment.notes ?? '');
      })
      .catch((e) => setError(errMsg(e)));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function act(path: string, body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      await api.post(path, body);
      await load();
      onChanged();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function uploadFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    try {
      await api.upload(`/api/scheduling/appointments/${id}/files`, [...files]);
      await load();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function openFile(f: AttachedFile) {
    try {
      const url = await api.fileUrl(`/api/files/${f.id}`);
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      if (f.mime === 'application/pdf') a.download = f.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      setError(errMsg(e));
    }
  }

  if (!d) return <Modal title="Cita" onClose={onClose}>{error ? <Notice tone="error">{error}</Notice> : <p className="text-sm text-gray-dark">Cargando…</p>}</Modal>;
  const a = d.appointment;
  const active = a.status === 'pending' || a.status === 'confirmed';
  const base = perspective === 'professional' ? `/api/scheduling/pro/appointments/${a.id}` : `/api/scheduling/client/appointments/${a.id}`;

  return (
    <Modal title={`Cita #${a.id}`} onClose={onClose} size="md">
      {error && <Notice tone="error">{error}</Notice>}
      <div className="mb-4 space-y-1">
        <span className={`inline-block rounded border-l-2 px-2 py-0.5 text-xs ${STATUS_STYLE[a.status]}`}>{a.status_label}</span>
        <p className="font-display text-lg font-semibold capitalize text-ink dark:text-white">{formatWhen(a.start_at)}</p>
        <p className="text-sm text-gray-dark">
          Hasta las {time12(a.end_at)} · {perspective === 'professional' ? `${a.client_name ?? 'Cliente'} (+${a.client_phone})` : a.professional_name}
        </p>
        {a.reason && <p className="text-sm text-ink dark:text-white/80">Motivo: {a.reason}</p>}
        {a.cancel_reason && <p className="text-sm text-gray-dark">Razón de cancelación/rechazo: {a.cancel_reason}</p>}
      </div>

      {active && (
        <div className="mb-5 flex flex-wrap gap-2">
          {perspective === 'professional' && a.status === 'pending' && (
            <>
              <Button disabled={busy} onClick={() => act(`${base}/confirm`)}>
                <Check size={15} /> Confirmar
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => {
                const reason = prompt('Motivo del rechazo (opcional, se lo envío al cliente):');
                if (reason !== null) act(`${base}/reject`, { reason });
              }}>
                <X size={15} /> Rechazar
              </Button>
            </>
          )}
          <Button variant="danger" disabled={busy} onClick={() => {
            const reason = prompt('¿Cancelar esta cita? Motivo (opcional, se le avisa a la otra parte):');
            if (reason !== null) act(`${base}/cancel`, { reason });
          }}>
            <Ban size={15} /> Cancelar cita
          </Button>
        </div>
      )}

      {perspective === 'professional' && (
        <div className="mb-5">
          <p className="mb-1 text-sm font-medium text-ink dark:text-white">Notas privadas (solo tú las ves)</p>
          <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          <div className="mt-2 flex justify-end">
            <Button variant="secondary" disabled={busy || notes === (a.notes ?? '')} onClick={async () => {
              try {
                await api.put(`/api/scheduling/pro/appointments/${a.id}/notes`, { notes });
                await load();
              } catch (e) {
                setError(errMsg(e));
              }
            }}>
              Guardar notas
            </Button>
          </div>
        </div>
      )}

      <div className="mb-5">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-medium text-ink dark:text-white">Archivos adjuntos</p>
          <Button variant="secondary" disabled={busy} onClick={() => fileInput.current?.click()}>
            <Paperclip size={15} /> Adjuntar
          </Button>
          <input ref={fileInput} type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" onChange={(e) => uploadFiles(e.target.files)} />
        </div>
        <p className="mb-2 text-xs text-gray-dark">JPG, PNG, WEBP o PDF · máx. 10 MB por archivo, 5 por envío.</p>
        {d.files.length === 0 && <p className="text-sm text-gray-dark">Sin archivos.</p>}
        <ul className="space-y-1">
          {d.files.map((f) => (
            <li key={f.id} className="flex items-center gap-2 text-sm">
              <FileText size={15} className="text-gray-dark" />
              <button className="truncate text-primary hover:underline" onClick={() => openFile(f)}>
                {f.name}
              </button>
              <span className="text-xs text-gray-dark">{(f.size / 1024).toFixed(0)} KB</span>
              {(f.owner === user?.id || user?.role === 'admin') && (
                <button className="ml-auto text-gray-dark hover:text-error" onClick={() => confirm('¿Borrar este archivo?') && api.del(`/api/files/${f.id}`).then(load).catch((e) => setError(errMsg(e)))} aria-label="Borrar">
                  <Trash2 size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div>
        <p className="mb-1 text-sm font-medium text-ink dark:text-white">Historial</p>
        <ul className="space-y-0.5 text-xs text-gray-dark">
          {d.events.map((e, i) => (
            <li key={i}>
              {e.created_at.slice(0, 16)} · {EVENT_LABEL[e.action] ?? e.action}
              {e.actor_name ? ` · ${e.actor_name}` : ''}
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}
