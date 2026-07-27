import { useEffect, useState } from 'react';
import { Smartphone } from 'lucide-react';
import { useApi } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { Card } from '../components/ui/Card.tsx';
import { Badge } from '../components/ui/Badge.tsx';
import { Button } from '../components/ui/Button.tsx';

interface ConnectionStatus {
  connection: string;
  connected: boolean;
  hasQr: boolean;
  banSuspected: boolean;
}

export function ConnectionPage() {
  const api = useApi();
  const { token } = useAuth();
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState(false);

  useEffect(() => {
    let active = true;
    let lastObjectUrl: string | null = null;

    async function poll() {
      try {
        const s = await api.get<ConnectionStatus>('/api/connection/status');
        if (!active) return;
        setStatus(s);

        if (s.hasQr) {
          const res = await fetch('/api/connection/qr/png', {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!active || !res.ok) return;
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          if (lastObjectUrl) URL.revokeObjectURL(lastObjectUrl);
          lastObjectUrl = url;
          setQrUrl(url);
        } else {
          setQrUrl(null);
        }
      } catch {
        // silent: retried on the next tick
      }
    }
    poll();
    const interval = setInterval(poll, 4000);
    return () => {
      active = false;
      clearInterval(interval);
      if (lastObjectUrl) URL.revokeObjectURL(lastObjectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const started = status !== null && (status.connected || status.hasQr || status.connection !== 'close');

  async function handleReconnect() {
    setReconnecting(true);
    try {
      await api.post('/api/connection/reconnect');
    } catch {
      // silent: status polling will reflect whatever happens next
    } finally {
      setReconnecting(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg p-8">
      <h1 className="mb-6 font-display text-2xl font-semibold text-ink dark:text-white">Conexión</h1>
      <Card className="flex flex-col items-center gap-5 p-8 text-center">
        {status && (
          <Badge tone={status.connected ? 'success' : status.banSuspected ? 'error' : started ? 'warning' : 'neutral'}>
            {status.connected ? 'Conectado' : status.banSuspected ? 'Posible bloqueo' : started ? status.connection : 'Sin conectar'}
          </Badge>
        )}

        {status && status.banSuspected && (
          <div className="rounded-xl bg-error/10 p-4 text-sm text-error">
            <p className="font-medium">WhatsApp rechazó la conexión (403).</p>
            <p className="mt-1 text-gray-dark">
              Puede ser una restricción temporal o un bloqueo del número. Antes de reconectar, abre WhatsApp
              en el teléfono y confirma que la cuenta no aparece bloqueada/limitada. No se reintenta
              automáticamente para no empeorar el bloqueo.
            </p>
          </div>
        )}

        {status && !started && !status.banSuspected && (
          <>
            <Smartphone size={40} className="text-primary/60" />
            <p className="max-w-xs text-sm text-gray-dark">
              El bot todavía no se ha vinculado. Pulsa «Reconectar» y espera el código QR aquí.
            </p>
          </>
        )}

        {status && started && !status.connected && qrUrl && (
          <div className="flex flex-col items-center gap-3">
            <p className="max-w-xs text-sm text-gray-dark">
              Escanea este código desde WhatsApp (el número dedicado del bot) → Dispositivos vinculados.
            </p>
            <img
              src={qrUrl}
              alt="Código QR de WhatsApp"
              className="h-64 w-64 rounded-2xl border border-gray-medium bg-white p-3"
            />
          </div>
        )}

        {status && started && !status.connected && !qrUrl && !status.banSuspected && (
          <p className="text-sm text-gray-dark">Esperando código QR…</p>
        )}

        {status && status.connected && (
          <p className="text-sm text-gray-dark">
            El bot está en línea y respondiendo por WhatsApp. 🎉
          </p>
        )}

        {status && !status.connected && (
          <Button onClick={handleReconnect} disabled={reconnecting} variant={status.banSuspected ? 'secondary' : 'primary'}>
            {reconnecting ? 'Reconectando…' : 'Reconectar'}
          </Button>
        )}
      </Card>
    </div>
  );
}
