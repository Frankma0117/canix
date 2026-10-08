import { useState, type FormEvent, type ReactNode } from 'react';
import { Phone, Lock, KeyRound, CalendarCheck, Repeat, ShieldCheck, ArrowRight } from 'lucide-react';
import { useAuth } from '../lib/auth.tsx';
import { Button } from './ui/Button.tsx';
import { Input, Label, Hint } from './ui/Input.tsx';
import { Logo } from './brand/Logo.tsx';
import { Sticker } from './brand/Sticker.tsx';

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
        <p className="relative text-xs text-white/60">Cania · el mismo asistente que te habla por WhatsApp</p>
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

export function LoginScreen() {
  const { login, loginWithToken } = useAuth();
  const [mode, setMode] = useState<'password' | 'token'>('password');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const err = mode === 'password' ? await login(phone.trim(), password) : await loginWithToken(token.trim());
    setError(err);
    setLoading(false);
  }

  return (
    <AuthLayout subtitle={mode === 'password' ? 'Entra con tu número de WhatsApp y tu contraseña.' : 'Acceso inicial del administrador.'}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {mode === 'password' ? (
          <>
            <div>
              <Label htmlFor="phone">Número de WhatsApp</Label>
              <Input
                id="phone"
                icon={<Phone size={16} />}
                inputMode="tel"
                autoComplete="username"
                autoFocus
                placeholder="Ej. 3001234567"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
              />
              <Hint>Sin espacios ni +. Si el bot te dio un "código de acceso", escríbelo aquí.</Hint>
            </div>
            <div>
              <Label htmlFor="password">Contraseña</Label>
              <Input id="password" icon={<Lock size={16} />} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
          </>
        ) : (
          <div>
            <Label htmlFor="token">Token de administrador</Label>
            <Input id="token" icon={<KeyRound size={16} />} type="password" autoFocus placeholder="Solo mientras no tengas contraseña" value={token} onChange={(e) => setToken(e.target.value)} required />
          </div>
        )}
        {error && <p className="rounded-xl bg-error/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">{error}</p>}
        <Button type="submit" size="lg" className="w-full" loading={loading}>
          {loading ? 'Verificando…' : 'Entrar'} {!loading && <ArrowRight size={18} />}
        </Button>
      </form>

      <div className="mt-6 rounded-2xl bg-secondary/70 p-4 text-sm text-ink/80 dark:bg-white/5 dark:text-white/70">
        <p className="font-semibold text-ink dark:text-white">¿Primera vez u olvidaste tu contraseña?</p>
        <p className="mt-1">
          Escríbele al bot por WhatsApp: <em>"cambia mi contraseña del portal"</em> y te envía una temporal.
        </p>
      </div>
      <button
        type="button"
        onClick={() => {
          setMode(mode === 'password' ? 'token' : 'password');
          setError(null);
        }}
        className="mt-4 w-full text-center text-xs font-medium text-gray-dark underline-offset-2 hover:text-primary hover:underline"
      >
        {mode === 'password' ? 'Soy el administrador y aún no tengo contraseña' : 'Volver a número y contraseña'}
      </button>
    </AuthLayout>
  );
}
