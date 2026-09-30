import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { configured, supabase } from './lib/supabase';
import { getHousehold } from './lib/api';
import type { Household } from './lib/types';
import { Auth } from './components/Auth';
import { Onboarding } from './components/Onboarding';
import { Memories } from './components/Memories';
import { Places } from './components/Places';
import { CaptureKeys } from './components/CaptureKeys';

type Tab = 'memories' | 'places' | 'capture';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [household, setHousehold] = useState<Household | null>(null);
  const [loadingHousehold, setLoadingHousehold] = useState(false);
  const [tab, setTab] = useState<Tab>('memories');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const loadHousehold = useCallback(async () => {
    setLoadingHousehold(true);
    try {
      setHousehold(await getHousehold());
    } finally {
      setLoadingHousehold(false);
    }
  }, []);

  useEffect(() => {
    if (session) void loadHousehold();
    else setHousehold(null);
  }, [session, loadHousehold]);

  if (!configured) {
    return (
      <main className="card">
        <h1>Home Memory</h1>
        <p>Supabase is not configured. Copy <code>.env.example</code> to <code>.env.local</code> and fill in the project URL and anon key.</p>
      </main>
    );
  }
  if (!ready || loadingHousehold) return <main className="card muted">Loading…</main>;
  if (!session) return <Auth />;
  if (!household) return <Onboarding onDone={loadHousehold} />;

  return (
    <div className="app">
      <header>
        <strong>{household.name}</strong>
        <nav>
          <button className={tab === 'memories' ? 'tab on' : 'tab'} onClick={() => setTab('memories')}>Memories</button>
          <button className={tab === 'places' ? 'tab on' : 'tab'} onClick={() => setTab('places')}>Places</button>
          <button className={tab === 'capture' ? 'tab on' : 'tab'} onClick={() => setTab('capture')}>Capture</button>
        </nav>
        <button className="link" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </header>
      {tab === 'memories' ? (
        <Memories household={household} userId={session.user.id} />
      ) : tab === 'places' ? (
        <Places household={household} />
      ) : (
        <CaptureKeys household={household} />
      )}
    </div>
  );
}
