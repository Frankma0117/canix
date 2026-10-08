import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Users, KeyRound, Sparkles, AlertTriangle, DollarSign, Grid3x3, BarChart3, Smartphone, MessageCircle, ScrollText } from 'lucide-react';
import { useAuth } from '../lib/auth.tsx';
import { useApi } from '../lib/api.ts';
import { visibleSections, goTo } from '../lib/sections.tsx';
import type { AdminUser, AuditEntry, UsageRow } from '../lib/types.ts';
import { estimateCost, useRates, usd } from '../lib/usage.ts';
import { Sticker, greetingSticker } from '../components/brand/Sticker.tsx';
import { Card } from '../components/ui/Card.tsx';
import { Notice, StatCard, SectionTitle } from '../components/ui/Page.tsx';
import { Button } from '../components/ui/Button.tsx';

const TIPS = [
  '“Recuérdame pagar el arriendo el 5 de cada mes”',
  '“¿Qué tengo hoy?”',
  '“Crea la rutina de tomar agua a las 10am”',
  '“Guárdame este link en la categoría recetas”',
  '“Escríbele a Ana que llego tarde”',
];

export function HomePage() {
  const { user, can } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { sticker, greeting } = greetingSticker();
  const modules = useMemo(
    () => visibleSections(isAdmin, can).filter((s) => s.description && s.group !== 'Administración'),
    [isAdmin, can],
  );
  const firstName = (user?.name ?? '').split(/\s+/)[0];

  return (
    <div className="mx-auto max-w-7xl px-4 pb-16 pt-5 sm:px-8 sm:pt-8 animate-fade-in">
      {/* Hero */}
      <div className="brand-gradient relative mb-8 overflow-hidden rounded-[2rem] px-6 py-7 text-white shadow-lift sm:px-10 sm:py-9">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(rgba(255,255,255,0.16)_1px,transparent_1px)] [background-size:20px_20px]" />
        <div className="pointer-events-none absolute -right-16 -top-20 h-72 w-72 rounded-full bg-cyan/30 blur-3xl" />
        <div className="relative flex flex-wrap items-center gap-6">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-white/80">{new Date().toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
            <h1 className="mt-1 font-display text-3xl font-black leading-tight sm:text-4xl">
              {greeting}
              {firstName ? `, ${firstName}` : ''} 👋
            </h1>
            <p className="mt-2 max-w-xl text-white/85">
              {isAdmin ? 'Este es tu centro de control: quién usa el asistente, a qué tiene acceso y cuánto consume.' : 'Aquí tienes todo lo que tu asistente guarda para ti, ordenado y a un clic.'}
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              {isAdmin ? (
                <>
                  <Button variant="secondary" className="border-white/30 bg-white/95 text-primary-dark dark:bg-white dark:text-primary-dark" onClick={() => goTo('admin-users')}>
                    <Users size={16} /> Gestionar personas
                  </Button>
                  <Button variant="ghost" className="bg-white/10 text-white hover:bg-white/20 hover:text-white" onClick={() => goTo('admin-matrix')}>
                    <Grid3x3 size={16} /> Matriz de acceso
                  </Button>
                </>
              ) : (
                modules[0] && (
                  <Button variant="secondary" className="border-white/30 bg-white/95 text-primary-dark dark:bg-white dark:text-primary-dark" onClick={() => goTo(modules[0].id)}>
                    Ir a {modules[0].label} <ArrowRight size={16} />
                  </Button>
                )
              )}
            </div>
          </div>
          <Sticker name={sticker} size={170} float className="hidden drop-shadow-[0_24px_30px_rgba(10,12,50,0.4)] sm:block" />
        </div>
      </div>

      {user?.phoneKnown === false && (
        <Notice tone="warning">
          WhatsApp aún no nos ha compartido tu número real, por eso a veces aparece un código largo en su lugar. Se corrige solo la próxima vez que le escribas al bot
          {isAdmin ? ', o puedes escribirlo tú mismo en tu ficha (Personas).' : '.'}
        </Notice>
      )}

      {isAdmin && <AdminOverview />}

      <SectionTitle hint="Lo que tienes habilitado. Todo esto también se lo puedes pedir al bot por WhatsApp.">Tus módulos</SectionTitle>
      {modules.length === 0 ? (
        <Card className="p-6 text-sm text-gray-dark">Todavía no tienes módulos habilitados. Pídeselos al administrador.</Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {modules.map((s, i) => (
            <Card key={s.id} interactive className="group flex items-center gap-4 p-4 animate-fade-in" style={{ animationDelay: `${i * 35}ms` }} onClick={() => goTo(s.id)}>
              {s.sticker ? (
                <Sticker name={s.sticker} size={72} className="shrink-0 transition-transform group-hover:-rotate-6 group-hover:scale-110" />
              ) : (
                <span className="brand-gradient flex h-14 w-14 items-center justify-center rounded-2xl text-white">
                  <s.icon size={24} />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="font-display text-lg font-extrabold text-ink dark:text-white">{s.label}</p>
                <p className="text-sm text-gray-dark">{s.description}</p>
              </div>
              <ArrowRight size={18} className="shrink-0 text-gray-dark transition-transform group-hover:translate-x-1 group-hover:text-primary" />
            </Card>
          ))}
        </div>
      )}

      <SectionTitle>Pídeselo por WhatsApp</SectionTitle>
      <Card className="soft-gradient flex flex-wrap items-center gap-5 p-5">
        <Sticker name="mensaje" size={96} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 font-display text-lg font-extrabold text-ink dark:text-white">
            <MessageCircle size={18} className="text-success" /> Háblale como a un amigo
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {TIPS.map((t) => (
              <span key={t} className="rounded-full bg-white px-3 py-1.5 text-sm text-ink shadow-sm dark:bg-white/10 dark:text-white">
                {t}
              </span>
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
}

const ACTION_LABELS: Record<string, string> = {
  'access.set': 'cambió los permisos de',
  'permission.allow': 'permitió una función a',
  'permission.deny': 'denegó una función a',
  'permission.clear': 'devolvió a “según paquete” un permiso de',
  'package.assign': 'asignó un paquete a',
  'package.unassign': 'quitó un paquete a',
  'package.create': 'creó un paquete',
  'package.update': 'editó un paquete',
  'package.delete': 'borró un paquete',
  'user.removed': 'quitó el acceso a una persona',
  'user.phone_set': 'registró el número de',
  'auth.locked': 'bloqueo por intentos fallidos de',
  'auth.unlocked': 'desbloqueó a',
  'auth.sessions_revoked': 'cerró las sesiones de',
};

function AdminOverview() {
  const api = useApi();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [usage, setUsage] = useState<UsageRow[] | null>(null);
  const [audit, setAudit] = useState<AuditEntry[] | null>(null);
  const [rates] = useRates();

  useEffect(() => {
    api.get<AdminUser[]>('/api/admin/users').then(setUsers).catch(() => setUsers([]));
    api.get<{ rows: UsageRow[] }>('/api/admin/usage?days=30').then((r) => setUsage(r.rows)).catch(() => setUsage([]));
    api.get<AuditEntry[]>('/api/admin/audit?limit=6').then(setAudit).catch(() => setAudit([]));
  }, [api]);

  const list = users ?? [];
  const portal = list.filter((u) => u.role === 'admin' || u.effective.includes('portal.access')).length;
  const paid = list.filter((u) => u.role !== 'admin' && (u.effective.includes('reminders.calls') || u.effective.includes('voice.premium'))).length;
  const review = list.filter((u) => !u.phone || u.locked_until || (u.role !== 'admin' && !u.packages.length && !u.allow.length));
  const cost = (usage ?? []).reduce((s, r) => s + estimateCost(r, rates), 0);

  return (
    <>
      <div className="mb-2 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={<Users size={18} />} label="Personas con acceso" value={users ? list.length : '…'} onClick={() => goTo('admin-users')} />
        <StatCard icon={<KeyRound size={18} />} tone="cyan" label="Usan el portal" value={users ? portal : '…'} onClick={() => goTo('admin-users')} />
        <StatCard icon={<Sparkles size={18} />} tone="amber" label="Con extras de pago" value={users ? paid : '…'} hint="Llamadas o voz natural" onClick={() => goTo('admin-matrix')} />
        <StatCard icon={<DollarSign size={18} />} tone="violet" label="Costo estimado (30 días)" value={usage ? usd(cost) : '…'} onClick={() => goTo('admin-usage')} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-5">
        <Card className="p-5 lg:col-span-3">
          <p className="mb-3 flex items-center gap-2 font-display text-lg font-extrabold text-ink dark:text-white">
            <AlertTriangle size={18} className="text-amber-500" /> Para revisar
          </p>
          {users && review.length === 0 && (
            <div className="flex items-center gap-3">
              <Sticker name="control" size={72} />
              <p className="text-sm text-gray-dark">Todo en orden: todos tienen número, permisos y ninguna cuenta está bloqueada.</p>
            </div>
          )}
          <div className="space-y-2">
            {review.slice(0, 5).map((u) => (
              <button key={u.id} onClick={() => goTo('admin-users')} className="flex w-full items-center justify-between gap-3 rounded-xl bg-gray-light px-3 py-2.5 text-left text-sm hover:bg-secondary dark:bg-white/5 dark:hover:bg-white/10">
                <span className="font-semibold text-ink dark:text-white">{u.name ?? '(sin nombre)'}</span>
                <span className="text-xs text-gray-dark">
                  {!u.phone ? 'Falta su número real' : u.locked_until ? 'Cuenta bloqueada' : 'Sin permisos asignados'}
                </span>
              </button>
            ))}
          </div>
        </Card>

        <Card className="p-5 lg:col-span-2">
          <p className="mb-3 flex items-center gap-2 font-display text-lg font-extrabold text-ink dark:text-white">
            <ScrollText size={18} className="text-primary" /> Actividad reciente
          </p>
          {audit && audit.length === 0 && <p className="text-sm text-gray-dark">Sin cambios recientes.</p>}
          <ol className="space-y-3">
            {(audit ?? []).map((a) => (
              <li key={a.id} className="flex gap-3 text-sm">
                <span className="brand-gradient mt-1.5 h-2 w-2 shrink-0 rounded-full" />
                <span className="min-w-0">
                  <span className="text-ink dark:text-white">
                    <strong>{a.actor_name ?? 'Sistema'}</strong> {ACTION_LABELS[a.action] ?? a.action} {a.target_name && <strong>{a.target_name}</strong>}
                  </span>
                  <span className="block text-xs text-gray-dark">{a.created_at.replace('T', ' ').slice(0, 16)}</span>
                </span>
              </li>
            ))}
          </ol>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" variant="soft" onClick={() => goTo('admin-usage')}>
              <BarChart3 size={14} /> Uso y costos
            </Button>
            <Button size="sm" variant="soft" onClick={() => goTo('connection')}>
              <Smartphone size={14} /> Conexión WhatsApp
            </Button>
          </div>
        </Card>
      </div>
    </>
  );
}
