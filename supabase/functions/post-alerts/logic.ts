// Pure logic for the `post-alerts` edge function: Microsoft Graph change notifications for new mail, the decision "does this deserve
// an alert", the alert text, token encryption, and the few Graph calls (with an injected fetch so they are unit tested).
// Tested in tests/post-alerts.test.ts. Names here start with "alert"/"graph" so this file can be bundled with notify-partner's logic.
import { b64uToBytes, bytesToB64u, isGone, localNow, type PushSub } from '../notify-partner/logic.ts';

export type AlertMode = 'people' | 'all' | 'vips' | 'off';
/** Alerts are allowed only inside this window. days: 1 = Monday ... 7 = Sunday. */
export type AlertQuiet = { days: number[]; from: string; to: string };
export type AlertAccount = {
  id: string; email: string; label: string; mode: AlertMode; vips: string[]; quiet: AlertQuiet | null; tz: string; inbox_folder_id?: string | null;
};
export type GraphMessage = {
  id: string; subject?: string; isRead?: boolean; parentFolderId?: string; inferenceClassification?: string;
  from?: { emailAddress?: { name?: string; address?: string } };
  internetMessageHeaders?: { name: string; value: string }[];
};

// ---- the webhook ----

/** Graph proves it owns the subscription by sending ?validationToken=...; we must echo it back as plain text within 10 seconds. */
export function alertValidationToken(url: string): string | null {
  const t = new URL(url).searchParams.get('validationToken');
  return t && t.length > 0 ? t : null;
}

export type AlertNotification = { subscriptionId: string; messageId: string; changeType: string };
export type AlertLifecycle = { subscriptionId: string; event: string };

const lastSegment = (s: string) => decodeURIComponent(s.split('/').filter(Boolean).pop() ?? '');

/** The new-mail notifications in a webhook body whose clientState matches the one we set. Anything else is ignored (it did not come from our subscription). */
export function alertParseNotifications(body: unknown, clientStates: Map<string, string>): AlertNotification[] {
  const list = (body as { value?: unknown[] } | null)?.value;
  if (!Array.isArray(list)) return [];
  const out: AlertNotification[] = [];
  for (const n of list as Record<string, any>[]) {
    const sub = String(n?.subscriptionId ?? '');
    const expected = clientStates.get(sub);
    if (!expected || n?.clientState !== expected || n?.lifecycleEvent) continue;
    const id = n?.resourceData?.id ?? (typeof n?.resource === 'string' ? lastSegment(n.resource) : '');
    if (!id) continue;
    out.push({ subscriptionId: sub, messageId: String(id), changeType: String(n?.changeType ?? '') });
  }
  return out;
}

export function alertParseLifecycle(body: unknown, clientStates: Map<string, string>): AlertLifecycle[] {
  const list = (body as { value?: unknown[] } | null)?.value;
  if (!Array.isArray(list)) return [];
  return (list as Record<string, any>[])
    .filter((n) => n?.lifecycleEvent && clientStates.get(String(n?.subscriptionId)) === n?.clientState)
    .map((n) => ({ subscriptionId: String(n.subscriptionId), event: String(n.lifecycleEvent) }));
}

// ---- does it deserve an alert? ----

const BULK_SENDER = /^(no[-_.]?reply|do[-_.]?not[-_.]?reply|donotreply|notifications?|newsletters?|mailer-daemon|postmaster|bounces?|marketing)$/i;

function alertHeaders(m: GraphMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of m.internetMessageHeaders ?? []) if (h?.name && !(h.name.toLowerCase() in out)) out[h.name.toLowerCase()] = String(h.value ?? '');
  return out;
}

/** Bulk mail (newsletters, notifications, receipts-by-robot) versus a person writing to you.
 *  Outlook's own Focused/Other is deliberately NOT used to stay quiet: a missed alert is worse than an extra one, so when unsure we alert. */
export function alertKind(m: GraphMessage): 'person' | 'bulk' {
  const h = alertHeaders(m);
  if (h['list-unsubscribe'] || h['list-id']) return 'bulk';
  if (/^(bulk|list|junk)$/i.test((h['precedence'] ?? '').trim())) return 'bulk';
  const auto = (h['auto-submitted'] ?? '').trim().toLowerCase();
  if (auto && auto !== 'no') return 'bulk';
  const local = (m.from?.emailAddress?.address ?? '').split('@')[0];
  if (BULK_SENDER.test(local)) return 'bulk';
  return 'person';
}

const alertMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Weekday (1 = Monday ... 7 = Sunday) and minutes since midnight at `now` in a time zone. */
export function alertLocal(now: Date, tz: string): { day: number; minutes: number } {
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(now);
  const day = ({ Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 } as Record<string, number>)[wd] ?? 1;
  return { day, minutes: localNow(now, tz).minutes };
}

export function alertWithinWindow(q: AlertQuiet | null, now: Date, tz: string): boolean {
  if (!q) return true;
  const { day, minutes } = alertLocal(now, tz);
  return q.days.includes(day) && minutes >= alertMinutes(q.from) && minutes < alertMinutes(q.to);
}

export function alertDecide(m: GraphMessage, a: AlertAccount, now: Date): { send: boolean; reason: string } {
  if (a.mode === 'off') return { send: false, reason: 'alerts are off for this account' };
  if (m.isRead) return { send: false, reason: 'already read' };
  if (a.inbox_folder_id && m.parentFolderId && m.parentFolderId !== a.inbox_folder_id) return { send: false, reason: 'not in the inbox' };
  const addr = (m.from?.emailAddress?.address ?? '').toLowerCase();
  const vip = addr !== '' && a.vips.some((v) => v.toLowerCase() === addr);
  if (vip) return { send: true, reason: 'VIP' }; // VIPs break through the schedule
  if (!alertWithinWindow(a.quiet, now, a.tz)) return { send: false, reason: 'outside this account’s alert hours' };
  if (a.mode === 'vips') return { send: false, reason: 'not a VIP' };
  if (a.mode === 'people' && alertKind(m) === 'bulk') return { send: false, reason: 'bulk mail' };
  return { send: true, reason: a.mode === 'all' ? 'all mail' : 'a person' };
}

const alertClip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** The notification text. Shows the account only when more than one is watched. */
export function alertBuild(m: GraphMessage, a: Pick<AlertAccount, 'id' | 'label'>, multi: boolean, lang: 'en' | 'nb' = 'en'): { title: string; body: string; url: string; tag: string } {
  const name = (m.from?.emailAddress?.name || m.from?.emailAddress?.address || '').trim() || (lang === 'nb' ? 'Ukjent avsender' : 'Unknown sender');
  const subject = (m.subject ?? '').replace(/\s+/g, ' ').trim() || (lang === 'nb' ? '(uten emne)' : '(no subject)');
  return {
    title: alertClip(multi && a.label ? `${name} · ${a.label}` : name, 60),
    body: alertClip(subject, 110),
    url: `/post-alerts/?open=${encodeURIComponent(m.id)}&acct=${encodeURIComponent(a.id)}`,
    tag: m.id,
  };
}

// ---- keeping the refresh token safe ----

/** AES-GCM with a 256-bit key given as base64url. Output "v1.<iv>.<ciphertext>". */
export async function alertEncrypt(plain: string, keyB64u: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', b64uToBytes(keyB64u), 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain)));
  return `v1.${bytesToB64u(iv)}.${bytesToB64u(ct)}`;
}

export async function alertDecrypt(stored: string, keyB64u: string): Promise<string> {
  const [v, iv, ct] = stored.split('.');
  if (v !== 'v1' || !iv || !ct) throw new Error('bad stored secret');
  const key = await crypto.subtle.importKey('raw', b64uToBytes(keyB64u), 'AES-GCM', false, ['decrypt']);
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64uToBytes(iv) }, key, b64uToBytes(ct)));
}

/** Constant-time string comparison for the shared secret. */
export function alertSameSecret(a: string | null, b: string): boolean {
  if (a === null || a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}

// ---- Microsoft Graph ----

const GRAPH = 'https://graph.microsoft.com/v1.0';
// Read-only on purpose: the server can read headers of new mail to decide on an alert, and cannot send, change or delete anything.
export const ALERT_SCOPE = 'offline_access https://graph.microsoft.com/Mail.Read';

export class AlertGraphError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'AlertGraphError';
    this.status = status;
    this.code = code;
  }
}

async function graphJson(res: Response): Promise<any> {
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok) throw new AlertGraphError(res.status, String(body?.error?.code ?? body?.error ?? 'error'), String(body?.error?.message ?? body?.error_description ?? text).slice(0, 200));
  return body;
}

/** Trades the stored refresh token for a short-lived access token (and a rotated refresh token, which must be stored). */
export async function alertRefresh(f: typeof fetch, p: { clientId: string; refreshToken: string }): Promise<{ accessToken: string; refreshToken: string }> {
  const res = await f('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: p.clientId, grant_type: 'refresh_token', refresh_token: p.refreshToken, scope: ALERT_SCOPE }).toString(),
  });
  const b = await graphJson(res);
  return { accessToken: String(b.access_token), refreshToken: String(b.refresh_token ?? p.refreshToken) };
}

const authHeaders = (token: string) => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });

export async function alertGetMessage(f: typeof fetch, token: string, id: string): Promise<GraphMessage> {
  const sel = 'subject,from,isRead,parentFolderId,inferenceClassification,internetMessageHeaders';
  return await graphJson(await f(`${GRAPH}/me/messages/${encodeURIComponent(id)}?$select=${sel}`, { headers: authHeaders(token) }));
}

export async function alertGetInboxId(f: typeof fetch, token: string): Promise<string> {
  const b = await graphJson(await f(`${GRAPH}/me/mailFolders/inbox?$select=id`, { headers: authHeaders(token) }));
  return String(b.id);
}

/** Outlook message subscriptions last under 7 days (10 080 minutes). We ask for 4 days and renew daily. */
export const alertExpiry = (now: Date, minutes = 5760) => new Date(now.getTime() + minutes * 60_000).toISOString();

export async function alertCreateSubscription(
  f: typeof fetch, token: string, p: { notificationUrl: string; lifecycleUrl: string; clientState: string; expires: string },
): Promise<{ id: string; expires: string }> {
  const b = await graphJson(await f(`${GRAPH}/subscriptions`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({
      changeType: 'created', notificationUrl: p.notificationUrl, lifecycleNotificationUrl: p.lifecycleUrl,
      resource: "me/mailFolders('inbox')/messages", expirationDateTime: p.expires, clientState: p.clientState,
    }),
  }));
  return { id: String(b.id), expires: String(b.expirationDateTime ?? p.expires) };
}

export async function alertRenewSubscription(f: typeof fetch, token: string, id: string, expires: string): Promise<string> {
  const b = await graphJson(await f(`${GRAPH}/subscriptions/${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: authHeaders(token), body: JSON.stringify({ expirationDateTime: expires }),
  }));
  return String(b?.expirationDateTime ?? expires);
}

/** Accounts whose subscription is missing or ends within `withinHours`: those get renewed (or created again). */
export function alertPlanRenewals<T extends { subscription_id: string | null; subscription_expires_at: string | null }>(accounts: T[], now: Date, withinHours = 30): T[] {
  const limit = now.getTime() + withinHours * 3_600_000;
  return accounts.filter((a) => !a.subscription_id || !a.subscription_expires_at || new Date(a.subscription_expires_at).getTime() < limit);
}

// ---- orchestration (the edge function only wires these to Supabase and Deno) ----

export type AlertStored = AlertAccount & {
  refresh_token_enc: string; client_state: string; subscription_id: string | null; subscription_expires_at: string | null;
};
export type AlertDevice = PushSub & { id: string; lang: string; badge?: number };
export type AlertStore = {
  accountBySubscription(subscriptionId: string): Promise<AlertStored | null>;
  allAccounts(): Promise<AlertStored[]>;
  /** true when this message had not been announced yet */
  markSeen(accountId: string, messageId: string): Promise<boolean>;
  update(accountId: string, patch: Record<string, unknown>): Promise<void>;
  upsertAccount(row: Record<string, unknown>): Promise<AlertStored>;
  deleteAccount(accountId: string): Promise<void>;
  devices(): Promise<AlertDevice[]>;
  removeDevices(ids: string[]): Promise<void>;
  /** The number shown on that phone's icon. */
  setBadge(deviceId: string, badge: number): Promise<void>;
  /** The phone opened Post: its number goes back to zero. true when the phone is known. */
  resetBadge(endpoint: string): Promise<boolean>;
};
export type AlertDeps = {
  store: AlertStore;
  fetch: typeof fetch;
  clientId: string;
  encKey: string;
  notificationUrl: string;
  send: (sub: PushSub, payload: unknown) => Promise<number>;
  now: () => Date;
};

/** A fresh access token for an account. If Microsoft rotated the refresh token, the new one is stored (encrypted). */
export async function alertAccessToken(d: AlertDeps, a: AlertStored): Promise<string> {
  const current = await alertDecrypt(a.refresh_token_enc, d.encKey);
  const t = await alertRefresh(d.fetch, { clientId: d.clientId, refreshToken: current });
  if (t.refreshToken !== current) await d.store.update(a.id, { refresh_token_enc: await alertEncrypt(t.refreshToken, d.encKey) });
  return t.accessToken;
}

// Every push shows a notification (iOS requires it) and carries the new icon number: alerts delivered to that phone since it last opened Post.
async function alertPushAll(d: AlertDeps, payload: (lang: 'en' | 'nb') => Record<string, unknown>): Promise<number> {
  const devices = await d.store.devices();
  const gone: string[] = [];
  let sent = 0;
  await Promise.all(devices.map(async (dev) => {
    try {
      const badge = (dev.badge ?? 0) + 1;
      const status = await d.send(dev, { ...payload(dev.lang === 'nb' ? 'nb' : 'en'), badge });
      if (status >= 200 && status < 300) { sent++; await d.store.setBadge(dev.id, badge); }
      else if (isGone(status)) gone.push(dev.id);
    } catch { /* one phone failing must not stop the others */ }
  }));
  if (gone.length) await d.store.removeDevices(gone);
  return sent;
}

/** New-mail notifications from Microsoft: look each message up, decide, alert. Returns what happened, for logs and tests. */
export async function alertProcess(d: AlertDeps, list: AlertNotification[]): Promise<{ id: string; outcome: string }[]> {
  const results: { id: string; outcome: string }[] = [];
  const tokens = new Map<string, string>();
  const all = list.length ? await d.store.allAccounts() : [];
  for (const n of list) {
    const a = await d.store.accountBySubscription(n.subscriptionId);
    if (!a) { results.push({ id: n.messageId, outcome: 'unknown subscription' }); continue; }
    if (!(await d.store.markSeen(a.id, n.messageId))) { results.push({ id: n.messageId, outcome: 'duplicate' }); continue; }
    try {
      let token = tokens.get(a.id);
      if (!token) { token = await alertAccessToken(d, a); tokens.set(a.id, token); }
      const m = await alertGetMessage(d.fetch, token, n.messageId);
      const verdict = alertDecide(m, a, d.now());
      if (!verdict.send) { results.push({ id: n.messageId, outcome: `skipped: ${verdict.reason}` }); continue; }
      const sent = await alertPushAll(d, (lang) => alertBuild(m, a, all.length > 1, lang));
      if (sent > 0) await d.store.update(a.id, { last_alert_at: d.now().toISOString() });
      results.push({ id: n.messageId, outcome: sent > 0 ? `alerted (${verdict.reason})` : 'no device to alert' });
    } catch (e) {
      results.push({ id: n.messageId, outcome: `error: ${e instanceof Error ? e.message : String(e)}` });
    }
  }
  return results;
}

export type AlertRegisterInput = { email: string; label?: string; refreshToken: string; mode?: AlertMode; vips?: string[]; quiet?: AlertQuiet | null; tz?: string };

const MODES: AlertMode[] = ['people', 'all', 'vips', 'off'];
export function alertCleanQuiet(q: unknown): AlertQuiet | null {
  if (!q || typeof q !== 'object') return null;
  const { days, from, to } = q as AlertQuiet;
  if (!Array.isArray(days) || !days.every((x) => Number.isInteger(x) && x >= 1 && x <= 7) || !/^\d\d:\d\d$/.test(from) || !/^\d\d:\d\d$/.test(to)) throw new Error('bad schedule');
  return { days: [...new Set(days)].sort(), from, to };
}

/** Starts watching a mailbox: stores the (encrypted) sign-in, finds the inbox, asks Microsoft to tell us about new mail. */
export async function alertRegister(d: AlertDeps, input: AlertRegisterInput): Promise<{ id: string; email: string; expires: string }> {
  const email = String(input.email ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('bad email');
  if (!input.refreshToken || typeof input.refreshToken !== 'string') throw new Error('missing sign-in');
  const mode = input.mode ?? 'people';
  if (!MODES.includes(mode)) throw new Error('bad mode');
  const row = await d.store.upsertAccount({
    email, label: (input.label ?? '').slice(0, 30), refresh_token_enc: await alertEncrypt(input.refreshToken, d.encKey),
    client_state: bytesToB64u(crypto.getRandomValues(new Uint8Array(24))), mode, vips: (input.vips ?? []).map((v) => String(v).toLowerCase()).slice(0, 200),
    quiet: alertCleanQuiet(input.quiet), tz: input.tz && /^[A-Za-z_]+\/[A-Za-z_\-+0-9]+$/.test(input.tz) ? input.tz : 'Europe/Oslo',
  });
  try {
    const token = await alertAccessToken(d, row);
    const inbox = await alertGetInboxId(d.fetch, token);
    const sub = await alertCreateSubscription(d.fetch, token, {
      notificationUrl: d.notificationUrl, lifecycleUrl: `${d.notificationUrl}?lifecycle=1`, clientState: row.client_state, expires: alertExpiry(d.now()),
    });
    await d.store.update(row.id, { inbox_folder_id: inbox, subscription_id: sub.id, subscription_expires_at: sub.expires });
    return { id: row.id, email, expires: sub.expires };
  } catch (e) {
    await d.store.deleteAccount(row.id); // never keep a sign-in that did not work
    throw e;
  }
}

/** Keeps every subscription alive (run on a schedule). A sign-in Microsoft no longer accepts triggers one "sign in again" alert. */
export async function alertRenewAll(d: AlertDeps, accounts?: AlertStored[]): Promise<{ email: string; outcome: string }[]> {
  const list = alertPlanRenewals(accounts ?? await d.store.allAccounts(), d.now());
  const out: { email: string; outcome: string }[] = [];
  for (const a of list) {
    try {
      const token = await alertAccessToken(d, a);
      const expires = alertExpiry(d.now());
      try {
        if (!a.subscription_id) throw new AlertGraphError(404, 'none', 'no subscription');
        const exp = await alertRenewSubscription(d.fetch, token, a.subscription_id, expires);
        await d.store.update(a.id, { subscription_expires_at: exp });
        out.push({ email: a.email, outcome: 'renewed' });
      } catch (e) {
        if (!(e instanceof AlertGraphError) || (e.status !== 404 && e.status !== 410)) throw e;
        const sub = await alertCreateSubscription(d.fetch, token, { notificationUrl: d.notificationUrl, lifecycleUrl: `${d.notificationUrl}?lifecycle=1`, clientState: a.client_state, expires });
        await d.store.update(a.id, { subscription_id: sub.id, subscription_expires_at: sub.expires });
        out.push({ email: a.email, outcome: 'recreated' });
      }
    } catch (e) {
      const needsSignIn = e instanceof AlertGraphError && (e.code === 'invalid_grant' || e.status === 401 || e.status === 403);
      out.push({ email: a.email, outcome: needsSignIn ? 'needs sign-in' : `error: ${e instanceof Error ? e.message : String(e)}` });
      if (needsSignIn) {
        await alertPushAll(d, (lang) => ({
          title: lang === 'nb' ? 'Post-varsler trenger innlogging' : 'Post alerts need you to sign in',
          body: lang === 'nb' ? `Logg inn p\u00e5 ${a.label || a.email} igjen i Post for \u00e5 fortsette \u00e5 f\u00e5 varsler.` : `Sign in to ${a.label || a.email} again in Post to keep getting alerts.`,
          url: '/post-alerts/', tag: `signin-${a.id}`,
        }));
      }
    }
  }
  return out;
}

/** Microsoft says a subscription needs attention: renew it right away (renewal re-authorises it). */
export async function alertLifecycle(d: AlertDeps, events: AlertLifecycle[]): Promise<string[]> {
  const out: string[] = [];
  for (const ev of events) {
    const a = await d.store.accountBySubscription(ev.subscriptionId);
    if (!a) continue;
    if (ev.event === 'reauthorizationRequired') out.push(...(await alertRenewAll(d, [{ ...a, subscription_expires_at: null }])).map((r) => r.outcome));
    else if (ev.event === 'subscriptionRemoved') out.push(...(await alertRenewAll(d, [{ ...a, subscription_id: null }])).map((r) => r.outcome));
  }
  return out;
}

export async function alertTest(d: AlertDeps): Promise<number> {
  return await alertPushAll(d, (lang) => ({
    title: lang === 'nb' ? 'Post-varsler fungerer' : 'Post alerts work',
    body: lang === 'nb' ? 'Slik ser et varsel ut n\u00e5r det kommer ny e-post.' : 'This is what an alert looks like when new mail arrives.',
    url: '/post-alerts/', tag: 'test',
  }));
}

/** Validated changes to an account's alert settings (only the keys that were sent). */
export function alertSettingsPatch(input: { label?: unknown; mode?: unknown; vips?: unknown; quiet?: unknown; tz?: unknown }): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if ('label' in input) patch.label = String(input.label ?? '').slice(0, 30);
  if ('mode' in input) {
    if (!MODES.includes(input.mode as AlertMode)) throw new Error('bad mode');
    patch.mode = input.mode;
  }
  if ('vips' in input) {
    if (!Array.isArray(input.vips)) throw new Error('bad vips');
    patch.vips = input.vips.map((v) => String(v).toLowerCase()).slice(0, 200);
  }
  if ('quiet' in input) patch.quiet = alertCleanQuiet(input.quiet);
  if ('tz' in input) {
    if (typeof input.tz !== 'string' || !/^[A-Za-z_]+\/[A-Za-z_\-+0-9]+$/.test(input.tz)) throw new Error('bad time zone');
    patch.tz = input.tz;
  }
  return patch;
}

/** Stops alerts for a mailbox: tells Microsoft to stop (best effort) and forgets the sign-in. */
export async function alertUnregister(d: AlertDeps, email: string): Promise<boolean> {
  const a = (await d.store.allAccounts()).find((x) => x.email === email.trim().toLowerCase());
  if (!a) return false;
  if (a.subscription_id) {
    try {
      const token = await alertAccessToken(d, a);
      await d.fetch(`${GRAPH}/subscriptions/${encodeURIComponent(a.subscription_id)}`, { method: 'DELETE', headers: authHeaders(token) });
    } catch { /* the subscription expires by itself within days */ }
  }
  await d.store.deleteAccount(a.id);
  return true;
}

/** The phone opened Post: clear its icon number on the server so the next alert starts again from 1. */
export async function alertSeen(d: AlertDeps, endpoint: string): Promise<boolean> {
  return await d.store.resetBadge(endpoint);
}
