import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { configured, supabase } from './lib/supabase';
import { getHousehold } from './lib/api';
import { applyGlass, getGlass } from './lib/glass';
import type { Household } from './lib/types';
import { Auth } from './components/Auth';
import { Onboarding } from './components/Onboarding';
import { Nav, type Tab } from './components/Nav';
import { Todo } from './components/Todo';
import { House } from './components/House';
import { Places } from './components/Places';
import { Settings } from './components/Settings';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [household, setHousehold] = useState<Household | null>(null);
  const [loadingHousehold, setLoadingHousehold] = useState(false);
  const [tab, setTab] = useState<Tab>('todo');

  useEffect(() => { applyGlass(getGlass()); }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const loadHousehold = useCallback(async () => {
    setLoadingHousehold(true);
    try { setHousehold(await getHousehold()); } finally { setLoadingHousehold(false); }
  }, []);

  useEffect(() => {
    if (session) void loadHousehold();
    else setHousehold(null);
  }, [session, loadHousehold]);

  if (!configured) {
    return (
      <main className="page narrow">
        <h1>Home Memory</h1>
        <p>Supabase is not configured. Copy <code>.env.example</code> to <code>.env.local</code> and fill in the project URL and anon key.</p>
      </main>
    );
  }
  if (!ready || loadingHousehold) return <main className="page narrow"><span className="muted">Loading…</span></main>;
  if (!session) return <Auth />;
  if (!household) return <Onboarding onDone={loadHousehold} />;

  return (
    <>
      {tab === 'todo' && <Todo household={household} userId={session.user.id} />}
      {tab === 'house' && <House household={household} />}
      {tab === 'places' && <Places household={household} />}
      {tab === 'settings' && <Settings household={household} />}
      <Nav tab={tab} onChange={setTab} />
    </>
  );
}
