// Notifications on this device (this browser, on this phone or PC). Each device is turned on by a tap, because browsers
// only ask for permission then. Two ways they arrive:
// - "push": through the ledger-notify function, also with Ledger closed and the phone locked (Web Push);
// - "local": shown by Ledger itself while it is open (a tab or the installed app), when push is not available here
//   or the function is not set up yet.
import type { PushApi } from '../data/repo';
import type { PushMessage } from './reminders';

export type DeviceMode = 'off' | 'local' | 'push';
const MODE_KEY = 'ledger-notify-device';
const DISMISS_KEY = 'ledger-notify-prompt';

const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | null) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode */ } };

const listeners = new Set<() => void>();
const changed = () => listeners.forEach((f) => f());
export function onDeviceChange(f: () => void) { listeners.add(f); return () => { listeners.delete(f); }; }

export const notificationsSupported = () => typeof window !== 'undefined' && 'Notification' in window;
export const permission = (): NotificationPermission | 'unsupported' => (notificationsSupported() ? Notification.permission : 'unsupported');
export const pushSupported = () => notificationsSupported() && 'serviceWorker' in navigator && 'PushManager' in window;
export const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () => (navigator as { standalone?: boolean }).standalone === true || window.matchMedia?.('(display-mode: standalone)').matches;
/** iPhone and iPad only allow notifications from a web app added to the Home Screen. */
export const needsHomeScreen = () => isIOS() && !isStandalone();

/** What this device does. "local" or "push" only count while the permission is still granted. */
export function deviceMode(): DeviceMode {
  const m = read(MODE_KEY);
  if (permission() !== 'granted') return 'off';
  return m === 'push' || m === 'local' ? m : 'off';
}
function setMode(m: DeviceMode) { write(MODE_KEY, m); changed(); }

export const promptDismissed = () => read(DISMISS_KEY) === 'dismissed';
export function dismissPrompt() { write(DISMISS_KEY, 'dismissed'); changed(); }

/** "Chrome on Windows", "Safari on iPhone": how the device is listed in Settings. */
export function deviceLabel(ua = navigator.userAgent): string {
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'this device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
    : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${browser} on ${os}`;
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try { return (await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL)) ?? null; } catch { return null; }
}
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  try { return (await (await registration())?.pushManager.getSubscription()) ?? null; } catch { return null; }
}

const b64uToBytes = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
const bytesToB64u = (buf: ArrayBuffer | null) => btoa(String.fromCharCode(...new Uint8Array(buf ?? new ArrayBuffer(0)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export type EnableResult =
  | { ok: true; mode: 'push' }
  | { ok: true; mode: 'local'; why: 'demo' | 'no-push' | 'no-worker' | 'not_deployed' | 'not_configured' | 'offline' | 'no-database' | 'failed' }
  | { ok: false; why: 'unsupported' | 'denied' | 'home-screen' };

/** Turns notifications on for this device. Call it from a tap: that is when the browser may ask. */
export async function enableDevice(push: PushApi | null, opts: { databaseReady: boolean }): Promise<EnableResult> {
  if (!notificationsSupported()) return { ok: false, why: needsHomeScreen() ? 'home-screen' : 'unsupported' };
  const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (perm !== 'granted') return { ok: false, why: 'denied' };
  const local = (why: Extract<EnableResult, { mode: 'local' }>['why']): EnableResult => { setMode('local'); return { ok: true, mode: 'local', why }; };
  if (!push) return local('demo');
  if (!opts.databaseReady) return local('no-database');
  if (!pushSupported()) return local('no-push');
  const reg = await registration();
  if (!reg) return local('no-worker');
  const status = await push.status();
  if (!status.ok) return local(status.reason);
  try {
    const key = b64uToBytes(status.publicKey);
    let sub = await reg.pushManager.getSubscription();
    // A subscription made with other keys (they were changed on the server) cannot be reused.
    if (sub && bytesToB64u(sub.options.applicationServerKey) !== status.publicKey) { await sub.unsubscribe(); sub = null; }
    sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    await push.saveDevice({ endpoint: sub.endpoint, p256dh: bytesToB64u(sub.getKey('p256dh')), auth: bytesToB64u(sub.getKey('auth')), label: deviceLabel() });
    setMode('push');
    return { ok: true, mode: 'push' };
  } catch (e) {
    console.warn('Push subscription failed; showing reminders while Ledger is open instead', e);
    return local('failed');
  }
}

/** Turns notifications off for this device only. */
export async function disableDevice(push: PushApi | null) {
  const sub = await currentSubscription();
  if (sub) {
    try { await push?.removeDevice(sub.endpoint); } catch { /* removed on the server the next time it fails to deliver */ }
    try { await sub.unsubscribe(); } catch { /* already gone */ }
  }
  setMode('off');
}

/**
 * On start: a device in push mode re-registers its subscription (browsers renew them now and then), and falls back to
 * local reminders if the subscription is gone.
 */
export async function syncDevice(push: PushApi | null) {
  if (deviceMode() !== 'push') return;
  const sub = await currentSubscription();
  if (!sub || !push) { setMode('local'); return; }
  try {
    await push.saveDevice({ endpoint: sub.endpoint, p256dh: bytesToB64u(sub.getKey('p256dh')), auth: bytesToB64u(sub.getKey('auth')), label: deviceLabel() });
  } catch { /* offline: try again next time */ }
}

/** Shows a notification from the page (local mode), the same way the service worker shows a push. */
export async function showLocal(m: Pick<PushMessage, 'title' | 'body' | 'tag' | 'url'>, open: (path: string) => void) {
  const icon = `${import.meta.env.BASE_URL}icon-192.png`;
  const reg = await registration();
  if (reg) {
    await reg.showNotification(m.title, { body: m.body, tag: m.tag, icon, badge: icon, data: { url: m.url } });
    return;
  }
  const n = new Notification(m.title, { body: m.body, tag: m.tag, icon });
  n.onclick = () => { window.focus(); open(m.url); n.close(); };
}
