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
class Query {
  private filters: ((r: Row) => boolean)[] = [];
  private op: 'select' | 'update' | 'upsert' | 'delete' = 'select';
  private payload: any; private opts: any; private returning = false;
  private db: Record<string, Row[]>;
  private table: string;
  constructor(db: Record<string, Row[]>, table: string) { this.db = db; this.table = table; }
  select() { this.returning = true; return this; }
  eq(k: string, v: unknown) { this.filters.push((r) => r[k] === v); return this; }
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
    if (this.op === 'delete') { this.db[this.table] = rows.filter((r) => !match(r)); return { data: [], error: null }; }
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
  SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service', POST_ALERTS_KEY: 'letmein', ALERTS_ENC_KEY: 'A'.repeat(43), MS_CLIENT_ID: 'CID',
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

test('the key protects every call of the Post app and the alerts page', async () => {
  assert.equal((await call({ op: 'status' }, 'wrong')).status, 401);
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
  assert.equal((await (await call({ op: 'test' })).json()).sent, 1);
  assert.equal(pushed.length, 2);
  assert.deepEqual((await (await call({ op: 'renew' })).json()).results, []); // fresh subscription: nothing to renew
  assert.equal((await (await call({ op: 'unregister', email: 'andreas@outlook.com' })).json()).removed, true);
  assert.equal(db.post_alert_accounts.length, 0);
});
