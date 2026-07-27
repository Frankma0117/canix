import { useEffect, useState } from 'react';
import { Smartphone } from 'lucide-react';
import { useApi } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { Card } from '../components/ui/Card.tsx';
import { Badge } from '../components/ui/Badge.tsx';

interface ConnectionStatus {
  connection: string;
  connected: boolean;
  hasQr: boolean;
}

export function ConnectionPage() {
  const api = useApi();
  const { token } = useAuth();
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);

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

  return (
    <div className="mx-auto max-w-lg p-8">
      <h1 className="mb-6 font-display text-2xl font-semibold text-ink dark:text-white">Conexión</h1>
      <Card className="flex flex-col items-center gap-5 p-8 text-center">
        {status && (
          <Badge tone={status.connected ? 'success' : started ? 'warning' : 'neutral'}>
            {status.connected ? 'Conectado' : started ? status.connection : 'Sin conectar'}
          </Badge>
        )}

        {status && !started && (
          <>
            <Smartphone size={40} className="text-primary/60" />
            <p className="max-w-xs text-sm text-gray-dark">
              El bot todavía no se ha vinculado. Reinicia el servidor y espera el código QR aquí, o
              revisa la consola.
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

        {status && started && !status.connected && !qrUrl && (
          <p className="text-sm text-gray-dark">Esperando código QR…</p>
        )}

        {status && status.connected && (
          <p className="text-sm text-gray-dark">
            El bot está en línea y respondiendo por WhatsApp. 🎉
          </p>
        )}
      </Card>
    </div>
  );
}
