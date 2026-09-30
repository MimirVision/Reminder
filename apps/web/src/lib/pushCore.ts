// Pure part of the push setup (unit tested).
export type PushSupport = 'ok' | 'needs-install' | 'unsupported' | 'not-configured';

/** What to tell the user, from facts about the browser. Pure, unit tested. */
export function classifyPush(env: { hasSW: boolean; hasPush: boolean; hasNotification: boolean; isIOS: boolean; standalone: boolean; vapidKey: string | undefined }): PushSupport {
  if (!env.vapidKey) return 'not-configured';
  if (env.isIOS && !env.standalone) return 'needs-install';
  if (!env.hasSW || !env.hasPush || !env.hasNotification) return 'unsupported';
  return 'ok';
}
