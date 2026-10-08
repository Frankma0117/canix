import { useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth.tsx';
import { useApi, errMsg } from '../lib/api.ts';
import { Button } from './ui/Button.tsx';
import { Input, Label } from './ui/Input.tsx';

/** Shared by the forced first-login screen and "Mi cuenta". */
export function PasswordForm({ requireCurrent, onDone }: { requireCurrent: boolean; onDone?: () => void }) {
  const api = useApi();
  const { refresh, replaceToken } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [loading, setLoading] = useState(false);

  const problems = [
    next.length >= 8 ? null : 'al menos 8 caracteres',
    /[A-Za-zÁÉÍÓÚáéíóúÑñ]/.test(next) && /\d/.test(next) ? null : 'letras y números',
  ].filter(Boolean);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(false);
    if (problems.length) return setError(`La contraseña necesita ${problems.join(' y ')}.`);
    if (next !== confirm) return setError('Las contraseñas no coinciden.');
    setLoading(true);
    try {
      const res = await api.post<{ ok: true; token?: string }>('/api/auth/change-password', { current, next });
      if (res.token) replaceToken(res.token);
      await refresh();
      setOk(true);
      setCurrent('');
      setNext('');
      setConfirm('');
      onDone?.();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {requireCurrent && (
        <div>
          <Label htmlFor="cur">Contraseña actual (o la temporal que te llegó)</Label>
          <Input id="cur" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </div>
      )}
      <div>
        <Label htmlFor="new">Nueva contraseña</Label>
        <Input id="new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
        <p className="mt-1 text-xs text-gray-dark">Mínimo 8 caracteres, con letras y números.</p>
      </div>
      <div>
        <Label htmlFor="conf">Repite la nueva contraseña</Label>
        <Input id="conf" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
      </div>
      {error && <p className="text-sm text-error">{error}</p>}
      {ok && <p className="text-sm text-success">Contraseña actualizada. Se cerraron tus otras sesiones abiertas.</p>}
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? 'Guardando…' : 'Guardar contraseña'}
      </Button>
    </form>
  );
}
