import type { ReactNode } from 'react';
import { CalendarCheck, Repeat, ShieldCheck } from 'lucide-react';
import { Logo } from '../atoms/Logo.tsx';
import { Sticker } from '../atoms/Sticker.tsx';

const PERKS = [
  { icon: CalendarCheck, text: 'Recordatorios, citas y llamadas en un solo lugar' },
  { icon: Repeat, text: 'Rutinas y hábitos con rachas para no fallar' },
  { icon: ShieldCheck, text: 'Cada persona ve solo lo que tiene habilitado' },
];

export function AuthLayout({ subtitle, children }: { subtitle: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-gray-light dark:bg-[#0b0e24]">
      {/* Hero - the mascot and what the product does (hidden on small screens) */}
      <div className="brand-gradient relative hidden w-[46%] overflow-hidden lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(rgba(255,255,255,0.18)_1px,transparent_1px)] [background-size:22px_22px]" />
        <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-cyan/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-20 h-96 w-96 rounded-full bg-[#b04cf0]/40 blur-3xl" />
        <div className="relative rounded-2xl bg-white/95 px-4 py-3 shadow-xl shadow-navy/20 backdrop-blur w-fit">
          <Logo size={40} />
        </div>
        <div className="relative">
          <Sticker name="hola" size={260} float className="mb-6 drop-shadow-[0_30px_40px_rgba(10,12,50,0.45)]" />
          <h2 className="font-display text-4xl font-black leading-tight text-white">
            Tu asistente personal,
            <br />
            ahora también en la web.
          </h2>
          <ul className="mt-6 space-y-3">
            {PERKS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-sm font-medium text-white/90">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/15 backdrop-blur">
                  <Icon size={16} />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-white/60">Canix · el mismo asistente que te habla por WhatsApp</p>
      </div>

      {/* Form */}
      <div className="relative flex flex-1 items-center justify-center px-4 py-10">
        <div className="dot-grid pointer-events-none absolute inset-0 opacity-60 [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]" />
        <div className="relative w-full max-w-md animate-pop-in">
          <div className="mb-6 flex flex-col items-center text-center lg:hidden">
            <Sticker name="hola" size={140} float />
            <div className="mt-2">
              <Logo size={36} />
            </div>
          </div>
          <div className="rounded-3xl border border-gray-medium/60 bg-white p-7 shadow-lift sm:p-8 dark:border-white/10 dark:bg-[var(--surface)]">
            <h1 className="font-display text-2xl font-black text-ink dark:text-white">¡Hola de nuevo! 👋</h1>
            <p className="mb-6 mt-1 text-sm text-gray-dark">{subtitle}</p>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
