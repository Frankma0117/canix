import { useCallback, useEffect, useState } from 'react';
import { Trash2, Share2 } from 'lucide-react';
import { useApi, errMsg } from '../../../services/api.ts';
import type { SchedClient } from '../../../types/index.ts';
import { Notice } from '../../molecules/Notice.tsx';
import { Card } from '../../atoms/Card.tsx';
import { Button } from '../../atoms/Button.tsx';
import { Input, Label } from '../../atoms/Input.tsx';
import { EmptyState } from '../../molecules/EmptyState.tsx';

// ------------------------------------------------------------------ clients
export function AgendaClientsTab() {
  const api = useApi();
  const [clients, setClients] = useState<SchedClient[] | null>(null);
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [forward, setForward] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);

  const load = useCallback(() => api.get<SchedClient[]>('/api/scheduling/pro/clients').then(setClients).catch((e) => setMsg({ tone: 'error', text: errMsg(e) })), [api]);
  useEffect(() => {
    load();
  }, [load]);

  async function share() {
    setMsg(null);
    setForward(null);
    try {
      const r = await api.post<{ client: { name: string | null }; notified: boolean; forwardText: string | null }>('/api/scheduling/pro/clients', { phone, name });
      setMsg({ tone: 'success', text: r.notified ? `Listo, ${r.client.name ?? 'la persona'} ya puede agendar contigo y le escribí por WhatsApp.` : 'Acceso dado, pero no pude escribirle ahora. Reenvíale el mensaje de abajo.' });
      setForward(r.forwardText);
      setPhone('');
      setName('');
      await load();
    } catch (e) {
      setMsg({ tone: 'error', text: errMsg(e) });
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[2fr_3fr]">
      <Card className="p-4">
        <p className="mb-1 font-display font-semibold text-ink dark:text-white">Dar acceso para agendar</p>
        <p className="mb-3 text-xs text-gray-dark">La persona solo podrá ver tus espacios disponibles, pedir citas (que tú confirmas) y ver las suyas. Nada más.</p>
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        {forward && <div className="mb-3 rounded-xl bg-gray-light p-3 text-sm dark:bg-white/5">{forward}</div>}
        <Label>Número de WhatsApp (con indicativo)</Label>
        <Input inputMode="tel" placeholder="573001234567" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <div className="h-2" />
        <Label>Nombre</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
        <Button className="mt-3 w-full" disabled={!phone.trim()} onClick={share}>
          <Share2 size={15} /> Compartir acceso
        </Button>
      </Card>
      <div className="space-y-2">
        {clients?.length === 0 && <EmptyState icon="👥" title="Todavía nadie puede agendar contigo" />}
        {clients?.map((c) => (
          <Card key={c.id} className="flex items-center justify-between gap-3 p-3">
            <div>
              <p className="font-medium text-ink dark:text-white">{c.name ?? '(sin nombre)'}</p>
              <p className="text-xs text-gray-dark">
                +{c.phone}
                {c.via_group ? ` · vía ${c.via_group}` : ''}
              </p>
            </div>
            {!c.via_group && (
              <Button
                variant="ghost"
                onClick={() =>
                  confirm(`¿Quitarle a ${c.name ?? c.phone} el acceso a agendar contigo? Sus citas existentes no se cancelan.`) &&
                  api
                    .del(`/api/scheduling/pro/clients/${c.id}`)
                    .then(load)
                    .catch((e) => setMsg({ tone: 'error', text: errMsg(e) }))
                }
              >
                <Trash2 size={15} className="text-error" />
              </Button>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
