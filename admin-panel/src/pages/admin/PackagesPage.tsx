import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { useApi, errMsg } from '../../lib/api.ts';
import type { PermissionDef, PermissionPackage } from '../../lib/types.ts';
import { Page, Notice } from '../../components/ui/Page.tsx';
import { Card } from '../../components/ui/Card.tsx';
import { Badge } from '../../components/ui/Badge.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { Input, Label } from '../../components/ui/Input.tsx';
import { Modal } from '../../components/ui/Modal.tsx';
import { PermissionChecklist } from './PermissionPicker.tsx';

type Draft = { id?: number; name: string; description: string; permissions: string[] };

export function PackagesPage() {
  const api = useApi();
  const [packages, setPackages] = useState<PermissionPackage[]>([]);
  const [catalog, setCatalog] = useState<PermissionDef[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    Promise.all([api.get<PermissionPackage[]>('/api/admin/packages'), api.get<PermissionDef[]>('/api/admin/permissions')])
      .then(([p, c]) => {
        setPackages(p);
        setCatalog(c);
      })
      .catch((e) => setError(errMsg(e)));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    if (!draft) return;
    setError(null);
    try {
      if (draft.id) await api.put(`/api/admin/packages/${draft.id}`, draft);
      else await api.post('/api/admin/packages', draft);
      setDraft(null);
      await load();
    } catch (e) {
      setError(errMsg(e));
    }
  }

  const labelOf = (k: string) => catalog.find((c) => c.key === k)?.label ?? k;

  return (
    <Page
      title="Paquetes de permisos"
      wide
      description="Un paquete agrupa varios permisos para asignarlos de una sola vez. Cambiar un paquete afecta a todos los que lo tienen asignado. Los del sistema se pueden editar, no borrar."
      actions={
        <Button onClick={() => setDraft({ name: '', description: '', permissions: [] })}>
          <Plus size={16} /> Nuevo paquete
        </Button>
      }
    >
      {error && !draft && <Notice tone="error">{error}</Notice>}
      <div className="grid gap-3 md:grid-cols-2">
        {packages.map((p) => (
          <Card key={p.id} className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-display font-semibold text-ink dark:text-white">
                  {p.name} {p.is_system ? <Badge tone="info">sistema</Badge> : null}
                </p>
                <p className="text-sm text-gray-dark">{p.description}</p>
              </div>
              <div className="flex shrink-0 gap-1">
                <button className="rounded-lg p-2 text-gray-dark hover:bg-gray-medium/60" onClick={() => setDraft({ id: p.id, name: p.name, description: p.description, permissions: p.permissions })} aria-label="Editar">
                  <Pencil size={15} />
                </button>
                {!p.is_system && (
                  <button
                    className="rounded-lg p-2 text-gray-dark hover:bg-error/10 hover:text-error"
                    onClick={() => confirm(`¿Borrar el paquete "${p.name}"? Quien lo tenga asignado pierde esos permisos.`) && api.del(`/api/admin/packages/${p.id}`).then(load).catch((e) => setError(errMsg(e)))}
                    aria-label="Borrar"
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {p.permissions.map((k) => (
                <Badge key={k} tone="neutral">
                  {labelOf(k)}
                </Badge>
              ))}
              {!p.permissions.length && <span className="text-xs text-gray-dark">Vacío</span>}
            </div>
          </Card>
        ))}
      </div>

      {draft && (
        <Modal title={draft.id ? 'Editar paquete' : 'Nuevo paquete'} onClose={() => setDraft(null)} size="lg">
          {error && <Notice tone="error">{error}</Notice>}
          <Label>Nombre</Label>
          <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <div className="h-3" />
          <Label>Descripción</Label>
          <Input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          <p className="mb-2 mt-4 text-sm font-medium text-ink dark:text-white">Permisos incluidos</p>
          <PermissionChecklist catalog={catalog} selected={draft.permissions} onChange={(permissions) => setDraft({ ...draft, permissions })} />
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDraft(null)}>
              Cancelar
            </Button>
            <Button onClick={save} disabled={!draft.name.trim()}>
              Guardar
            </Button>
          </div>
        </Modal>
      )}
    </Page>
  );
}
