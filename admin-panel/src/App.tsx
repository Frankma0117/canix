import { useEffect, useMemo, useState } from 'react';
import { AuthProvider, useAuth } from './lib/auth.tsx';
import { LoginScreen, AuthLayout } from './components/LoginScreen.tsx';
import { PasswordForm } from './components/PasswordForm.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { Topbar } from './components/Topbar.tsx';
import { visibleSections } from './lib/sections.tsx';
import { BrandMark } from './components/brand/Logo.tsx';

function Splash() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-gray-light dark:bg-[#0b0e24]">
      <BrandMark size={64} className="animate-float" />
      <p className="text-sm font-semibold text-gray-dark">Cargando tu espacio…</p>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}

function Gate() {
  const { token, user, loading, logout } = useAuth();
  if (loading) return <Splash />;
  if (!token || !user) return <LoginScreen />;
  if (user.mustChangePassword) {
    return (
      <AuthLayout subtitle={`Hola${user.name ? ` ${user.name}` : ''}, crea tu contraseña personal para continuar`}>
        <PasswordForm requireCurrent />
        <button onClick={logout} className="mt-4 w-full text-center text-xs text-gray-dark hover:underline">
          Salir
        </button>
      </AuthLayout>
    );
  }
  return <Shell />;
}

/** Current section lives in the URL hash (#/agenda) - survives reloads, works with back/forward. */
function useHashSection(): [string, (id: string) => void] {
  const read = () => window.location.hash.replace(/^#\/?/, '');
  const [section, setSection] = useState(read);
  useEffect(() => {
    const onHash = () => setSection(read());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return [section, (id: string) => (window.location.hash = `/${id}`)];
}

function Shell() {
  const { user, can } = useAuth();
  const isAdmin = user?.role === 'admin';
  const sections = useMemo(() => visibleSections(isAdmin, can), [isAdmin, can]);
  const [hash, navigate] = useHashSection();
  const [menuOpen, setMenuOpen] = useState(false);
  const current = sections.find((s) => s.id === hash) ?? sections[0];

  return (
    <div className="flex min-h-screen bg-gray-light dark:bg-[#0b0e24]">
      <Sidebar
        sections={sections}
        active={current?.id ?? ''}
        onNavigate={(id) => {
          navigate(id);
          setMenuOpen(false);
        }}
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar current={current} onMenu={() => setMenuOpen(true)} />
        <main key={current?.id} className="flex-1 overflow-y-auto">
          {current ? current.render() : <p className="p-8 text-gray-dark">No tienes módulos habilitados todavía. Pídeselos al administrador.</p>}
        </main>
      </div>
    </div>
  );
}
