// "Add to home screen": what to offer on this device. Pure helpers (the browser objects are passed in) so they are unit tested.
export type InstallKind = 'installed' | 'prompt' | 'ios' | 'none';

export const isIOS = (ua: string, maxTouchPoints = 0) => /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);

/** iPhone Safari is the only iOS browser that can add to the home screen from the share menu; other iOS browsers are Safari under the hood but hide it. */
export const isIOSSafari = (ua: string) => /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo/.test(ua);

export function installKind(o: { standalone: boolean; ua: string; maxTouchPoints?: number; hasPrompt: boolean }): InstallKind {
  if (o.standalone) return 'installed';
  if (o.hasPrompt) return 'prompt';
  if (isIOS(o.ua, o.maxTouchPoints) && isIOSSafari(o.ua)) return 'ios';
  return 'none';
}

type PromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };
let saved: PromptEvent | null = null;
const listeners = new Set<() => void>();

/** Start listening as early as possible: the browser fires the event once, soon after load. */
export function watchInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); saved = e as PromptEvent; listeners.forEach((l) => l()); });
  window.addEventListener('appinstalled', () => { saved = null; listeners.forEach((l) => l()); });
}
export const onInstallChange = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

export const currentInstallKind = (): InstallKind => installKind({
  standalone: window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true,
  ua: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints, hasPrompt: !!saved,
});

export async function promptInstall(): Promise<boolean> {
  if (!saved) return false;
  const e = saved;
  saved = null;
  await e.prompt();
  const r = await e.userChoice.catch(() => ({ outcome: 'dismissed' as const }));
  listeners.forEach((l) => l());
  return r.outcome === 'accepted';
}
