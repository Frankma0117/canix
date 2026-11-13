import { useState } from 'react';
import { Smartphone } from 'lucide-react';
import { errMsg, useApi } from '../../../services/api.ts';
import { usePolling } from '../../../services/store.tsx';
import type { Store, StoreConnection } from '../../../types/store.ts';
import { Notice } from '../../molecules/Notice.tsx';
import { Badge } from '../../atoms/Badge.tsx';
import { Button } from '../../atoms/Button.tsx';
import { Skeleton } from '../../atoms/Skeleton.tsx';
import { AuthedImage } from './StoreFrame.tsx';
import { ConfirmDialog } from './ConfirmDialog.tsx';

/** The business' own WhatsApp number: link it with a QR, see its state, unlink it. */
export function StoreWhatsApp({ store }: { store: Store }) {
  const api = useApi();
  const base = `/api/stores/${store.id}/connection`;
  const [status, setStatus] = useState<StoreConnection | null>(null);
  const [qrVersion, setQrVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [error, setError] = useState<string | null>(null);

  usePolling(
    async () => {
      try {
        const s = await api.get<StoreConnection>(base);
        setStatus(s);
        if (s.hasQr) setQrVersion((v) => v + 1);
      } catch (err) {
        setError(errMsg(err));
      }
    },
    4_000,
    [api, base],
  );

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`${base}/connect`);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  if (!status) return <Skeleton className="h-64" />;
  const waiting = !status.connected && (status.hasQr || status.connection === 'connecting');

  return (
    <div className="grid gap-8 md:grid-cols-[15rem_1fr]">
      <div>
        <h2 className="text-base font-extrabold text-ink dark:text-white">Número del negocio</h2>
        <p className="mt-1 text-sm leading-relaxed text-gray-dark">
          Es un número distinto al de Canix: el que tus clientes ya conocen. Se vincula como dispositivo, así que sigues pudiendo usar WhatsApp en ese teléfono y responder desde ahí.
        </p>
      </div>
      <div className="max-w-xl">
        {error && <Notice tone="error">{error}</Notice>}
        <div className="rounded-2xl border border-gray-medium/70 bg-white p-6 dark:border-white/10 dark:bg-[var(--surface)]">
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-secondary text-primary-dark dark:bg-primary/20 dark:text-white">
              <Smartphone size={20} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-bold tabular-nums text-ink dark:text-white">{status.phone ? `+${status.phone}` : 'Sin número vinculado'}</p>
              <p className="text-xs text-gray-dark">{status.connected ? 'Recibiendo y respondiendo mensajes' : status.linked ? 'Vinculado, sin conexión ahora' : 'Aún no se ha vinculado'}</p>
            </div>
            <Badge tone={status.connected ? 'success' : status.banSuspected ? 'error' : waiting ? 'warning' : 'neutral'}>
              {status.connected ? 'Conectado' : status.banSuspected ? 'Posible bloqueo' : waiting ? 'Esperando' : 'Desconectado'}
            </Badge>
          </div>

          {status.banSuspected && (
            <p className="mt-4 rounded-xl bg-error/10 px-4 py-3 text-sm text-red-800 dark:text-red-200">
              WhatsApp rechazó la conexión. Revisa en el teléfono que la cuenta no esté restringida antes de reconectar; no se reintenta solo para no empeorarlo.
            </p>
          )}

          {!status.connected && status.hasQr && (
            <div className="mt-5 flex flex-col items-center gap-3 text-center">
              <AuthedImage key={qrVersion} src={`${base}/qr?v=${qrVersion}`} alt="Código QR para vincular WhatsApp" className="h-64 w-64 rounded-2xl border border-gray-medium bg-white p-3" />
              <ol className="max-w-sm list-decimal space-y-1 pl-5 text-left text-sm text-gray-dark">
                <li>Abre WhatsApp en el teléfono del negocio.</li>
                <li>Ve a Dispositivos vinculados → Vincular un dispositivo.</li>
                <li>Escanea este código. Se actualiza solo.</li>
              </ol>
            </div>
          )}
          {!status.connected && !status.hasQr && waiting && <p className="mt-5 text-sm text-gray-dark">Generando el código QR…</p>}

          <div className="mt-5 flex flex-wrap gap-2">
            {!status.connected && !waiting && (
              <Button loading={busy} onClick={() => void connect()}>
                {status.linked ? 'Reconectar' : 'Vincular número'}
              </Button>
            )}
            {(status.linked || status.connected) && (
              <Button variant="ghost" onClick={() => setConfirmUnlink(true)}>
                Desvincular número
              </Button>
            )}
          </div>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-gray-dark">
          Si alguien del equipo responde a un cliente desde el teléfono, el asistente lo detecta y deja ese chat en manos de la persona.
        </p>
      </div>
      {confirmUnlink && (
        <ConfirmDialog
          title="Desvincular el número"
          cta="Desvincular"
          onCancel={() => setConfirmUnlink(false)}
          onConfirm={async () => {
            try {
              await api.post(`${base}/unlink`);
            } catch (err) {
              setError(errMsg(err));
            }
            setConfirmUnlink(false);
          }}
        >
          El asistente deja de recibir y responder mensajes de este número hasta que lo vuelvas a vincular con un QR nuevo. Los pedidos, el catálogo y las conversaciones no se borran.
        </ConfirmDialog>
      )}
    </div>
  );
}
