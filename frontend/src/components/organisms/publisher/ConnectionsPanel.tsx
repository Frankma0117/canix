import { useState } from 'react';
import { Link2, Unlink } from 'lucide-react';
import type { Api } from '../../../services/api.ts';
import { errMsg } from '../../../services/api.ts';
import type { PublisherConnection } from '../../../types/publisher.ts';
import { Card } from '../../atoms/Card.tsx';
import { Button } from '../../atoms/Button.tsx';
import { Input, Select } from '../../atoms/Input.tsx';
import { Notice } from '../../molecules/Notice.tsx';
import { useToast } from '../../molecules/Toast.tsx';

/** The project's own account on each network. Phase 1 only connects the simulated provider. */
export function ConnectionsPanel({ api, connections, onChange }: { api: Api; connections: PublisherConnection[]; onChange: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [provider, setProvider] = useState<Record<string, string>>({});
  const [account, setAccount] = useState<Record<string, string>>({});

  async function connect(c: PublisherConnection) {
    setBusy(c.platform);
    try {
      await api.post(`/api/admin/publisher/connections/${c.platform}`, { provider: provider[c.platform] ?? 'mock', account: account[c.platform] ?? '' });
      toast.success(`Listo: ${c.name} quedó conectada.`);
      onChange();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(null);
    }
  }

  async function disconnect(c: PublisherConnection) {
    setBusy(c.platform);
    try {
      await api.del(`/api/admin/publisher/connections/${c.platform}`);
      toast.success(`${c.name} se desconectó.`);
      onChange();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <Notice tone="info">Por ahora solo funciona la conexión simulada (para probar todo el flujo sin publicar de verdad). Las conexiones reales con YouTube, Instagram, Facebook y TikTok llegan en las próximas fases.</Notice>
      <div className="grid gap-4 md:grid-cols-2">
        {connections.map((c) => (
          <Card key={c.platform} className="p-5">
            <div className="flex items-start justify-between gap-3">
              <h3 className="font-display text-lg font-extrabold text-ink dark:text-white">{c.name}</h3>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${c.status === 'error' ? 'bg-error/10 text-error' : c.connected ? 'bg-success/10 text-success' : 'bg-gray-medium text-gray-dark dark:bg-white/10'}`}>
                {c.status === 'error' ? 'Con error' : c.connected ? 'Conectada' : 'Sin conectar'}
              </span>
            </div>
            {c.connected ? (
              <>
                <p className="mt-2 text-sm text-ink dark:text-white/85">{c.accountName}</p>
                {c.lastError && <p className="mt-1 text-xs text-error">{c.lastError}</p>}
                <Button className="mt-3" variant="secondary" size="sm" onClick={() => disconnect(c)} loading={busy === c.platform}>
                  <Unlink size={14} /> Desconectar
                </Button>
              </>
            ) : (
              <div className="mt-3 space-y-2.5">
                <Select aria-label={`Proveedor de ${c.name}`} value={provider[c.platform] ?? 'mock'} onChange={(e) => setProvider((p) => ({ ...p, [c.platform]: e.target.value }))}>
                  {c.providers.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.label}
                      {p.available ? '' : ' · próximamente'}
                    </option>
                  ))}
                </Select>
                <Input aria-label={`Nombre de la cuenta de ${c.name}`} placeholder="Nombre de la cuenta (opcional)" value={account[c.platform] ?? ''} onChange={(e) => setAccount((a) => ({ ...a, [c.platform]: e.target.value }))} />
                <Button size="sm" onClick={() => connect(c)} loading={busy === c.platform}>
                  <Link2 size={14} /> Conectar
                </Button>
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
