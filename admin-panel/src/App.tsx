import { useState } from 'react';
import { AuthProvider, useAuth } from './lib/auth.tsx';
import { LockScreen } from './components/LockScreen.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { TodosPage } from './pages/TodosPage.tsx';
import { RoutinesPage } from './pages/RoutinesPage.tsx';
import { RewardsPage } from './pages/RewardsPage.tsx';
import { RemindersPage } from './pages/RemindersPage.tsx';
import { LinksPage } from './pages/LinksPage.tsx';
import { CategoriesPage } from './pages/CategoriesPage.tsx';
import { ContactsPage } from './pages/ContactsPage.tsx';
import { ConnectionPage } from './pages/ConnectionPage.tsx';

export type SectionId =
  | 'today'
  | 'later'
  | 'routines'
  | 'rewards'
  | 'reminders'
  | 'links'
  | 'categories'
  | 'contacts'
  | 'connection';

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}

function Gate() {
  const { token } = useAuth();
  if (!token) return <LockScreen />;
  return <Shell />;
}

function Shell() {
  const [section, setSection] = useState<SectionId>('today');
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  return (
    <div className="flex min-h-screen bg-gray-light dark:bg-[#141110]">
      <Sidebar active={section} onNavigate={setSection} isAdmin={isAdmin} />
      <main className="flex-1 overflow-y-auto">
        {section === 'today' && <TodosPage scope="today" title="Pendientes de hoy" />}
        {section === 'later' && <TodosPage scope="later" title="Para después" />}
        {section === 'routines' && <RoutinesPage />}
        {section === 'rewards' && <RewardsPage />}
        {section === 'reminders' && <RemindersPage />}
        {section === 'links' && <LinksPage />}
        {section === 'categories' && <CategoriesPage />}
        {section === 'contacts' && <ContactsPage />}
        {/* Connection page manages the single shared WhatsApp session - admin only (the backend
            rejects it for anyone else too, see requirePanelAdmin in server/auth.ts). */}
        {section === 'connection' && isAdmin && <ConnectionPage />}
      </main>
    </div>
  );
}
