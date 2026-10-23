import { useAuth } from '../services/auth.tsx';
import { Card } from '../components/atoms/Card.tsx';
import { Badge } from '../components/atoms/Badge.tsx';
import { Page } from '../components/templates/Page.tsx';
import { PasswordForm } from '../components/organisms/account/PasswordForm.tsx';
import { VoicePicker } from '../components/organisms/account/VoicePicker.tsx';

export function AccountPage() {
  const { user, can } = useAuth();
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

      {can('voice.premium') && (
        <Card className="mb-5 p-5">
          <VoicePicker />
        </Card>
      )}

      <Card className="p-5">
        <p className="mb-3 font-display text-lg font-semibold text-ink dark:text-white">{user.hasPassword ? 'Cambiar contraseña' : 'Crear contraseña'}</p>
        <PasswordForm requireCurrent={user.hasPassword} />
      </Card>
    </Page>
  );
}
