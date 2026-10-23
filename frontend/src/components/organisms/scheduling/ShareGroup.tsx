import { useState } from 'react';
import { useApi, errMsg } from '../../../services/api.ts';
import type { SchedGroup } from '../../../types/index.ts';
import { Notice } from '../../molecules/Notice.tsx';
import { Button } from '../../atoms/Button.tsx';
import { Input, Label } from '../../atoms/Input.tsx';
import { Modal } from '../Modal.tsx';

export function ShareGroup({ group, onClose, onDone }: { group: SchedGroup; onClose: () => void; onDone: (msg: string) => void }) {
  const api = useApi();
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  async function save() {
    try {
      const r = await api.post<{ notified: boolean; forwardText: string | null }>(`/api/admin/scheduling/groups/${group.id}/clients`, { phone, name });
      onDone(r.notified ? 'Acceso dado y le escribí por WhatsApp.' : `Acceso dado, pero no pude escribirle. Reenvíale: "${r.forwardText}"`);
    } catch (e) {
      setError(errMsg(e));
    }
  }
  return (
    <Modal title={`Dar acceso a "${group.name}"`} onClose={onClose}>
      {error && <Notice tone="error">{error}</Notice>}
      <p className="mb-3 text-sm text-gray-dark">Podrá agendar con cualquier profesional del grupo (solo agendar).</p>
      <Label>Número (con indicativo)</Label>
      <Input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="573001234567" />
      <div className="h-3" />
      <Label>Nombre</Label>
      <Input value={name} onChange={(e) => setName(e.target.value)} />
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button onClick={save} disabled={!phone.trim()}>
          Dar acceso
        </Button>
      </div>
    </Modal>
  );
}
