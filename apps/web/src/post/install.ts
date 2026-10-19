import { useSyncExternalStore } from 'react';

// "Install Post" on a computer (Edge, Chrome). The browser offers installing once, early, as an event; it is kept here until Settings asks for it.
type Offer = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };
let offer: Offer | null = null;
let installed = false;
const subs = new Set<() => void>();
const tell = () => subs.forEach((f) => f());

export function watchInstall() {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); offer = e as Offer; tell(); });
  window.addEventListener('appinstalled', () => { offer = null; installed = true; tell(); });
}

export async function installPost(): Promise<void> {
  const o = offer;
  if (!o) return;
  offer = null; // an offer can be used once
  tell();
  try { await o.prompt(); const r = await o.userChoice; if (r.outcome === 'accepted') installed = true; } catch { /* the browser said no: nothing to do */ }
  tell();
}

/** 'ready': the browser can install Post now. 'done': it is installed (or just was). 'none': not offered here (already installed and open in a tab, a phone, or a browser without install). */
export const useInstall = (): 'ready' | 'done' | 'none' =>
  useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => (offer ? 'ready' : installed ? 'done' : 'none'));
