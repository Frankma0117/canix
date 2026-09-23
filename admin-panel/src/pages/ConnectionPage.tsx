import { useEffect, useState } from 'react';
import { Smartphone } from 'lucide-react';
import { ApiError, useApi } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { Card } from '../components/ui/Card.tsx';
import { Badge } from '../components/ui/Badge.tsx';
import { Button } from '../components/ui/Button.tsx';

interface SendGuardStats {
  daysSinceFirstConnect: number;
  warmupDone: boolean;
  proactive: { usedToday: number; cap: number };
  cold: { usedToday: number; cap: number };
}

interface ConnectionStatus {
  connection: string;
  connected: boolean;
  hasQr: boolean;
  banSuspected: boolean;
  sendGuard: SendGuardStats;
}

export function ConnectionPage() {
  const api = useApi();
  const { token } = useAuth();
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [switchingNumber, setSwitchingNumber] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

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

  function describeError(err: unknown): string {
    if (err instanceof ApiError) return `${err.message} (HTTP ${err.status})`;
    if (err instanceof Error) return err.message;
    return 'Error desconocido';
  }

  async function handleReconnect() {
    setActionError(null);
    setReconnecting(true);
    try {
      await api.post('/api/connection/reconnect');
    } catch (err) {
      setActionError(describeError(err));
    } finally {
      setReconnecting(false);
    }
  }

  async function handleUseNewNumber() {
    if (
      !confirm(
        'Esto desvincula el número actual (se borra la sesión guardada) y muestra un QR nuevo para ' +
          'vincular otro número. El número anterior no se ve afectado, solo deja de estar conectado a este bot. ¿Continuar?',
      )
    )
      return;
    setActionError(null);
    setSwitchingNumber(true);
    try {
      await api.post('/api/connection/new-number');
    } catch (err) {
      setActionError(describeError(err));
    } finally {
      setSwitchingNumber(false);
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
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button onClick={handleReconnect} disabled={reconnecting} variant={status.banSuspected ? 'secondary' : 'primary'}>
              {reconnecting ? 'Reconectando…' : 'Reconectar (mismo número)'}
            </Button>
            <Button onClick={handleUseNewNumber} disabled={switchingNumber} variant={status.banSuspected ? 'primary' : 'ghost'}>
              {switchingNumber ? 'Generando QR…' : 'Usar otro número'}
            </Button>
          </div>
        )}

        {actionError && (
          <p className="max-w-xs text-sm text-error">
            No se pudo completar la acción: {actionError}
          </p>
        )}
      </Card>

      {status?.sendGuard && (
        <Card className="mt-4 p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink dark:text-white">Límite diario de envíos</h2>
            {!status.sendGuard.warmupDone && (
              <Badge tone="warning">Calentando: día {status.sendGuard.daysSinceFirstConnect + 1}/14</Badge>
            )}
          </div>
          <p className="mb-4 text-xs text-gray-dark">
            Protección contra bloqueos: cuántos mensajes automáticos (recordatorios/rutinas) y a números nuevos
            (send_message a alguien que nunca le ha escrito al bot) se han mandado hoy, contra el límite
            configurado. Un número recién vinculado empieza con límites mucho más bajos y suben solos en 14 días.
          </p>
          <SendGuardBar label="Automáticos (recordatorios, rutinas, resumen semanal)" used={status.sendGuard.proactive.usedToday} cap={status.sendGuard.proactive.cap} />
          <SendGuardBar label="A números nuevos (send_message en frío)" used={status.sendGuard.cold.usedToday} cap={status.sendGuard.cold.cap} className="mt-3" />
        </Card>
      )}
    </div>
  );
}

function SendGuardBar({ label, used, cap, className }: { label: string; used: number; cap: number; className?: string }) {
  const unlimited = cap < 0; // -1 sentinel for "uncapped" (see send-guard.ts's capForWire)
  const pct = unlimited ? 0 : Math.min(100, Math.round((used / Math.max(1, cap)) * 100));
  const tone = unlimited ? 'bg-primary' : pct >= 90 ? 'bg-error' : pct >= 60 ? 'bg-warning' : 'bg-primary';
  return (
    <div className={className}>
      <div className="mb-1 flex items-center justify-between text-xs text-gray-dark">
        <span>{label}</span>
        <span>{unlimited ? `${used} / sin límite` : `${used} / ${cap}`}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-gray-medium/40">
        {!unlimited && <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />}
      </div>
    </div>
  );
}
