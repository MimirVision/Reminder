// Runs the real edge function (functions/post-alerts/index.ts) in Node with a fake Deno, a fake Supabase and a fake Microsoft.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { bytesToB64u } from '../functions/notify-partner/logic.ts';

// 'npm:@supabase/supabase-js@2' does not exist in Node: point it at the fake below.
register('data:text/javascript,' + encodeURIComponent(`
  export async function resolve(spec, ctx, next) {
    if (spec.startsWith('npm:@supabase/supabase-js')) return { url: 'data:text/javascript,export const createClient = () => globalThis.__fakeDb.client;', shortCircuit: true };
    return next(spec, ctx);
  }`));

type Row = Record<string, any>;
/** Every `.not(...)` the function used on a query: the settings read must leave out the rows the phones taught it. */
const notCalls: unknown[][] = [];
class Query {
  private filters: ((r: Row) => boolean)[] = [];
  private op: 'select' | 'update' | 'upsert' | 'delete' = 'select';
  private payload: any; private opts: any; private returning = false;
  private db: Record<string, Row[]>;
  private table: string;
  constructor(db: Record<string, Row[]>, table: string) { this.db = db; this.table = table; }
  select() { this.returning = true; return this; }
  eq(k: string, v: unknown) { this.filters.push((r) => r[k] === v); return this; }
  lt(k: string, v: any) { this.filters.push((r) => r[k] < v); return this; }
  not(k: string, op: string, v: string) {
    notCalls.push([k, op, v]);
    if (op === 'like') { const re = new RegExp(`^${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*')}$`); this.filters.push((r) => !re.test(String(r[k]))); }
    return this;
  }
  in(k: string, vs: unknown[]) { this.filters.push((r) => vs.includes(r[k])); return this; }
  update(p: Row) { this.op = 'update'; this.payload = p; return this; }
  upsert(p: Row, o: any) { this.op = 'upsert'; this.payload = p; this.opts = o; return this; }
  delete() { this.op = 'delete'; return this; }
  maybeSingle() { return this.run().then((r) => ({ data: r.data?.[0] ?? null, error: null })); }
  single() { return this.run().then((r) => ({ data: r.data?.[0] ?? null, error: null })); }
  then(res: (v: any) => unknown, rej?: (e: unknown) => unknown) { return this.run().then(res, rej); }
  private async run(): Promise<{ data: Row[]; error: null }> {
    const rows = (this.db[this.table] ??= []);
    const match = (r: Row) => this.filters.every((f) => f(r));
    if (this.op === 'select') return { data: rows.filter(match).map((r) => ({ ...r })), error: null };
    if (this.op === 'update') { const hit = rows.filter(match); hit.forEach((r) => Object.assign(r, this.payload)); return { data: hit.map((r) => ({ ...r })), error: null }; }
    if (this.op === 'delete') { const gone = rows.filter(match); this.db[this.table] = rows.filter((r) => !match(r)); return { data: gone.map((r) => ({ ...r })), error: null }; }
    const keys = String(this.opts?.onConflict ?? 'id').split(',');
    const existing = rows.find((r) => keys.every((k) => r[k] === this.payload[k]));
    if (existing) { if (this.opts?.ignoreDuplicates) return { data: [], error: null }; Object.assign(existing, this.payload); return { data: [{ ...existing }], error: null }; }
    const row = { id: crypto.randomUUID(), last_alert_at: null, ...this.payload };
    rows.push(row);
    return { data: [{ ...row }], error: null };
  }
}

const db: Record<string, Row[]> = {};
(globalThis as any).__fakeDb = { client: { from: (t: string) => new Query(db, t) } };

// A real push subscription (so the function's encryption has real keys to work with) and real VAPID keys.
const ua = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
const vapid = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
const vapidJwk = await crypto.subtle.exportKey('jwk', vapid.privateKey);
const env: Record<string, string> = {
  SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service', POST_ALERTS_KEY: 'letmein', ALERTS_ENC_KEY: 'A'.repeat(43), MS_CLIENT_ID: 'CID', POST_ALLOWED_EMAILS: 'Andreas@Outlook.com, andreas@firma.no',
  VAPID_PUBLIC_KEY: bytesToB64u(new Uint8Array(await crypto.subtle.exportKey('raw', vapid.publicKey))), VAPID_PRIVATE_KEY: String(vapidJwk.d),
};
let handler!: (req: Request) => Promise<Response>;
(globalThis as any).Deno = { serve: (h: typeof handler) => { handler = h; }, env: { get: (k: string) => env[k] } };
await import('../functions/post-alerts/index.ts');

// Fake network: Microsoft login + Graph, and the push service.
const pushed: { url: string; bytes: number }[] = [];
let graphMessage: Row = { id: 'M1', subject: 'Re: Hytta i påska', isRead: false, parentFolderId: 'INBOX-ID', from: { emailAddress: { name: 'Maja Berg', address: 'maja@example.no' } }, internetMessageHeaders: [] };
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string | URL, init: RequestInit = {}) => {
  const u = String(url);
  const j = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
  if (u.startsWith('https://push.example/')) { pushed.push({ url: u, bytes: (init.body as Uint8Array).length }); return new Response(null, { status: 201 }); }
  if (u.includes('login.microsoftonline.com')) return j({ access_token: 'AT', refresh_token: 'RT2' });
  if (u.includes('/me?$select=mail,userPrincipalName')) return j({ mail: 'andreas@outlook.com' });
  if (u.endsWith('/subscriptions') && init.method === 'POST') return j({ id: 'SUB1', expirationDateTime: new Date(Date.now() + 4 * 86_400_000).toISOString() }, 201);
  if (u.includes('/subscriptions/')) return j({ expirationDateTime: new Date(Date.now() + 4 * 86_400_000).toISOString() });
  if (u.includes('/mailFolders/inbox')) return j({ id: 'INBOX-ID' });
  if (u.includes('/me/messages/')) return j(graphMessage);
  return realFetch(url as string, init);
}) as typeof fetch;

const URL0 = 'https://proj.supabase.co/functions/v1/post-alerts';
const call = (body: unknown, key: string | null = 'letmein') => handler(new Request(URL0, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { 'x-alerts-key': key } : {}) }, body: JSON.stringify(body) }));
const waitFor = async (cond: () => boolean) => { for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 10)); };

test('Microsoft validation request is answered with the plain-text token before anything else', async () => {
  const res = await handler(new Request(`${URL0}?validationToken=Validation%3A+hello`, { method: 'POST' }));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Content-Type'), 'text/plain');
  assert.equal(await res.text(), 'Validation: hello');
});

test('the key or a session protects every call; only the sign-in calls and the public settings are open', async () => {
  assert.equal((await call({ op: 'status' }, 'wrong')).status, 401);
  assert.equal((await call({ op: 'status' }, null)).status, 401);
  assert.equal((await call({ op: 'token', email: 'andreas@outlook.com' }, null)).status, 401);
  assert.equal((await (await call({ op: 'config' }, null)).json()).clientId, 'CID');
  // no key at all is treated as a Microsoft webhook, which is ignored unless its clientState matches
  const hook = await call({ value: [{ subscriptionId: 'x', clientState: 'y', resourceData: { id: 'a' } }] }, null);
  assert.equal(hook.status, 202);
  assert.equal((await call({ op: 'nope' })).status, 400);
  delete env.MS_CLIENT_ID;
  assert.equal((await call({ op: 'status' })).status, 503);
  env.MS_CLIENT_ID = 'CID';
});

test('whole chain: phone pairs, mailbox registers, Microsoft reports new mail, the phone gets an encrypted push', async () => {
  const vap = await (await call({ op: 'vapid' })).json();
  assert.equal(vap.publicKey, env.VAPID_PUBLIC_KEY);

  const p256dh = bytesToB64u(new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey)));
  assert.equal((await call({ op: 'pair', endpoint: 'http://insecure', p256dh, auth: 'x' })).status, 400);
  assert.equal((await call({ op: 'pair', endpoint: 'https://push.example/abc', p256dh, auth: bytesToB64u(crypto.getRandomValues(new Uint8Array(16))), lang: 'nb' })).status, 200);

  const reg = await (await call({ op: 'register', email: 'andreas@outlook.com', label: 'Personal', refreshToken: 'RT-original' })).json();
  assert.equal(reg.email, 'andreas@outlook.com');
  const stored = db.post_alert_accounts[0];
  assert.equal(stored.subscription_id, 'SUB1');
  assert.ok(!JSON.stringify(stored).includes('RT-original'), 'the sign-in is stored encrypted');

  const status = await (await call({ op: 'status' })).json();
  assert.equal(status.devices, 1);
  assert.equal(status.accounts[0].email, 'andreas@outlook.com');

  // Microsoft: a new message arrived. The function must answer 202 at once and alert in the background.
  const hook = await call({ value: [{ subscriptionId: 'SUB1', clientState: stored.client_state, changeType: 'created', resourceData: { id: 'M1' } }] }, null);
  assert.equal(hook.status, 202);
  await waitFor(() => pushed.length >= 1);
  assert.equal(pushed.length, 1);
  assert.ok(pushed[0].bytes > 100);
  await waitFor(() => !!db.post_alert_accounts[0].last_alert_at);
  assert.ok(db.post_alert_accounts[0].last_alert_at);

  // The same notification again is a duplicate: no second push.
  await call({ value: [{ subscriptionId: 'SUB1', clientState: stored.client_state, changeType: 'created', resourceData: { id: 'M1' } }] }, null);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(pushed.length, 1);

  // A newsletter does not alert in "people" mode.
  graphMessage = { ...graphMessage, id: 'M2', internetMessageHeaders: [{ name: 'List-Unsubscribe', value: '<https://x>' }] };
  await call({ value: [{ subscriptionId: 'SUB1', clientState: stored.client_state, changeType: 'created', resourceData: { id: 'M2' } }] }, null);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(pushed.length, 1);

  // A forged notification (wrong clientState) does nothing.
  await call({ value: [{ subscriptionId: 'SUB1', clientState: 'forged', changeType: 'created', resourceData: { id: 'M3' } }] }, null);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(pushed.length, 1);

  // Settings, test alert, renewal, and stopping.
  assert.equal((await call({ op: 'update', email: 'andreas@outlook.com', mode: 'all' })).status, 200);
  assert.equal(db.post_alert_accounts[0].mode, 'all');
  assert.equal((await call({ op: 'update', email: 'nobody@x.no', mode: 'all' })).status, 404);
  assert.equal((await call({ op: 'update', email: 'andreas@outlook.com', mode: 'weird' })).status, 400);
  const minted = await (await call({ op: 'token', email: 'andreas@outlook.com' })).json();
  assert.equal(minted.accessToken, 'AT');
  assert.equal((await call({ op: 'token', email: 'nobody@x.no' })).status, 400);
  assert.equal((await (await call({ op: 'test' })).json()).sent, 1);
  assert.equal(pushed.length, 2);
  assert.equal(db.post_alert_devices[0].badge, 2); // the alert, then the test alert
  assert.equal((await (await call({ op: 'seen', endpoint: 'https://push.example/abc' })).json()).ok, true);
  assert.equal(db.post_alert_devices[0].badge, 0);
  assert.deepEqual((await (await call({ op: 'renew' })).json()).results, []); // fresh subscription: nothing to renew
  assert.equal((await (await call({ op: 'unregister', email: 'andreas@outlook.com' })).json()).removed, true);
  assert.equal(db.post_alert_accounts.length, 0);
});


test('one-button sign-in through the real function: start, finish, then only that session can act, and only on its own mailbox', async () => {
  const start = await (await call({ op: 'signin_start', redirectUri: 'https://site.example/post/' }, null)).json();
  assert.ok(start.url.startsWith('https://login.microsoftonline.com/'));
  const state = new URL(start.url).searchParams.get('state')!;
  // a forged state is refused
  assert.equal((await call({ op: 'signin_finish', code: 'c', state: 'v1.AAAA.BBBB' }, null)).status, 400);
  const done = await (await call({ op: 'signin_finish', code: 'CODE', state }, null)).json();
  assert.equal(done.email, 'andreas@outlook.com');
  assert.equal(done.label, 'Personal');
  assert.ok(db.post_alert_accounts[0].subscription_id, 'watching started');
  assert.ok(!JSON.stringify(db).includes(done.session.split('.')[1]), 'only a hash of the session is stored');
  // the app that started it can still collect it, once
  const polled = await (await call({ op: 'signin_poll', handle: start.handle }, null)).json();
  assert.equal(polled.status, 'done');
  assert.equal((await (await call({ op: 'signin_poll', handle: start.handle }, null)).json()).status, 'pending');

  const as = (session: string | null, body: unknown) => handler(new Request(URL0, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(session ? { 'x-post-session': session } : {}) }, body: JSON.stringify(body) }));
  assert.equal((await as(done.session, { op: 'token' })).status, 200);
  assert.equal((await as(done.session, { op: 'token', email: 'someone@else.no' })).status, 200, 'the session decides the mailbox, not the request');
  assert.equal((await as(done.session + 'x', { op: 'token' })).status, 401);
  const st = await (await as(done.session, { op: 'status' })).json();
  assert.deepEqual(st.accounts.map((a: { email: string }) => a.email), ['andreas@outlook.com']);
  assert.equal((await as(done.session, { op: 'update', mode: 'all', quiet: { days: [1, 2], from: '08:00', to: '16:00' } })).status, 200);
  assert.equal(db.post_alert_accounts[0].mode, 'all');
  assert.equal((await as(done.session, { op: 'renew' })).status, 401, 'the schedule is admin only');
  assert.equal((await as(done.session, { op: 'register', email: 'x@y.no', refreshToken: 'r' })).status, 401);
  assert.equal((await (await as(done.session, { op: 'unregister' })).json()).removed, true);
  assert.equal(db.post_alert_accounts.length, 0);
  assert.equal((await as(done.session, { op: 'status' })).status, 401, 'a removed mailbox cannot be used again');
});

test('a stranger cannot sign in: not on the allowed list means nothing is stored', async () => {
  env.POST_ALLOWED_EMAILS = 'someone.else@example.com';
  const start = await (await call({ op: 'signin_start', redirectUri: 'https://site.example/post/' }, null)).json();
  const res = await call({ op: 'signin_finish', code: 'CODE', state: new URL(start.url).searchParams.get('state')! }, null);
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /not on this server/);
  assert.equal(db.post_alert_accounts.length, 0);
  env.POST_ALLOWED_EMAILS = 'Andreas@Outlook.com, andreas@firma.no';
});

test('no secrets at all: client id and mailbox come from the database, push keys and the schedule key are made once, and it all keeps working request after request', async () => {
  const saved = { ...env };
  for (const k of ['MS_CLIENT_ID', 'POST_ALLOWED_EMAILS', 'ALERTS_ENC_KEY', 'POST_ALERTS_KEY', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY']) delete env[k];
  db.post_config = [];
  db.post_alert_devices = [];
  try {
    // Before `post_setup` has been run there is no client id: a calm 503 that says what to do.
    const early = await call({ op: 'config' }, null);
    assert.equal(early.status, 503);
    assert.match((await early.json()).message, /select post_setup/);
    db.post_config.push({ key: 'ms_client_id', value: 'DB-CID' }, { key: 'allowed_emails', value: 'andreas@outlook.com' });
    assert.equal((await (await call({ op: 'config' }, null)).json()).clientId, 'DB-CID');

    // The push key pair is made on first need and then stays the same.
    const v1 = (await (await call({ op: 'vapid' }, null)).json()).publicKey;
    assert.ok(v1 && v1.length > 80);
    assert.equal((await (await call({ op: 'vapid' }, null)).json()).publicKey, v1);
    const cfg = Object.fromEntries(db.post_config.map((r) => [r.key, r.value]));
    assert.equal(cfg.function_url, URL0, 'the function tells the database where it lives, for the 6-hourly schedule');
    assert.ok(cfg.cron_key && cfg.cron_key.length >= 30);

    // A real sign-in with nothing but the database row, then the whole alert path with the made-up push keys.
    const start = await (await call({ op: 'signin_start', redirectUri: 'https://site.example/post/' }, null)).json();
    const done = await (await call({ op: 'signin_finish', code: 'CODE', state: new URL(start.url).searchParams.get('state')! }, null)).json();
    assert.equal(done.email, 'andreas@outlook.com');
    const as = (session: string, body: unknown) => handler(new Request(URL0, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-post-session': session }, body: JSON.stringify(body) }));
    const p256dh = bytesToB64u(new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey)));
    assert.equal((await as(done.session, { op: 'pair', endpoint: 'https://push.example/own-keys', p256dh, auth: bytesToB64u(crypto.getRandomValues(new Uint8Array(16))), lang: 'en' })).status, 200);
    const before = pushed.length;
    assert.equal((await (await as(done.session, { op: 'test' })).json()).sent, 1);
    assert.equal(pushed.length, before + 1);

    // The schedule authenticates with the key the function made; anything else is refused.
    assert.equal((await call({ op: 'renew' }, 'wrong')).status, 401);
    assert.equal((await call({ op: 'renew' }, cfg.cron_key)).status, 200);

    // Opening Post (status) is also a renewal moment; the status lists why alerts would be off, if they were.
    const st = await (await as(done.session, { op: 'status' })).json();
    assert.equal(st.accounts[0].sub_error, null);
    await as(done.session, { op: 'unregister' });
  } finally {
    Object.assign(env, saved);
    db.post_config = [];
    db.post_alert_devices = [];
  }
});

test('Microsoft refusing the alert subscription does not stop the sign-in: the mailbox works and Settings can say why alerts are off', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL, init: RequestInit = {}) => (String(url).endsWith('/subscriptions') && init.method === 'POST'
    ? new Response(JSON.stringify({ error: { code: 'InvalidRequest', message: 'Subscription validation request failed.' } }), { status: 400 })
    : realFetch(url as string, init))) as typeof fetch;
  try {
    const start = await (await call({ op: 'signin_start', redirectUri: 'https://site.example/post/' }, null)).json();
    const res = await call({ op: 'signin_finish', code: 'CODE', state: new URL(start.url).searchParams.get('state')! }, null);
    assert.equal(res.status, 200);
    const done = await res.json();
    assert.match(done.alertsError, /validation request failed/);
    const status = await (await handler(new Request(URL0, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-post-session': done.session }, body: JSON.stringify({ op: 'status' }) }))).json();
    assert.match(status.accounts[0].sub_error, /validation request failed/);
    assert.equal(status.accounts[0].subscription_expires_at, null);
    assert.equal((await handler(new Request(URL0, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-post-session': done.session }, body: JSON.stringify({ op: 'token' }) }))).status, 200, 'mail access still works');
    await call({ op: 'unregister', email: 'andreas@outlook.com' });
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('what the phone teaches the server: kept per mailbox, merged key by key, shown in the status, followed by the alerts, and gone with the mailbox', async () => {
  db.post_alert_devices = [];
  db.post_config = [];
  const start = await (await call({ op: 'signin_start', redirectUri: 'https://site.example/post/' }, null)).json();
  const done = await (await call({ op: 'signin_finish', code: 'CODE', state: new URL(start.url).searchParams.get('state')! }, null)).json();
  const as = (session: string, body: unknown) => handler(new Request(URL0, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-post-session': session }, body: JSON.stringify(body) }));
  const account = db.post_alert_accounts[0];
  const p256dh = bytesToB64u(new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey)));
  assert.equal((await as(done.session, { op: 'pair', endpoint: 'https://push.example/taught', p256dh, auth: bytesToB64u(crypto.getRandomValues(new Uint8Array(16))), lang: 'en' })).status, 200);
  const hook = async (id: string, subject: string, address: string, headers: { name: string; value: string }[] = []) => {
    const before = pushed.length;
    graphMessage = { id, subject, isRead: false, parentFolderId: 'INBOX-ID', from: { emailAddress: { name: 'Sender', address } }, internetMessageHeaders: headers };
    await call({ value: [{ subscriptionId: account.subscription_id, clientState: account.client_state, changeType: 'created', resourceData: { id } }] }, null);
    await new Promise((r) => setTimeout(r, 80));
    return pushed.length - before;
  };

  // Nothing taught yet: the defaults, and the function says it can follow the Primary tab.
  const st0 = await (await as(done.session, { op: 'status' })).json();
  assert.equal(st0.smart, 1);
  assert.equal(st0.accounts[0].extra, 'codes');
  assert.match(st0.accounts[0].rules_digest, /^0:/);
  assert.equal(await hook('T1', 'Nytt fra Kjøkkenhuset', 'bjorn@kjokkenhuset.no'), 1, 'a mail that looks personal counts');

  // Bad requests store nothing.
  assert.equal((await as(done.session, { op: 'taught', rules: { 'not an address': 'person' } })).status, 400);
  assert.equal((await as(done.session, { op: 'taught', rules: 'x' })).status, 400);
  assert.equal((await as(done.session, { op: 'taught', extra: 'everything' })).status, 400);
  assert.equal(db.post_config.filter((r) => r.key.startsWith('taught:')).length, 0);

  // Rules, then the extra, one at a time: each leaves the other alone.
  const r1 = await (await as(done.session, { op: 'taught', rules: { '@Kjokkenhuset.no': 'promo' } })).json();
  assert.equal(r1.ok, true);
  assert.equal(r1.extra, 'codes');
  const stored = db.post_config.find((r) => r.key === `taught:${account.id}`)!;
  assert.deepEqual(JSON.parse(stored.value), { rules: { '@kjokkenhuset.no': 'promo' }, extra: 'codes' });
  assert.equal(await hook('T2', 'Nytt fra Kjøkkenhuset', 'bjorn@kjokkenhuset.no'), 0, 'a company the person moved to Promotions stays quiet');
  const r2 = await (await as(done.session, { op: 'taught', extra: 'none' })).json();
  assert.equal(r2.rules_digest, r1.rules_digest, 'the rules were not touched');
  assert.deepEqual(JSON.parse(db.post_config.find((r) => r.key === `taught:${account.id}`)!.value), { rules: { '@kjokkenhuset.no': 'promo' }, extra: 'none' });
  const st1 = await (await as(done.session, { op: 'status' })).json();
  assert.deepEqual([st1.accounts[0].extra, st1.accounts[0].rules_digest], ['none', r1.rules_digest]);

  // Codes: counted unless the choice is "Primary only".
  assert.equal(await hook('T3', 'Your verification code is 482913', 'noreply@github.com'), 0, 'Primary only');
  await as(done.session, { op: 'taught', extra: 'codes' });
  assert.equal(await hook('T4', 'Your verification code is 482914', 'noreply@github.com'), 1, 'Primary and codes');
  assert.equal(await hook('T5', 'Ukens utgave', 'nyhetsbrev@morgenbladet.no', [{ name: 'List-Unsubscribe', value: '<mailto:u@x.no>' }]), 0, 'a newsletter');

  // The settings read leaves the taught rows alone, whatever their size: they are not settings.
  assert.ok(notCalls.some((c) => c[0] === 'key' && c[1] === 'like' && c[2] === 'taught:%'));
  db.post_config.push({ key: 'taught:other', value: 'x'.repeat(1000) });
  assert.equal((await (await call({ op: 'config' }, null)).json()).clientId, 'CID');

  // The admin key can do the same for a named mailbox; an unknown one is refused.
  assert.equal((await call({ op: 'taught', email: 'andreas@outlook.com', extra: 'transactions' })).status, 200);
  assert.equal(JSON.parse(db.post_config.find((r) => r.key === `taught:${account.id}`)!.value).extra, 'transactions');
  assert.equal((await call({ op: 'taught', email: 'nobody@x.no', extra: 'none' })).status, 404);
  assert.equal((await as(done.session + 'x', { op: 'taught', extra: 'none' })).status, 401);

  // Leaving Post takes everything it learned with it.
  assert.equal((await (await as(done.session, { op: 'unregister' })).json()).removed, true);
  assert.equal(db.post_config.some((r) => r.key === `taught:${account.id}`), false);
  db.post_config = [];
  db.post_alert_devices = [];
});
