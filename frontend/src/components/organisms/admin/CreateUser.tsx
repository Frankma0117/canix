import { useState } from 'react';
import { Plus, Phone, Check } from 'lucide-react';
import { useApi, errMsg } from '../../../services/api.ts';
import type { AdminUser, PermissionPackage } from '../../../types/index.ts';
import { Button } from '../../atoms/Button.tsx';
import { Input, Label, Hint } from '../../atoms/Input.tsx';
import { Modal } from '../Modal.tsx';
import { useToast } from '../../molecules/Toast.tsx';

export function CreateUser({ packages, onClose, onCreated }: { packages: PermissionPackage[]; onClose: () => void; onCreated: (u: AdminUser) => void }) {
  const api = useApi();
  const toast = useToast();
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [pkgIds, setPkgIds] = useState<number[]>([]);
  const [notify, setNotify] = useState(true);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const r = await api.post<{ user: AdminUser; notified: boolean }>('/api/admin/users', { phone, name, packageIds: pkgIds, notify });
      toast.success(r.notified ? `${name} ya tiene acceso y le escribí por WhatsApp.` : `${name} ya tiene acceso.`);
      onCreated(r.user);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Dar acceso a una persona" description="Después podrás ajustar permisos sueltos y extras de pago en su ficha." onClose={onClose} size="md">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label>Nombre</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ana Gómez" />
        </div>
        <div>
          <Label>Número de WhatsApp</Label>
          <Input icon={<Phone size={15} />} inputMode="tel" placeholder="573001234567" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <Hint>Con indicativo de país.</Hint>
        </div>
      </div>
      <p className="mb-2 mt-5 text-sm font-bold text-ink dark:text-white">Paquete inicial</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {packages.map((p) => {
          const on = pkgIds.includes(p.id);
          return (
            <button
              type="button"
              key={p.id}
              onClick={() => setPkgIds(on ? pkgIds.filter((x) => x !== p.id) : [...pkgIds, p.id])}
              className={`rounded-2xl border p-3 text-left transition-all ${on ? 'border-primary/60 bg-primary/5 dark:bg-primary/15' : 'border-gray-medium/70 hover:border-primary/30 dark:border-white/10'}`}
            >
              <span className="flex items-center justify-between text-sm font-bold text-ink dark:text-white">
                {p.name}
                {on && <Check size={15} className="text-primary" />}
              </span>
              <span className="mt-0.5 block text-xs text-gray-dark">{p.description}</span>
            </button>
          );
        })}
      </div>
      <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm text-ink dark:text-white/85">
        <input type="checkbox" className="h-4 w-4 accent-[#4b5cf6]" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Saludarla por WhatsApp para avisarle
      </label>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button onClick={save} loading={saving} disabled={!phone.trim() || !name.trim()}>
          <Plus size={16} /> Crear acceso
        </Button>
      </div>
    </Modal>
  );
}
