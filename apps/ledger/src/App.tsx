import { useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { CommandPalette } from './components/CommandPalette';
import { ScheduleEditor } from './components/ScheduleEditor';
import { Shell } from './components/Shell';
import { NewTaskDialog } from './components/TaskForms';
import { TaskPanel } from './components/TaskPanel';
import { UIProvider } from './components/ui-state';
import { DEFAULT_THEME, supabase, wantsDemo } from './data/config';
import { DemoRepo } from './data/demoRepo';
import type { Repo } from './data/repo';
import { StoreProvider, useStore } from './data/store';
import { SupabaseRepo } from './data/supabaseRepo';
import { Calendar } from './pages/Calendar';
import { ClientDetail } from './pages/ClientDetail';
import { Clients } from './pages/Clients';
import { Home } from './pages/Home';
import { LoadError, NotInstalled, SignIn } from './pages/Auth';
import { Missing } from './pages/Missing';
import { Recurring } from './pages/Recurring';
import { Settings } from './pages/Settings';
import { Tasks } from './pages/Tasks';
import { match, RouterProvider, useRoute } from './router';
import { Button } from './ui/button';
import { PageSkeleton } from './ui/states';
import { ToastProvider } from './ui/toast';

function applyTheme(theme: string | undefined) {
  const t = theme ?? DEFAULT_THEME;
  if (t === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  try { localStorage.setItem('ledger-theme', t); } catch { /* ignore */ }
}

function Screens({ email }: { email?: string | null }) {
  const { path, navigate } = useRoute();
  const { state, snap, reload } = useStore();
  useEffect(() => applyTheme(snap.workspace.settings.theme), [snap.workspace.settings.theme]);

  if (state.kind === 'not_installed') return <NotInstalled />;
  if (state.kind === 'error') return <LoadError message={state.message} retry={() => void reload()} />;
  let page;
  if (state.kind === 'loading') page = <PageSkeleton />;
  else if (path === '/') page = <Home />;
  else if (path === '/tasks') page = <Tasks />;
  else if (path === '/calendar') page = <Calendar />;
  else if (path === '/clients') page = <Clients />;
  else if (match('/clients/:id', path)) page = <ClientDetail key={path} id={match('/clients/:id', path)!.id} />;
  else if (path === '/recurring') page = <Recurring />;
  else if (path === '/missing') page = <Missing />;
  else if (path === '/settings') page = <Settings email={email} />;
  else page = (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-12 text-center">
      <p className="text-[15px] font-semibold">Page not found</p>
      <Button onClick={() => navigate('/')}>Go to Home</Button>
    </div>
  );
  return (
    <Shell>
      {page}
      {state.kind === 'ready' && <><TaskPanel /><NewTaskDialog /><ScheduleEditor /><CommandPalette /></>}
    </Shell>
  );
}

function Workspace({ repo, email }: { repo: Repo; email?: string | null }) {
  return (
    <StoreProvider repo={repo}>
      <UIProvider><Screens email={email} /></UIProvider>
    </StoreProvider>
  );
}

function SupabaseApp() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    const auth = supabase().auth;
    void auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  const userId = session?.user.id;
  const repo = useMemo(() => (userId ? new SupabaseRepo(supabase()) : null), [userId]);
  if (session === undefined) return null;
  if (!session || !repo) return <SignIn />;
  return <Workspace key={userId} repo={repo} email={session.user.email} />;
}

export function App() {
  const demo = useMemo(() => wantsDemo(), []);
  const demoRepo = useMemo(() => (demo ? new DemoRepo() : null), [demo]);
  return (
    <ToastProvider>
      <RouterProvider>
        {demoRepo ? <Workspace repo={demoRepo} /> : <SupabaseApp />}
      </RouterProvider>
    </ToastProvider>
  );
}
