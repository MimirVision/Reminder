import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { getHousehold } from './api';
import { flush } from './outbox';
import { refreshRegions, rememberHousehold } from './reminders';
import type { Household } from './types';

type Ctx = {
  ready: boolean;
  session: Session | null;
  household: Household | null;
  reloadHousehold: () => Promise<void>;
};

const SessionContext = createContext<Ctx | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [household, setHousehold] = useState<Household | null>(null);

  const reloadHousehold = useCallback(async () => {
    try {
      const h = await getHousehold();
      setHousehold(h);
      if (h) {
        rememberHousehold(h.id);
        void flush();
        void refreshRegions().catch(() => {});
      }
    } catch {
      // offline: keep whatever we had
    }
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (session) await reloadHousehold();
      else setHousehold(null);
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [session, reloadHousehold]);

  const value = useMemo(() => ({ ready, session, household, reloadHousehold }), [ready, session, household, reloadHousehold]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Ctx {
  const c = useContext(SessionContext);
  if (!c) throw new Error('useSession outside SessionProvider');
  return c;
}
