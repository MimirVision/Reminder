import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import type { Controller, FolderTarget, FolderView, State } from '../core/controller.ts';
import { FOLDER_NAME } from '../core/folders.ts';
import { buildRoute, parseRoute, type Route } from '../core/route.ts';
import { accountColour } from '../core/settings.ts';
import type { Mail } from '../core/types.ts';

export const Ctx = createContext<Controller>(null as unknown as Controller);
export const useC = () => useContext(Ctx);
export function useS(): State { const c = useC(); return useSyncExternalStore(c.subscribe, c.getState); }

export function useRoute(): Route {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => { const on = () => setHash(location.hash); window.addEventListener('hashchange', on); return () => window.removeEventListener('hashchange', on); }, []);
  return parseRoute(hash);
}
/** Goes to a screen. `replace`: instead of this one, so Back skips it (what you just archived is not worth going back to). */
export const go = (r: Route, opts: { replace?: boolean } = {}) => { if (opts.replace) location.replace(buildRoute(r)); else location.hash = buildRoute(r); };
export const back = (fallback: Route = { name: 'inbox' }) => { if (history.length > 1 && !(window as { __first?: boolean }).__first) history.back(); else go(fallback); };

/** Opens a message: a draft goes to the editor (it is not read, it is finished), anything else to the reader. */
export const openMail = (m: Pick<Mail, 'account' | 'id' | 'draft'>, opts: { replace?: boolean } = {}) =>
  go(m.draft ? { name: 'compose', mode: 'draft', account: m.account, id: m.id } : { name: 'message', account: m.account, id: m.id }, opts);

/** The screen of a folder (the inbox is the inbox). */
export const routeOfFolder = (t: FolderTarget): Route =>
  t.kind === 'inbox' ? { name: 'inbox' } : { name: 'folder', kind: t.kind, ...(t.account ? { account: t.account } : {}), ...(t.id ? { id: t.id } : {}) };

/** The folder a folder route means. */
export const targetOfRoute = (r: Extract<Route, { name: 'folder' }>): FolderTarget => ({ kind: r.kind, ...(r.account ? { account: r.account } : {}), ...(r.id ? { id: r.id } : {}) });

/** The open folder, when it holds this message: the list the reader moves through (next, previous) and goes back to. */
export const folderContext = (s: State, key: string | null): FolderView | null => (key && s.folder?.items.some((m) => m.key === key) ? s.folder : null);

/** What a folder is called on screen: the standard ones in Post's words, one of your own by the name you gave it (once the folders are listed). */
export const folderTitle = (s: State, t: FolderTarget): string =>
  t.kind === 'other' ? s.folders.find((f) => f.account === t.account && f.id === t.id)?.name ?? 'Folder' : FOLDER_NAME[t.kind];

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

/** Whether a media query matches now, and again whenever it changes. */
export function useMedia(query: string): boolean {
  const q = typeof matchMedia === 'function' ? matchMedia(query) : null;
  const [w, setW] = useState(!!q?.matches);
  useEffect(() => { if (!q) return; const on = () => setW(q.matches); q.addEventListener('change', on); return () => q.removeEventListener('change', on); }, [q]);
  return w;
}

/** True on a computer-sized window: the app shows a sidebar, the list and the reading pane side by side. */
export const useWide = () => useMedia('(min-width: 900px)');
/** True when the reading pane is wide enough for every action in a bar along its top; narrower, the pane keeps the floating bar of the phone. */
export const useRoomyPane = () => useMedia('(min-width: 1220px)');

/** The mailbox an address in the URL means: a notification link carries the server's account id, the rest carry the address. */
export const resolveAccount = (s: State, account: string) => s.accounts.find((a) => a.id === account || a.email === account)?.email ?? account;
