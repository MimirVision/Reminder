import type { Mail } from '../core/types.ts';

// The search you were in. It stays until you clear it yourself (the x, or an empty field), or until you have been away from Search for SEARCH_KEEP_MINUTES.
// The words survive leaving Post and reloading (the Home Screen app is often restarted by iOS); the results from Outlook are only kept while Post stays open.
export const SEARCH_KEEP_MINUTES = 15;
const KEY = 'post.search';
type Kept = { q: string; remote: Mail[] | null; at: number };
let kept: Kept | null = null;
let loaded = false;
/** True while the open message came from a search result (a computer then keeps the search list beside it). */
let from = false;

const store = (k: Kept | null) => { try { if (k) localStorage.setItem(KEY, JSON.stringify({ q: k.q, at: k.at })); else localStorage.removeItem(KEY); } catch { /* private window: memory only */ } };

export function searchKept(): { q: string; remote: Mail[] | null } | null {
  if (!loaded) {
    loaded = true;
    try { const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { q?: string; at?: number } | null; if (v?.q && v.at) kept = { q: v.q, remote: null, at: v.at }; } catch { /* nothing saved */ }
  }
  if (kept && Date.now() - kept.at > SEARCH_KEEP_MINUTES * 60_000) { kept = null; store(null); }
  return kept;
}
export function keepSearch(q: string, remote: Mail[] | null) { searchKept(); kept = q.trim() ? { q, remote, at: Date.now() } : null; store(kept); }
/** Search was left: the clock for "away for a while" starts now. */
export function touchSearch() { if (kept) { kept.at = Date.now(); store(kept); } }
export const dropSearch = () => { kept = null; loaded = true; from = false; store(null); };
export const openedFromSearch = (v?: boolean) => { if (v !== undefined) from = v; return from && !!searchKept(); };
