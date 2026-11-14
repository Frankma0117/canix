import { useEffect, useMemo, useState } from 'react';
import { AuthProvider, useAuth } from './services/auth.tsx';
import { LoginPage } from './pages/LoginPage.tsx';
import { AuthLayout } from './components/templates/AuthLayout.tsx';
import { PasswordForm } from './components/organisms/account/PasswordForm.tsx';
import { Sidebar } from './components/organisms/layout/Sidebar.tsx';
import { Topbar } from './components/organisms/layout/Topbar.tsx';
import { visibleSections, visibleModules, type ModuleId } from './config/sections.tsx';
import { BusinessContext } from './components/organisms/layout/BusinessContext.tsx';
import { useStores, usePolling } from './services/store.tsx';
import { BrandMark } from './components/atoms/Logo.tsx';

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
  if (!token || !user) return <LoginPage />;
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
  // anything after "?" belongs to the page itself (e.g. #/wardrobe?tab=review)
  const read = () => window.location.hash.replace(/^#\/?/, '').replace(/\?.*$/, '');
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
  // Only the order assistant (+ the portal itself): a business administrator, not a Canix user.
  const storeOnly = !isAdmin && !!user && user.permissions.includes('store.manage') && user.permissions.every((p) => p === 'store.manage' || p === 'portal.access');
  const sections = useMemo(() => visibleSections(isAdmin, can, storeOnly), [isAdmin, can, storeOnly]);
  const modules = useMemo(() => visibleModules(sections), [sections]);
  const [hash, navigate] = useHashSection();
  const [menuOpen, setMenuOpen] = useState(false);
  const current = sections.find((s) => s.id === hash) ?? sections.find((s) => s.module === modules[0]?.id && !s.hidden) ?? sections[0];
  const module: ModuleId = current?.module ?? modules[0]?.id ?? 'personal';

  // The business module: counters in the menu and which business is on screen.
  const hasBusiness = sections.some((s) => s.module === 'business');
  const stores = useStores(hasBusiness);
  usePolling(stores.reload, 30_000, [stores.reload]);
  const badges = useMemo(() => {
    const s = stores.store;
    const none: Record<string, number> = {};
    return s && hasBusiness ? ({ 'store-orders': s.pendingOrders, 'store-chats': s.humanChats } as Record<string, number>) : none;
  }, [stores.store, hasBusiness]);

  // Each module remembers where you were, so switching back lands in the same place.
  useEffect(() => {
    if (current) sessionStorage.setItem(`canix_last_${current.module}`, current.id);
  }, [current]);
  const switchModule = (id: ModuleId) => {
    const last = sessionStorage.getItem(`canix_last_${id}`);
    const target = sections.find((s) => s.id === last && s.module === id) ?? sections.find((s) => s.module === id && !s.hidden);
    if (target) navigate(target.id);
  };

  return (
    <div className="flex min-h-screen bg-gray-light dark:bg-[#0b0e24]">
      <Sidebar
        sections={sections}
        modules={modules}
        module={module}
        onModule={(id) => {
          switchModule(id);
        }}
        active={current?.id ?? ''}
        onNavigate={(id) => {
          navigate(id);
          setMenuOpen(false);
        }}
        badges={badges}
        context={module === 'business' && stores.data?.stores.length ? <BusinessContext stores={stores} /> : undefined}
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
