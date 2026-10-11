import { useEffect, useState } from 'react';
import { FlaskConical, LogOut, Play } from 'lucide-react';
import { useApi, errMsg } from '../../lib/api.ts';
import { useAuth } from '../../lib/auth.tsx';
import type { PermissionDef, PermissionPackage } from '../../lib/types.ts';
import { Page, Notice, SectionTitle } from '../../components/ui/Page.tsx';
import { Card } from '../../components/ui/Card.tsx';
import { Badge } from '../../components/ui/Badge.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { useToast } from '../../components/ui/Toast.tsx';
import { PermissionChecklist } from './PermissionPicker.tsx';

/**
 * "Modo prueba": the administrator tries Canix on WhatsApp as someone with one package (or a
 * hand-picked set of functions) would get it. Nothing is removed from the administrator - the bot
 * just answers with that reduced access until the mode is turned off, here or with "/prueba salir".
 */
export function TestModePage() {
  const api = useApi();
  const toast = useToast();
  const { user, refresh } = useAuth();
  const [packages, setPackages] = useState<PermissionPackage[]>([]);
  const [catalog, setCatalog] = useState<PermissionDef[]>([]);
  const [custom, setCustom] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const active = user?.testMode ?? null;

  useEffect(() => {
    Promise.all([api.get<PermissionPackage[]>('/api/admin/packages'), api.get<PermissionDef[]>('/api/admin/permissions')])
      .then(([p, c]) => {
        setPackages(p.filter((x) => x.permissions.length > 0));
        setCatalog(c);
      })
      .catch((e) => setError(errMsg(e)));
  }, [api]);

  const labelOf = (k: string) => catalog.find((c) => c.key === k)?.label ?? k;

  async function start(key: string, body: { packageId?: number; permissions?: string[]; label?: string }, label: string) {
    setBusy(key);
    setError(null);
    try {
      await api.post('/api/admin/test-mode', body);
      await refresh();
      toast.success(`Modo prueba activado: ${label}. Escríbele a Canix por WhatsApp para probarlo.`);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  async function stop() {
    setBusy('stop');
    setError(null);
    try {
      await api.del('/api/admin/test-mode');
      await refresh();
      toast.success('Saliste del modo prueba. Tienes de nuevo todas tus funciones.');
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Page
      title="Modo prueba"
      eyebrow="Administración"
      wide
      description="Prueba Canix en WhatsApp tal como lo vería una persona con un paquete: solo esas funciones, ese menú y sin comandos de administrador. Tu acceso real no cambia y este portal sigue completo; al salir recuperas todo de inmediato."
    >
      {error && <Notice tone="error">{error}</Notice>}

      {active ? (
        <Card className="mb-6 border-amber-300 bg-amber-50 p-5 dark:border-amber-400/30 dark:bg-amber-500/10">
          <div className="flex flex-wrap items-start gap-4">
            <FlaskConical size={28} className="mt-0.5 shrink-0 text-amber-700 dark:text-amber-200" />
            <div className="min-w-0 flex-1">
              <p className="font-display text-lg font-extrabold text-ink dark:text-white">Estás probando: {active.label}</p>
              <p className="mt-1 text-sm text-gray-dark">En WhatsApp, Canix te responde ahora mismo solo con estas funciones:</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {active.permissions.map((k) => (
                  <Badge key={k} tone="warning">
                    {labelOf(k)}
                  </Badge>
                ))}
              </div>
              <p className="mt-3 text-sm text-gray-dark">
                También puedes salir desde WhatsApp escribiendo <strong>/prueba salir</strong>.
              </p>
            </div>
            <Button variant="danger" onClick={stop} loading={busy === 'stop'}>
              <LogOut size={16} /> Salir del modo prueba
            </Button>
          </div>
        </Card>
      ) : (
        <Notice tone="info">
          No estás en modo prueba: tienes tu acceso completo de administrador. Elige abajo qué quieres probar; también puedes hacerlo desde WhatsApp con{' '}
          <strong>/prueba</strong>.
        </Notice>
      )}

      <SectionTitle hint="Lo mismo que recibe alguien a quien le asignas ese paquete">Probar un paquete</SectionTitle>
      <div className="grid gap-3 md:grid-cols-2">
        {packages.map((p) => {
          const isActive = active?.label === p.name;
          return (
            <Card key={p.id} className={`flex flex-col p-4 ${isActive ? 'ring-2 ring-amber-400' : ''}`}>
              <p className="font-display font-semibold text-ink dark:text-white">{p.name}</p>
              <p className="text-sm text-gray-dark">{p.description}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {p.permissions.map((k) => (
                  <Badge key={k} tone="neutral">
                    {labelOf(k)}
                  </Badge>
                ))}
              </div>
              <div className="mt-4 flex flex-1 items-end">
                <Button
                  variant={isActive ? 'secondary' : 'soft'}
                  disabled={isActive || busy !== null}
                  loading={busy === `pkg-${p.id}`}
                  onClick={() => start(`pkg-${p.id}`, { packageId: p.id }, p.name)}
                >
                  <Play size={15} /> {isActive ? 'Probando ahora' : 'Probar este paquete'}
                </Button>
              </div>
            </Card>
          );
        })}
      </div>

      <SectionTitle hint="Para probar una combinación que todavía no es un paquete">Probar funciones sueltas</SectionTitle>
      <Card className="p-4">
        <PermissionChecklist catalog={catalog} selected={custom} onChange={setCustom} />
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-gray-dark">
            {custom.length === 0 ? 'Marca al menos una función.' : `${custom.length} ${custom.length === 1 ? 'función elegida' : 'funciones elegidas'}.`}
          </p>
          <Button
            disabled={custom.length === 0 || busy !== null}
            loading={busy === 'custom'}
            onClick={() => start('custom', { permissions: custom, label: 'Selección personalizada' }, 'selección personalizada')}
          >
            <Play size={15} /> Probar esta selección
          </Button>
        </div>
      </Card>
    </Page>
  );
}
