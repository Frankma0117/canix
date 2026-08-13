import { useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth.tsx';
import { Button } from './ui/Button.tsx';
import { Input, Label } from './ui/Input.tsx';

export function LockScreen() {
  const { login } = useAuth();
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const ok = await login(token.trim());
      if (!ok) setError('Token incorrecto. Revisa la consola del servidor.');
    } catch {
      setError('No se pudo conectar con el servidor.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-secondary via-gray-light to-accent/40 px-4 dark:from-[#141110] dark:via-[#141110] dark:to-[#1c1a2e]">
      <div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-primary/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -right-24 h-72 w-72 rounded-full bg-accent/30 blur-3xl" />

      <form
        onSubmit={handleSubmit}
        className="relative w-full max-w-sm rounded-3xl border border-white/60 bg-white/80 p-8 shadow-xl shadow-primary/10 backdrop-blur-xl dark:border-white/10 dark:bg-white/5"
      >
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-xl text-white shadow-lg shadow-primary/30">
            🗂️
          </div>
          <h1 className="font-display text-2xl font-semibold text-ink dark:text-white">Cania</h1>
          <p className="mt-1 text-sm text-gray-dark">Acceso restringido a tu panel personal</p>
        </div>

        <Label htmlFor="token">Token de seguridad</Label>
        <Input
          id="token"
          type="password"
          autoFocus
          placeholder="Pega tu token de acceso"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          required
        />
        {error && <p className="mt-2 text-sm text-error">{error}</p>}

        <Button type="submit" className="mt-5 w-full" disabled={loading || !token.trim()}>
          {loading ? 'Verificando…' : 'Entrar al panel'}
        </Button>

        <p className="mt-4 text-center text-xs text-gray-dark">
          Cada persona con acceso al bot tiene su propio token - pídeselo al administrador o
          revisa el mensaje de bienvenida que te mandó el bot por WhatsApp.
        </p>
      </form>
    </div>
  );
}
