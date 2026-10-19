// "Install Ledger" in Settings: Chrome and Edge hand over an install prompt that can be shown on a button press;
// Safari has none, so it gets instructions instead.
type Prompt = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

let deferred: Prompt | null = null;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((f) => f());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as Prompt; changed(); });
  window.addEventListener('appinstalled', () => { deferred = null; changed(); });
}

export const canPromptInstall = () => deferred !== null;
export const isInstalled = () => typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches;
export function onInstallChange(f: () => void) { listeners.add(f); return () => { listeners.delete(f); }; }

export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  const p = deferred;
  deferred = null;
  await p.prompt();
  const { outcome } = await p.userChoice;
  changed();
  return outcome === 'accepted';
}
