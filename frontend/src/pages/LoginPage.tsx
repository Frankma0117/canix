import { useState, type FormEvent } from 'react';
import { Phone, Lock, KeyRound, ArrowRight } from 'lucide-react';
import { useAuth } from '../services/auth.tsx';
import { Button } from '../components/atoms/Button.tsx';
import { Input, Label, Hint } from '../components/atoms/Input.tsx';
import { AuthLayout } from '../components/templates/AuthLayout.tsx';

export function LoginPage() {
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
