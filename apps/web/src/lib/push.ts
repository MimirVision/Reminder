// Web Push in the browser: tell the phone/PC it may notify you, and store the subscription so the partner's phone
// can reach you. iPhone only allows this for an app added to the Home Screen (iOS 16.4+).
import { supabase } from './supabase';
import { b64uToBytes } from './base64';
import { classifyPush, type PushSupport } from './pushCore';

export { type PushSupport } from './pushCore';

const vapidKey = () => import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

export function pushSupport(): PushSupport {
  const ua = navigator.userAgent;
  return classifyPush({
    hasSW: 'serviceWorker' in navigator, hasPush: 'PushManager' in window, hasNotification: 'Notification' in window,
    isIOS: /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
    standalone: (navigator as unknown as { standalone?: boolean }).standalone === true || window.matchMedia('(display-mode: standalone)').matches,
    vapidKey: vapidKey(),
  });
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator)) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/** Asks permission (must be called from a tap), subscribes, and saves the subscription. Returns false when permission is refused. */
export async function enablePush(lang: 'en' | 'nb'): Promise<boolean> {
  const key = vapidKey();
  if (!key) throw new Error('not_configured');
  if ((await Notification.requestPermission()) !== 'granted') return false;
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(key) as BufferSource }));
  const j = sub.toJSON();
  const { error } = await supabase.rpc('save_push_subscription', { p_endpoint: sub.endpoint, p_p256dh: j.keys?.p256dh ?? '', p_auth: j.keys?.auth ?? '', p_lang: lang });
  if (error) throw new Error(error.message);
  return true;
}

export async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return;
  await supabase.from('web_push_subscriptions').delete().eq('endpoint', sub.endpoint);
  await sub.unsubscribe();
}

/** After adding to-dos: tell the partner's devices. Silent when not set up or nobody subscribed. */
export function notifyPartner(memoryIds: string[]) {
  if (memoryIds.length === 0 || !vapidKey()) return;
  void supabase.functions.invoke('notify-partner', { body: { memory_ids: memoryIds } }).catch(() => {});
}
