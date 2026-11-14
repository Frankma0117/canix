import { useCallback, useEffect, useState } from 'react';
import { Copy, KeyRound, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useApi, errMsg } from '../../services/api.ts';
import { Page } from '../../components/templates/Page.tsx';
import { Notice } from '../../components/molecules/Notice.tsx';
import { EmptyState } from '../../components/molecules/EmptyState.tsx';
import { useToast } from '../../components/molecules/Toast.tsx';
import { Modal } from '../../components/organisms/Modal.tsx';
import { Card } from '../../components/atoms/Card.tsx';
import { Button } from '../../components/atoms/Button.tsx';
import { Hint, Input, Label } from '../../components/atoms/Input.tsx';
import { Skeleton } from '../../components/atoms/Skeleton.tsx';

interface Client {
  id: number;
  name: string;
  keyPrefix: string;
  webhookUrl: string;
  enabled: boolean;
  lastUsedAt: string | null;
  pending: number;
  createdAt: string | null;
}
interface Log {
  id: number;
  client: string;
  kind: 'message' | 'approval';
  title: string;
  body: string;
  status: 'sent' | 'failed' | 'pending' | 'approved' | 'rejected' | 'expired';
  decidedVia: 'reaction' | 'link' | null;
  webhook: 'none' | 'pending' | 'sent' | 'failed';
  webhookError: string;
  error: string;
  createdAt: string | null;
}
interface Overview {
  clients: Client[];
  messages: Log[];
}
interface Secrets {
  name: string;
  apiKey?: string;
  webhookSecret?: string;
}

const STATUS: Record<Log['status'], { label: string; tone: string }> = {
  sent: { label: 'Enviado', tone: 'bg-gray-medium text-gray-dark dark:bg-white/10' },
  failed: { label: 'No se envió', tone: 'bg-error/10 text-error' },
  pending: { label: 'Esperando tu respuesta', tone: 'bg-warning/10 text-warning' },
  approved: { label: 'Aprobado', tone: 'bg-success/10 text-success' },
  rejected: { label: 'Rechazado', tone: 'bg-error/10 text-error' },
  expired: { label: 'Venció', tone: 'bg-gray-medium text-gray-dark dark:bg-white/10' },
};
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }) : 'Nunca');

/**
 * Other projects of the administrator (Brindix, a landing...) that send messages to their WhatsApp
 * through Canix, and ask for approvals answered with 👍 / 👎 or a link. See docs/NOTIFY-API.md.
 */
export function ConnectedProjectsPage() {
  const api = useApi();
  const toast = useToast();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [secrets, setSecrets] = useState<Secrets | null>(null);
  const [asking, setAsking] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.get<Overview>('/api/admin/notify'));
      setError(null);
    } catch (err) {
      setError(errMsg(err));
    }
  }, [api]);
  useEffect(() => {
    void load();
  }, [load]);

  async function act(key: string, fn: () => Promise<unknown>, ok?: string) {
    setBusy(key);
    try {
      await fn();
      if (ok) toast.success(ok);
      await load();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(null);
      setAsking(null);
    }
  }

  return (
    <Page title="Proyectos conectados" eyebrow="Mensajes y aprobaciones" sticker="vamos" wide description="Tus otros proyectos (Brindix, una landing…) le escriben a Canix y Canix te avisa por WhatsApp. También pueden pedirte una aprobación: la respondes con 👍 / 👎 o con un enlace, y la respuesta vuelve al proyecto.">
      {error && <Notice tone="error">{error}</Notice>}
      {!data && <Skeleton className="h-64" />}
      {data && (
        <div className="space-y-8">
          <section>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-display text-xl font-extrabold text-ink dark:text-white">Proyectos</h2>
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus size={14} /> Conectar un proyecto
              </Button>
            </div>
            {data.clients.length === 0 ? (
              <EmptyState sticker="idea" title="Todavía no hay proyectos conectados" description="Conecta uno para obtener su llave de API y empezar a recibir sus mensajes y aprobaciones en tu WhatsApp." />
            ) : (
              <div className="grid items-start gap-4 md:grid-cols-2">
                {data.clients.map((c) => (
                  <Card key={c.id} className={`p-5 ${c.enabled ? '' : 'opacity-70'}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-display text-lg font-extrabold text-ink dark:text-white">{c.name}</p>
                        <p className="text-xs text-gray-dark">
                          Llave <code>{c.keyPrefix}…</code> · Último uso: {when(c.lastUsedAt)}
                        </p>
                      </div>
                      <label className="flex shrink-0 cursor-pointer items-center gap-2 text-xs font-semibold text-gray-dark">
                        <input type="checkbox" className="h-4 w-4 accent-[var(--color-primary)]" checked={c.enabled} onChange={(e) => void act(`e${c.id}`, () => api.put(`/api/admin/notify/clients/${c.id}`, { enabled: e.target.checked }))} />
                        Activo
                      </label>
                    </div>
                    <p className="mt-2 break-all text-xs text-gray-dark">{c.webhookUrl ? `Respuestas a: ${c.webhookUrl}` : 'Sin webhook: el proyecto consulta la respuesta él mismo.'}</p>
                    {c.pending > 0 && <p className="mt-1 text-xs font-semibold text-warning">{c.pending} esperando tu respuesta</p>}
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button size="sm" variant="secondary" onClick={() => setEditing(c)}>
                        Webhook
                      </Button>
                      <Button size="sm" variant="secondary" loading={busy === `k${c.id}`} onClick={() => act(`k${c.id}`, async () => setSecrets({ name: c.name, ...(await api.post<{ apiKey: string }>(`/api/admin/notify/clients/${c.id}/rotate-key`)) }))}>
                        <KeyRound size={13} /> Nueva llave
                      </Button>
                      <Button size="sm" variant="ghost" loading={busy === `s${c.id}`} onClick={() => act(`s${c.id}`, async () => setSecrets({ name: c.name, ...(await api.post<{ webhookSecret: string }>(`/api/admin/notify/clients/${c.id}/rotate-secret`)) }))}>
                        <RefreshCw size={13} /> Nuevo secreto
                      </Button>
                      {asking === c.id ? (
                        <span className="ml-auto flex items-center gap-1.5 text-xs">
                          ¿Borrar?
                          <Button size="sm" variant="danger" loading={busy === `d${c.id}`} onClick={() => act(`d${c.id}`, () => api.del(`/api/admin/notify/clients/${c.id}`), 'Proyecto eliminado.')}>
                            Sí
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setAsking(null)}>
                            No
                          </Button>
                        </span>
                      ) : (
                        <Button size="sm" variant="ghost" className="ml-auto" aria-label="Borrar" onClick={() => setAsking(c.id)}>
                          <Trash2 size={13} />
                        </Button>
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </section>

          {data.messages.length > 0 && (
            <section>
              <h2 className="mb-3 font-display text-xl font-extrabold text-ink dark:text-white">Últimos mensajes</h2>
              <div className="grid gap-2">
                {data.messages.map((m) => (
                  <Card key={m.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS[m.status].tone}`}>{STATUS[m.status].label}</span>
                    <span className="text-sm font-semibold text-ink dark:text-white">{m.client}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-gray-dark">{m.kind === 'approval' ? '✋ ' : ''}{m.title || m.body}</span>
                    <span className="text-xs text-gray-dark">
                      {m.decidedVia === 'reaction' ? 'por reacción · ' : m.decidedVia === 'link' ? 'por enlace · ' : ''}
                      {m.kind === 'approval' && m.webhook === 'failed' ? 'webhook falló · ' : ''}
                      {when(m.createdAt)}
                    </span>
                    {(m.error || m.webhookError) && <span className="w-full text-xs text-error">{m.error || m.webhookError}</span>}
                  </Card>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {creating && (
        <CreateModal
          onClose={() => setCreating(false)}
          onCreate={async (name, webhookUrl) => {
            const res = await api.post<{ apiKey: string; webhookSecret: string }>('/api/admin/notify/clients', { name, webhookUrl });
            setCreating(false);
            setSecrets({ name, ...res });
            await load();
          }}
        />
      )}
      {editing && (
        <WebhookModal
          client={editing}
          onClose={() => setEditing(null)}
          onSave={async (url) => {
            await api.put(`/api/admin/notify/clients/${editing.id}`, { webhookUrl: url });
            toast.success('Listo: el webhook quedó guardado.');
            setEditing(null);
            await load();
          }}
        />
      )}
      {secrets && <SecretsModal secrets={secrets} onClose={() => setSecrets(null)} />}
    </Page>
  );
}

function CreateModal({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string, url: string) => Promise<void> }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await onCreate(name, url);
    } catch (err) {
      toast.error(errMsg(err));
      setBusy(false);
    }
  }
  return (
    <Modal title="Conectar un proyecto" description="Se crea su llave de API. Te la mostramos una sola vez." onClose={onClose}>
      <div className="space-y-4">
        <div>
          <Label htmlFor="cp-name">Nombre del proyecto</Label>
          <Input id="cp-name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Brindix" />
        </div>
        <div>
          <Label htmlFor="cp-url">Webhook de respuestas (opcional)</Label>
          <Input id="cp-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://brindix.app/api/canix/respuesta" />
          <Hint>Aquí Canix te avisa lo que respondiste (firmado). Puede ir vacío y el proyecto consulta la respuesta él mismo.</Hint>
        </div>
        <div className="flex gap-3">
          <Button onClick={save} loading={busy} disabled={name.trim().length < 2}>
            Crear
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function WebhookModal({ client, onClose, onSave }: { client: Client; onClose: () => void; onSave: (url: string) => Promise<void> }) {
  const toast = useToast();
  const [url, setUrl] = useState(client.webhookUrl);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await onSave(url);
    } catch (err) {
      toast.error(errMsg(err));
      setBusy(false);
    }
  }
  return (
    <Modal title={`Webhook de ${client.name}`} onClose={onClose}>
      <div className="space-y-4">
        <div>
          <Label htmlFor="wh-url">Dirección (https)</Label>
          <Input id="wh-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
          <Hint>Déjala vacía para no recibir webhooks.</Hint>
        </div>
        <div className="flex gap-3">
          <Button onClick={save} loading={busy}>
            Guardar
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const toast = useToast();
  return (
    <div>
      <Label>{label}</Label>
      <div className="flex gap-2">
        <input readOnly value={value} onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 rounded-xl border border-gray-medium bg-white px-3 py-2 font-mono text-xs text-ink dark:border-white/10 dark:bg-white/5 dark:text-white" />
        <Button
          variant="secondary"
          size="sm"
          aria-label={`Copiar ${label}`}
          onClick={() => void navigator.clipboard.writeText(value).then(() => toast.success('Copiado.'), () => toast.error('No se pudo copiar: selecciónalo y cópialo a mano.'))}
        >
          <Copy size={14} />
        </Button>
      </div>
    </div>
  );
}

function SecretsModal({ secrets, onClose }: { secrets: Secrets; onClose: () => void }) {
  const origin = window.location.origin;
  const curl = `curl -X POST ${origin}/api/v1/approvals \\\n  -H "Authorization: Bearer ${secrets.apiKey ?? 'TU_LLAVE'}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"title":"Publicar la promo","text":"2x1 el viernes","ref":"post-42"}'`;
  return (
    <Modal title={`Datos de ${secrets.name}`} description="Cópialos ahora y pégalos en el .env del proyecto: no se vuelven a mostrar." onClose={onClose} size="md">
      <div className="space-y-4">
        {secrets.apiKey && <CopyRow label="Llave de API (CANIX_API_KEY)" value={secrets.apiKey} />}
        {secrets.webhookSecret && <CopyRow label="Secreto del webhook (CANIX_WEBHOOK_SECRET)" value={secrets.webhookSecret} />}
        <CopyRow label="Dirección de Canix (CANIX_URL)" value={origin} />
        {secrets.apiKey && (
          <div>
            <Label>Prueba rápida</Label>
            <pre className="overflow-x-auto rounded-xl bg-navy/5 p-3 text-xs text-ink dark:bg-white/5 dark:text-white">{curl}</pre>
          </div>
        )}
        <Button onClick={onClose}>Ya los guardé</Button>
      </div>
    </Modal>
  );
}
