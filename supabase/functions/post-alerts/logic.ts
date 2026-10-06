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
    url: `/post/#/m/${encodeURIComponent(a.id)}/${encodeURIComponent(m.id)}`,
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
/** What Post may do with the mail: read and change it, and send. Mail.Read is listed on its own although Mail.ReadWrite covers it: Microsoft only
 *  lets a refresh token be redeemed for scopes that were in the original sign-in request, and the server's own refreshes use the full set, so a
 *  rotated refresh token never ends up with fewer permissions than the sign-in gave it. */
export const ALERT_APP_SCOPE = 'offline_access User.Read https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send';

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
export async function alertRefresh(f: typeof fetch, p: { clientId: string; refreshToken: string; scope?: string }): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const res = await f('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: p.clientId, grant_type: 'refresh_token', refresh_token: p.refreshToken, scope: p.scope ?? ALERT_APP_SCOPE }).toString(),
  });
  const b = await graphJson(res);
  return { accessToken: String(b.access_token), refreshToken: String(b.refresh_token ?? p.refreshToken), expiresIn: Number(b.expires_in ?? 3600) };
}

/** Trades the one-time code from the Microsoft sign-in page (PKCE, done in a normal browser tab) for tokens. Public client: no secret. */
export async function alertExchangeCode(f: typeof fetch, p: { clientId: string; code: string; verifier: string; redirectUri: string }): Promise<{ accessToken: string; refreshToken: string }> {
  const res = await f('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: p.clientId, grant_type: 'authorization_code', code: p.code, code_verifier: p.verifier, redirect_uri: p.redirectUri, scope: ALERT_APP_SCOPE }).toString(),
  });
  const b = await graphJson(res);
  if (!b.refresh_token) throw new AlertGraphError(400, 'no_refresh_token', 'Microsoft did not give a refresh token');
  return { accessToken: String(b.access_token), refreshToken: String(b.refresh_token) };
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

/** Outlook message subscriptions last under 7 days for work accounts but under 3 days (4 230 minutes) for personal Outlook.com and Hotmail
 *  accounts, and Microsoft refuses anything longer. We ask for 4 200 minutes everywhere and renew when 30 hours are left. */
export const alertExpiry = (now: Date, minutes = 4200) => new Date(now.getTime() + minutes * 60_000).toISOString();

/** Microsoft explains a too-long request as "Subscription expiration can only be 4230 minutes in the future": that number, or null. */
const alertCapMinutes = (message: string): number | null => {
  const m = /(\d{3,6})\s+minutes/.exec(message);
  return m ? Number(m[1]) : null;
};

export async function alertCreateSubscription(
  f: typeof fetch, token: string, p: { notificationUrl: string; lifecycleUrl: string; clientState: string; expires: string; now?: () => Date },
): Promise<{ id: string; expires: string }> {
  let expires = p.expires;
  let lifecycle = true;
  for (let attempt = 0; ; attempt++) {
    try {
      const b = await graphJson(await f(`${GRAPH}/subscriptions`, {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify({
          changeType: 'created', notificationUrl: p.notificationUrl, ...(lifecycle ? { lifecycleNotificationUrl: p.lifecycleUrl } : {}),
          resource: "me/mailFolders('inbox')/messages", expirationDateTime: expires, clientState: p.clientState,
        }),
      }));
      return { id: String(b.id), expires: String(b.expirationDateTime ?? expires) };
    } catch (e) {
      if (!(e instanceof AlertGraphError) || e.status !== 400 || attempt >= 2) throw e;
      const cap = alertCapMinutes(e.message);
      if (cap !== null) expires = alertExpiry((p.now ?? (() => new Date()))(), Math.max(60, cap - 30)); // "too far ahead": ask for less
      else if (lifecycle) lifecycle = false; // some accounts do not take lifecycle notifications: alerts still work, renewal just relies on the schedule
      else throw e;
    }
  }
}

export async function alertRenewSubscription(f: typeof fetch, token: string, id: string, expires: string, now: () => Date = () => new Date()): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      const b = await graphJson(await f(`${GRAPH}/subscriptions/${encodeURIComponent(id)}`, {
        method: 'PATCH', headers: authHeaders(token), body: JSON.stringify({ expirationDateTime: expires }),
      }));
      return String(b?.expirationDateTime ?? expires);
    } catch (e) {
      const cap = e instanceof AlertGraphError && e.status === 400 ? alertCapMinutes(e.message) : null;
      if (cap === null || attempt >= 1) throw e;
      expires = alertExpiry(now(), Math.max(60, cap - 30));
    }
  }
}

/** Accounts whose subscription is missing or ends within `withinHours`: those get renewed (or created again).
 *  An account Microsoft refused a subscription for a moment ago is left alone for `retryAfterMinutes`, so opening the app does not hammer Microsoft. */
export function alertPlanRenewals<T extends { subscription_id: string | null; subscription_expires_at: string | null; sub_error_at?: string | null }>(accounts: T[], now: Date, withinHours = 30, retryAfterMinutes = 30): T[] {
  const limit = now.getTime() + withinHours * 3_600_000;
  const recent = now.getTime() - retryAfterMinutes * 60_000;
  return accounts.filter((a) => (!a.subscription_id || !a.subscription_expires_at || new Date(a.subscription_expires_at).getTime() < limit)
    && !(a.sub_error_at && new Date(a.sub_error_at).getTime() > recent));
}

// ---- orchestration (the edge function only wires these to Supabase and Deno) ----

export type AlertStored = AlertAccount & {
  refresh_token_enc: string; client_state: string; subscription_id: string | null; subscription_expires_at: string | null;
  /** Why Microsoft would not start the new-mail alerts for this mailbox (the mailbox itself still works), and when that happened. */
  sub_error?: string | null; sub_error_at?: string | null;
  /** SHA-256 of the secret of each phone or computer signed in to this mailbox (at most 8, the oldest drop off). */
  session_hashes?: string[];
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
  /** A finished sign-in (sealed) waiting for the app that started it. */
  putSignin(handle: string, enc: string): Promise<void>;
  /** Returns it and removes it; null when there is none. */
  takeSignin(handle: string): Promise<string | null>;
  pruneSignins(beforeIso: string): Promise<void>;
};
export type AlertDeps = {
  store: AlertStore;
  fetch: typeof fetch;
  clientId: string;
  encKey: string;
  notificationUrl: string;
  send: (sub: PushSub, payload: unknown) => Promise<number>;
  now: () => Date;
  /** Mailboxes allowed to sign in to this server (`post_setup` / `post_allow`, or POST_ALLOWED_EMAILS). Without this list nobody can, so strangers cannot use your server. */
  allowedEmails?: string[];
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

/** Asks Microsoft to tell us about new mail in this mailbox. Never throws: the alerts are the extra, and the mailbox works without them
 *  (the reason is kept so Settings can show it, and the schedule tries again). */
async function alertSubscribe(d: AlertDeps, a: Pick<AlertStored, 'id' | 'client_state'>, token: string): Promise<{ expires: string | null; error: string | null }> {
  try {
    const sub = await alertCreateSubscription(d.fetch, token, {
      notificationUrl: d.notificationUrl, lifecycleUrl: `${d.notificationUrl}?lifecycle=1`, clientState: a.client_state, expires: alertExpiry(d.now()), now: d.now,
    });
    await d.store.update(a.id, { subscription_id: sub.id, subscription_expires_at: sub.expires, sub_error: null, sub_error_at: null });
    return { expires: sub.expires, error: null };
  } catch (e) {
    const error = (e instanceof Error ? e.message : String(e)).slice(0, 200);
    await d.store.update(a.id, { subscription_id: null, subscription_expires_at: null, sub_error: error, sub_error_at: d.now().toISOString() });
    return { expires: null, error };
  }
}

/** Starts watching a mailbox: stores the (encrypted) sign-in, finds the inbox, asks Microsoft to tell us about new mail. */
export async function alertRegister(d: AlertDeps, input: AlertRegisterInput): Promise<{ id: string; email: string; expires: string; alertsError: string | null }> {
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
  let token: string;
  try {
    token = await alertAccessToken(d, row);
    await d.store.update(row.id, { inbox_folder_id: await alertGetInboxId(d.fetch, token) });
  } catch (e) {
    await d.store.deleteAccount(row.id); // never keep a sign-in that did not work
    throw e;
  }
  const alerts = await alertSubscribe(d, row, token);
  return { id: row.id, email, expires: alerts.expires ?? '', alertsError: alerts.error };
}

/** Keeps every subscription alive (run on a schedule, and whenever Post is opened). A sign-in Microsoft no longer accepts triggers one "sign in again" alert. */
export async function alertRenewAll(d: AlertDeps, accounts?: AlertStored[]): Promise<{ email: string; outcome: string }[]> {
  const list = alertPlanRenewals(accounts ?? await d.store.allAccounts(), d.now());
  const out: { email: string; outcome: string }[] = [];
  for (const a of list) {
    try {
      const token = await alertAccessToken(d, a);
      try {
        if (!a.subscription_id) throw new AlertGraphError(404, 'none', 'no subscription');
        const exp = await alertRenewSubscription(d.fetch, token, a.subscription_id, alertExpiry(d.now()), d.now);
        await d.store.update(a.id, { subscription_expires_at: exp, sub_error: null, sub_error_at: null });
        out.push({ email: a.email, outcome: 'renewed' });
      } catch (e) {
        if (!(e instanceof AlertGraphError) || (e.status !== 404 && e.status !== 410)) throw e;
        const r = await alertSubscribe(d, a, token);
        out.push({ email: a.email, outcome: r.error ? `error: ${r.error}` : 'recreated' });
      }
    } catch (e) {
      const needsSignIn = e instanceof AlertGraphError && (e.code === 'invalid_grant' || e.status === 401 || e.status === 403);
      const message = e instanceof Error ? e.message : String(e);
      out.push({ email: a.email, outcome: needsSignIn ? 'needs sign-in' : `error: ${message}` });
      if (!needsSignIn) await d.store.update(a.id, { sub_error: message.slice(0, 200), sub_error_at: d.now().toISOString() }).catch(() => {});
      if (needsSignIn) {
        await alertPushAll(d, (lang) => ({
          title: lang === 'nb' ? 'Post-varsler trenger innlogging' : 'Post alerts need you to sign in',
          body: lang === 'nb' ? `Logg inn p\u00e5 ${a.label || a.email} igjen i Post for \u00e5 fortsette \u00e5 f\u00e5 varsler.` : `Sign in to ${a.label || a.email} again in Post to keep getting alerts.`,
          url: '/post/#/accounts', tag: `signin-${a.id}`,
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
    url: '/post/', tag: 'test',
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

// ---- sign-in without any shared key ----
// A phone or computer proves which mailbox it belongs to with a session secret that the server hands out once, right after Microsoft has
// confirmed who signed in. Only a hash is stored. Nothing has to be typed or pasted into the app.

async function sha256Hex(s: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export type AlertSignedIn = { id: string; email: string; label: string; session: string; expires: string; /** Why new-mail alerts could not start (the mailbox itself works), or null. */ alertsError?: string | null };

/** The account behind an `x-post-session` header ("<account id>.<secret>"), or null. */
export async function alertFindBySession(store: AlertStore, header: string | null): Promise<AlertStored | null> {
  if (!header) return null;
  const dot = header.indexOf('.');
  if (dot < 1) return null;
  const id = header.slice(0, dot), secret = header.slice(dot + 1);
  if (secret.length < 20) return null;
  const a = (await store.allAccounts()).find((x) => x.id === id);
  if (!a) return null;
  const hash = await sha256Hex(secret);
  return (a.session_hashes ?? []).some((h) => alertSameSecret(h, hash)) ? a : null;
}

async function issueSession(d: AlertDeps, accountId: string): Promise<string> {
  const secret = bytesToB64u(crypto.getRandomValues(new Uint8Array(32)));
  const a = (await d.store.allAccounts()).find((x) => x.id === accountId);
  const hashes = [...(a?.session_hashes ?? []), await sha256Hex(secret)].slice(-8);
  await d.store.update(accountId, { session_hashes: hashes });
  return `${accountId}.${secret}`;
}

/** Common end of both sign-in routes: learn which mailbox it is, check it is allowed, start watching it, hand out a session. */
async function finishSignIn(d: AlertDeps, tokens: { accessToken: string; refreshToken: string }, wantedLabel?: string): Promise<AlertSignedIn> {
  const me = await graphJson(await d.fetch(`${GRAPH}/me?$select=mail,userPrincipalName`, { headers: authHeaders(tokens.accessToken) }));
  const email = String(me.mail ?? me.userPrincipalName ?? '').trim().toLowerCase();
  const allowed = (d.allowedEmails ?? []).map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (!allowed.length) throw new Error(`This server does not know which mailboxes may sign in yet. In the Supabase SQL editor run: select post_allow('${email || 'you@outlook.com'}');`);
  if (!allowed.includes(email)) throw new Error(`${email || 'This account'} is not on this server's allowed list. In the Supabase SQL editor run: select post_allow('${email || 'you@outlook.com'}');`);
  const label = (wantedLabel ?? '').trim() || (/@(outlook|hotmail|live|msn)\./i.test(email) ? 'Personal' : 'Work');
  const r = await alertRegister(d, { email, label, refreshToken: tokens.refreshToken });
  return { id: r.id, email, label, session: await issueSession(d, r.id), expires: r.expires, alertsError: r.alertsError };
}

// One-button sign-in, the same on a phone and a computer. The server builds the Microsoft sign-in address (with its own PKCE secret sealed inside
// `state`), so whichever browser window Microsoft sends you back to can finish the job. If that window is not the app (iOS can open the sign-in
// in a separate view), the finished sign-in waits under the app's handle, and the app collects it as soon as it is looked at again.
const SIGNIN_TTL_MS = 15 * 60_000;
const AUTHORIZE = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';

export async function alertSigninStart(d: AlertDeps, input: { redirectUri: string; hint?: string }): Promise<{ url: string; handle: string }> {
  if (!/^https:\/\/[^\s]+$/.test(input.redirectUri ?? '')) throw new Error('bad request');
  const verifier = bytesToB64u(crypto.getRandomValues(new Uint8Array(48)));
  const handle = bytesToB64u(crypto.getRandomValues(new Uint8Array(24)));
  const challenge = bytesToB64u(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const state = await alertEncrypt(JSON.stringify({ v: verifier, h: handle, r: input.redirectUri, x: d.now().getTime() + SIGNIN_TTL_MS }), d.encKey);
  const q = new URLSearchParams({
    client_id: d.clientId, response_type: 'code', redirect_uri: input.redirectUri, response_mode: 'query', scope: ALERT_APP_SCOPE,
    code_challenge: challenge, code_challenge_method: 'S256', state, prompt: 'select_account',
  });
  if (input.hint && /^[^\s@]+@[^\s@]+$/.test(input.hint)) q.set('login_hint', input.hint);
  await d.store.pruneSignins(new Date(d.now().getTime() - 2 * SIGNIN_TTL_MS).toISOString());
  return { url: `${AUTHORIZE}?${q.toString()}`, handle };
}

export type AlertSigninResult = { status: 'pending' } | ({ status: 'done' } & AlertSignedIn);

/** Microsoft sent someone back with a code: finish the sign-in, keep the result for the app's handle, and hand it to whoever asks. */
export async function alertSigninFinish(d: AlertDeps, input: { code: string; state: string; label?: string }): Promise<{ status: 'done'; handle: string } & AlertSignedIn> {
  if (!input.code || !input.state) throw new Error('bad request');
  let sealed: { v: string; h: string; r: string; x: number };
  try { sealed = JSON.parse(await alertDecrypt(input.state, d.encKey)); } catch { throw new Error('This sign-in did not start here. Try again.'); }
  if (d.now().getTime() > sealed.x) throw new Error('The sign-in took too long. Try again.');
  const t = await alertExchangeCode(d.fetch, { clientId: d.clientId, code: input.code, verifier: sealed.v, redirectUri: sealed.r });
  const done = await finishSignIn(d, t, input.label);
  await d.store.putSignin(sealed.h, await alertEncrypt(JSON.stringify(done), d.encKey));
  return { status: 'done', handle: sealed.h, ...done };
}

/** The app asks whether the sign-in it started has finished somewhere. The result is handed over once. */
export async function alertSigninPoll(d: AlertDeps, handle: string): Promise<AlertSigninResult> {
  if (!handle || typeof handle !== 'string' || handle.length < 20) throw new Error('bad request');
  const enc = await d.store.takeSignin(handle);
  if (!enc) return { status: 'pending' };
  return { status: 'done', ...(JSON.parse(await alertDecrypt(enc, d.encKey)) as AlertSignedIn) };
}

/** Called by the app once it has the result from the landing window itself, so nothing is left waiting on the server. */
export async function alertSigninForget(d: AlertDeps, handle: string): Promise<void> {
  if (typeof handle === 'string' && handle.length >= 20) await d.store.takeSignin(handle);
}

/** What the app needs to know before anyone has signed in: nothing secret. */
export function alertPublicConfig(d: Pick<AlertDeps, 'clientId'>) {
  return { clientId: d.clientId };
}

/** A short-lived Graph access token (about an hour) for the web app to read and change mail directly. The long-lived sign-in never leaves the server. */
export async function alertMintToken(d: AlertDeps, email: string): Promise<{ accessToken: string; expiresIn: number; email: string }> {
  const a = (await d.store.allAccounts()).find((x) => x.email === email.trim().toLowerCase());
  if (!a) throw new Error('unknown account');
  const current = await alertDecrypt(a.refresh_token_enc, d.encKey);
  const t = await alertRefresh(d.fetch, { clientId: d.clientId, refreshToken: current });
  if (t.refreshToken !== current) await d.store.update(a.id, { refresh_token_enc: await alertEncrypt(t.refreshToken, d.encKey) });
  return { accessToken: t.accessToken, expiresIn: t.expiresIn, email: a.email };
}

// ---- setup without secrets ----
// Everything Post's server needs can come from Supabase's secrets (the old way) or from the `post_config` table, which `select post_setup(...)` fills.
// What is not given is made up: the key that seals sign-ins is derived from the service role key the function already has, and the key pair for
// Web Push and the key the 6-hourly renewal uses are generated once and kept in the table.

/** A 256-bit key (base64url) derived from a secret the function already holds, so sealing sign-ins needs no extra secret. */
export async function alertDeriveKey(secret: string): Promise<string> {
  const ikm = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('post-alerts'), info: new TextEncoder().encode('sealing key v1') }, ikm, 256);
  return bytesToB64u(new Uint8Array(bits));
}

/** A fresh VAPID key pair in the form `sendPush` takes: the 65-byte public point and the 32-byte private scalar, both base64url. */
export async function alertNewVapid(): Promise<{ publicKey: string; privateKey: string }> {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  return { publicKey: bytesToB64u(new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey))), privateKey: String(jwk.d) };
}

/** "a@x.no, b@y.no" (commas, semicolons or spaces) as a list of lower-case addresses. */
export const alertEmails = (list: string | null | undefined): string[] => (list ?? '').split(/[,;\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);

export type AlertConfigStore = {
  /** Every row of the post_config table. Throws when the table does not exist yet. */
  load(): Promise<Record<string, string>>;
  /** Writes only when the key has no value yet, so two requests at once cannot overwrite each other. */
  putIfMissing(key: string, value: string): Promise<void>;
  /** Writes always. */
  put(key: string, value: string): Promise<void>;
};
export type AlertConfig = {
  clientId: string | null; encKey: string | null; allowedEmails: string[];
  /** What the renewal schedule must send (header x-alerts-key). Either of these is accepted. */
  adminKeys: string[];
  vapid: { publicKey: string; privateKey: string } | null;
};

/** Settings from the environment (Supabase secrets) first, then from the post_config table; whatever is still missing and can be made up is made up and kept. */
export async function alertResolveConfig(env: (name: string) => string | undefined, store: AlertConfigStore, functionUrl: string): Promise<AlertConfig> {
  let rows: Record<string, string> = {};
  let canStore = true;
  try { rows = await store.load(); } catch { canStore = false; } // the table is not there yet: secrets only
  const e = (name: string) => env(name)?.trim() || null;

  const made: [string, string][] = [];
  const vapidEnv = e('VAPID_PUBLIC_KEY') && e('VAPID_PRIVATE_KEY') ? { publicKey: e('VAPID_PUBLIC_KEY')!, privateKey: e('VAPID_PRIVATE_KEY')! } : null;
  if (canStore && !rows.cron_key) made.push(['cron_key', bytesToB64u(crypto.getRandomValues(new Uint8Array(24)))]);
  if (canStore && !vapidEnv && !rows.vapid) made.push(['vapid', JSON.stringify(await alertNewVapid())]);
  if (made.length) {
    try {
      for (const [k, v] of made) await store.putIfMissing(k, v);
      rows = await store.load(); // if two requests raced, both read the same winner
    } catch { /* keep going with what we have */ }
  }
  if (canStore && rows.function_url !== functionUrl) { try { await store.put('function_url', functionUrl); } catch { /* the schedule just waits */ } }

  let vapid = vapidEnv;
  if (!vapid && rows.vapid) { try { const v = JSON.parse(rows.vapid); if (v?.publicKey && v?.privateKey) vapid = { publicKey: String(v.publicKey), privateKey: String(v.privateKey) }; } catch { /* regenerated never: the row is ours */ } }
  const service = e('SUPABASE_SERVICE_ROLE_KEY');
  return {
    clientId: e('MS_CLIENT_ID') ?? (rows.ms_client_id?.trim() || null),
    encKey: e('ALERTS_ENC_KEY') ?? (service ? await alertDeriveKey(service) : null),
    allowedEmails: [...new Set([...alertEmails(env('POST_ALLOWED_EMAILS')), ...alertEmails(rows.allowed_emails)])],
    adminKeys: [e('POST_ALERTS_KEY'), rows.cron_key?.trim() || null].filter((x): x is string => !!x),
    vapid,
  };
}
