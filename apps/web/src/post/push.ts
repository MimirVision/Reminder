import type { DeviceApi } from './core/server.ts';

// The browser side of the icon number. A push from your alert server wakes the service worker (sw.js), which sets the number even
// when Post is closed. Opening Post counts as "I have looked": the number is cleared here and on the server.

const b64uToBytes = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
const bytesToB64u = (buf: ArrayBuffer | null) => btoa(String.fromCharCode(...new Uint8Array(buf ?? new ArrayBuffer(0)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export const isStandalone = () => (navigator as { standalone?: boolean }).standalone === true || window.matchMedia('(display-mode: standalone)').matches;
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export async function registerWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try { return await navigator.serviceWorker.register('/post/sw.js', { scope: '/post/' }); } catch { return null; }
}

async function subscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  try { const reg = await navigator.serviceWorker.getRegistration('/post/'); return (await reg?.pushManager.getSubscription()) ?? null; } catch { return null; }
}

export const hasPush = async () => !!(await subscription()) && Notification.permission === 'granted';

export async function clearBadge() {
  try { await (navigator as { clearAppBadge?: () => Promise<void> }).clearAppBadge?.(); } catch { /* not supported: nothing to clear */ }
}

/** Marks everything as looked at: clears the icon number here and on the server. */
export async function markSeen(device: DeviceApi | null) {
  await clearBadge();
  const sub = await subscription();
  if (sub && device) await device.seen(sub.endpoint);
}

export type EnableResult = { ok: true } | { ok: false; reason: 'unsupported' | 'denied' | 'failed'; message: string };

/** Asks for permission, subscribes this phone to your alert server, and pairs it. Must be called from a tap. */
export async function enablePush(server: DeviceApi, lang: string): Promise<EnableResult> {
  if (!pushSupported()) return { ok: false, reason: 'unsupported', message: 'This needs iOS 16.4 or newer, and Post added to the Home Screen.' };
  try {
    const { publicKey } = await server.vapid();
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return { ok: false, reason: 'denied', message: 'Not allowed. Turn it on in iOS Settings, Notifications, Post.' };
    const reg = (await registerWorker()) ?? (await navigator.serviceWorker.ready);
    await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(publicKey) });
    await server.pair({ endpoint: sub.endpoint, p256dh: bytesToB64u(sub.getKey('p256dh')), auth: bytesToB64u(sub.getKey('auth')), lang: lang.startsWith('nb') || lang.startsWith('no') ? 'nb' : 'en' });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: 'failed', message: e instanceof Error ? e.message : 'Could not turn alerts on' };
  }
}
