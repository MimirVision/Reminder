// A small router: Ledger has a handful of screens and needs nothing more. Three modes:
// - served at its own address: normal paths (/tasks);
// - served under /ledger/ on the Home Memory site: the route lives after the # (/ledger/#/tasks), so that site's server
//   and service worker never need to know Ledger's pages;
// - the hosted single-page build (IS_ARTIFACT): the page can't change its own URL, so the route is kept in memory.
import { IS_ARTIFACT } from './data/config';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type AnchorHTMLAttributes, type ReactNode } from 'react';

interface Route { path: string; query: URLSearchParams; navigate(to: string, opts?: { replace?: boolean }): void }
const Ctx = createContext<Route | null>(null);

const HASH = !IS_ARTIFACT && import.meta.env.BASE_URL !== '/';

function fromHash(): { path: string; search: string } {
  const h = location.hash.replace(/^#/, '') || '/';
  const i = h.indexOf('?');
  return i < 0 ? { path: h, search: '' } : { path: h.slice(0, i), search: h.slice(i) };
}

/** The href for an in-app path in the current mode. */
export const hrefFor = (to: string) => (HASH ? `#${to}` : to);

export function RouterProvider({ children }: { children: ReactNode }) {
  const [loc, setLoc] = useState(() => (IS_ARTIFACT ? { path: '/', search: '' } : HASH ? fromHash() : { path: location.pathname, search: location.search }));
  useEffect(() => {
    if (IS_ARTIFACT) return;
    const on = () => setLoc(HASH ? fromHash() : { path: location.pathname, search: location.search });
    if (HASH) window.addEventListener('hashchange', on);
    window.addEventListener('popstate', on);
    return () => { window.removeEventListener('popstate', on); window.removeEventListener('hashchange', on); };
  }, []);
  const navigate = useCallback((to: string, opts: { replace?: boolean } = {}) => {
    if (IS_ARTIFACT) {
      const u = new URL(to, 'https://ledger.local' + loc.path);
      if (u.pathname === loc.path && u.search === loc.search) return;
      setLoc({ path: u.pathname, search: u.search });
      if (!opts.replace && u.pathname !== loc.path) window.scrollTo(0, 0);
      return;
    }
    if (HASH) {
      const u = new URL(to, 'https://ledger.local' + loc.path);
      if (u.pathname === loc.path && u.search === loc.search) return;
      history[opts.replace ? 'replaceState' : 'pushState'](null, '', `#${u.pathname}${u.search}`);
      setLoc({ path: u.pathname, search: u.search });
      if (!opts.replace && u.pathname !== loc.path) window.scrollTo(0, 0);
      return;
    }
    const u = new URL(to, location.href);
    if (u.pathname + u.search === location.pathname + location.search) return;
    history[opts.replace ? 'replaceState' : 'pushState'](null, '', u.pathname + u.search);
    setLoc({ path: u.pathname, search: u.search });
    if (!opts.replace && u.pathname !== loc.path) window.scrollTo(0, 0);
  }, [loc.path, loc.search]);
  const value = useMemo(() => ({ path: loc.path, query: new URLSearchParams(loc.search), navigate }), [loc, navigate]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRoute(): Route {
  const r = useContext(Ctx);
  if (!r) throw new Error('useRoute outside RouterProvider');
  return r;
}

/** Matches "/clients/:id" style patterns. */
export function match(pattern: string, path: string): Record<string, string> | null {
  const a = pattern.split('/').filter(Boolean);
  const b = path.split('/').filter(Boolean);
  if (a.length !== b.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(':')) params[a[i].slice(1)] = decodeURIComponent(b[i]);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

export function Link({ to, children, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  const { navigate } = useRoute();
  return (
    <a
      href={hrefFor(to)}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented) return;
        if (!IS_ARTIFACT && (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0)) return;
        e.preventDefault();
        navigate(to);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
