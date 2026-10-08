import { useEffect, useMemo, useState } from 'react';
import { AuthProvider, useAuth } from './lib/auth.tsx';
import { LoginScreen, AuthLayout } from './components/LoginScreen.tsx';
import { PasswordForm } from './components/PasswordForm.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { visibleSections } from './lib/sections.tsx';

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}

function Gate() {
  const { token, user, loading, logout } = useAuth();
  if (loading) return <div className="flex min-h-screen items-center justify-center text-sm text-gray-dark">Cargando…</div>;
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
    <div className="flex min-h-screen bg-gray-light dark:bg-[#0f1020]">
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
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-gray-medium/70 bg-white/90 px-4 py-3 backdrop-blur lg:hidden dark:border-white/10 dark:bg-[#15162c]/90">
          <button onClick={() => setMenuOpen(true)} className="rounded-lg px-2 py-1 text-xl text-ink dark:text-white" aria-label="Abrir menú">
            ☰
          </button>
          <p className="font-display font-semibold text-ink dark:text-white">{current?.label ?? 'Cania'}</p>
        </header>
        <main className="flex-1 overflow-y-auto">{current ? current.render() : <p className="p-8 text-gray-dark">No tienes módulos habilitados todavía. Pídeselos al administrador.</p>}</main>
      </div>
    </div>
  );
}
