import { useState, type FormEvent, type ReactNode } from 'react';
import { useAuth } from '../lib/auth.tsx';
import { Button } from './ui/Button.tsx';
import { Input, Label } from './ui/Input.tsx';

export function AuthLayout({ subtitle, children }: { subtitle: string; children: ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-secondary via-gray-light to-accent/40 px-4 dark:from-[#0f1020] dark:via-[#0f1020] dark:to-[#231c3d]">
      <div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-primary/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -right-24 h-72 w-72 rounded-full bg-accent/30 blur-3xl" />
      <div className="relative w-full max-w-sm rounded-3xl border border-white/60 bg-white/80 p-8 shadow-xl shadow-primary/10 backdrop-blur-xl dark:border-white/10 dark:bg-white/5">
        <div className="mb-6 text-center">
          <div className="brand-gradient mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl text-xl text-white shadow-lg shadow-primary/30">
            🤖
          </div>
          <h1 className="font-display text-2xl font-semibold text-ink dark:text-white">Cania</h1>
          <p className="mt-1 text-sm text-gray-dark">{subtitle}</p>
        </div>
        {children}
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
    <AuthLayout subtitle="Portal personal - entra con tu número de WhatsApp">
      <form onSubmit={handleSubmit}>
        {mode === 'password' ? (
          <>
            <Label htmlFor="phone">Número de WhatsApp</Label>
            <Input id="phone" inputMode="tel" autoComplete="username" autoFocus placeholder="Ej. 3001234567" value={phone} onChange={(e) => setPhone(e.target.value)} required />
            <div className="h-3" />
            <Label htmlFor="password">Contraseña</Label>
            <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </>
        ) : (
          <>
            <Label htmlFor="token">Token de administrador</Label>
            <Input id="token" type="password" autoFocus placeholder="Solo mientras no tengas contraseña" value={token} onChange={(e) => setToken(e.target.value)} required />
          </>
        )}
        {error && <p className="mt-3 text-sm text-error">{error}</p>}
        <Button type="submit" className="mt-5 w-full" disabled={loading}>
          {loading ? 'Verificando…' : 'Entrar'}
        </Button>
      </form>

      <p className="mt-4 text-center text-xs text-gray-dark">
        ¿Primera vez u olvidaste tu contraseña? Escríbele al bot por WhatsApp: <em>"cambia mi contraseña del portal"</em> y te envía
        una temporal.
      </p>
      <button
        type="button"
        onClick={() => {
          setMode(mode === 'password' ? 'token' : 'password');
          setError(null);
        }}
        className="mt-3 w-full text-center text-xs text-gray-dark underline-offset-2 hover:underline"
      >
        {mode === 'password' ? 'Soy el administrador y aún no tengo contraseña' : 'Volver a número y contraseña'}
      </button>
    </AuthLayout>
  );
}
