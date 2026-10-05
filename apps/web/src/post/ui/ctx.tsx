import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import type { Controller, State } from '../core/controller.ts';
import { buildRoute, parseRoute, type Route } from '../core/route.ts';
import { accountColour } from '../core/settings.ts';

export const Ctx = createContext<Controller>(null as unknown as Controller);
export const useC = () => useContext(Ctx);
export function useS(): State { const c = useC(); return useSyncExternalStore(c.subscribe, c.getState); }

export function useRoute(): Route {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => { const on = () => setHash(location.hash); window.addEventListener('hashchange', on); return () => window.removeEventListener('hashchange', on); }, []);
  return parseRoute(hash);
}
export const go = (r: Route) => { location.hash = buildRoute(r); };
export const back = (fallback: Route = { name: 'inbox' }) => { if (history.length > 1 && !(window as { __first?: boolean }).__first) history.back(); else go(fallback); };

/** Re-renders now and then so a snoozed message comes back on time without a reload. */
export function useNow(ms = 30_000): number {
  const [n, setN] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setN(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return n;
}

export function useDark(theme: 'system' | 'light' | 'dark'): boolean {
  const q = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
  const [sys, setSys] = useState(!!q?.matches);
  useEffect(() => { if (!q) return; const on = () => setSys(q.matches); q.addEventListener('change', on); return () => q.removeEventListener('change', on); }, [q]);
  return theme === 'system' ? sys : theme === 'dark';
}

/** The little coloured letter on a row, shown only when more than one account is connected. */
export function useBadge(s: State) {
  const emails = s.accounts.map((a) => a.email);
  return (email: string) => {
    if (emails.length < 2) return null;
    const a = s.accounts.find((x) => x.email === email);
    return { letter: (a?.label ?? email)[0]?.toUpperCase() ?? '?', colour: accountColour(email, emails, s.settings.accountColours) };
  };
}

export const labelOf = (s: State, email: string) => s.accounts.find((a) => a.email === email)?.label ?? email;
