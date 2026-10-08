import { useAuth } from '../lib/auth.tsx';
import { Card } from '../components/ui/Card.tsx';
import { Badge } from '../components/ui/Badge.tsx';
import { Page } from '../components/ui/Page.tsx';
import { PasswordForm } from '../components/PasswordForm.tsx';

export function AccountPage() {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <Page title="Mi cuenta">
      <Card className="mb-5 p-5">
        <p className="font-display text-lg font-semibold text-ink dark:text-white">{user.name ?? 'Sin nombre'}</p>
        <p className="text-sm text-gray-dark">+{user.phone}</p>
        <p className="mt-3 text-sm font-medium text-ink dark:text-white/80">Módulos habilitados</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {user.role === 'admin' ? (
            <Badge tone="info">Administrador - acceso total</Badge>
          ) : user.modules.length ? (
            user.modules.map((m) => (
              <Badge key={m} tone="neutral">
                {m}
              </Badge>
            ))
          ) : (
            <span className="text-sm text-gray-dark">Ninguno todavía.</span>
          )}
        </div>
        {user.role !== 'admin' && <p className="mt-3 text-xs text-gray-dark">Los módulos los asigna el administrador.</p>}
      </Card>

      <Card className="p-5">
        <p className="mb-3 font-display text-lg font-semibold text-ink dark:text-white">{user.hasPassword ? 'Cambiar contraseña' : 'Crear contraseña'}</p>
        <PasswordForm requireCurrent={user.hasPassword} />
      </Card>
    </Page>
  );
}
