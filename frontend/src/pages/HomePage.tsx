import { useMemo } from 'react';
import { ArrowRight, Users, Grid3x3, MessageCircle } from 'lucide-react';
import { useAuth } from '../services/auth.tsx';
import { visibleSections } from '../config/sections.tsx';
import { goTo } from '../utils/navigation.ts';
import { Sticker, greetingSticker } from '../components/atoms/Sticker.tsx';
import { Card } from '../components/atoms/Card.tsx';
import { Notice } from '../components/molecules/Notice.tsx';
import { SectionTitle } from '../components/molecules/SectionTitle.tsx';
import { Button } from '../components/atoms/Button.tsx';
import { AdminOverview } from '../components/organisms/home/AdminOverview.tsx';

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
