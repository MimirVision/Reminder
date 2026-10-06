import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, createTokens, ServerError } from './server.ts';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

test('sends the operation, and the session (never a shared key) when there is one', async () => {
  const seen: { headers: Record<string, string>; body: any }[] = [];
  const s = createServer('https://s/fn', (async (_u: string, init: RequestInit) => { seen.push({ headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) }); return json(200, { publicKey: 'P', accounts: [], devices: 0 }); }) as typeof fetch);
  assert.deepEqual(await s.vapid(), { publicKey: 'P', accounts: [], devices: 0 });
  assert.equal(seen[0].headers['x-post-session'], undefined);
  assert.equal(seen[0].headers['x-alerts-key'], undefined);
  await s.status('acct.secret');
  assert.equal(seen[1].headers['x-post-session'], 'acct.secret');
  assert.deepEqual(seen[1].body, { op: 'status' });
  await s.signinStart('https://site/post/', 'a@b.no');
  assert.deepEqual(seen[2].body, { op: 'signin_start', redirectUri: 'https://site/post/', hint: 'a@b.no' });
});

test('plain-language errors for 401, 503, offline and server messages', async () => {
  const mk = (r: () => Response | Promise<Response>) => createServer('u', (async () => r()) as typeof fetch);
  await assert.rejects(() => mk(() => json(401, {})).status('x'), (e: ServerError) => e.status === 401 && /Sign in again/.test(e.message));
  await assert.rejects(() => mk(() => json(503, {})).status('x'), /not set up yet/);
  await assert.rejects(() => mk(() => { throw new Error('x'); }).status('x'), (e: ServerError) => e.status === 0 && /Cannot reach/.test(e.message));
  await assert.rejects(() => mk(() => json(400, { error: 'ann@x.no is not on this server' })).signinFinish({ code: 'c', state: 's' }), /not on this server/);
  // the server says what is missing and how to fix it: that is what the person sees
  await assert.rejects(() => mk(() => json(503, { error: 'not_configured', message: 'No client ID yet. Run: select post_setup(...)' })).signinStart('https://site/post/'), /No client ID yet. Run: select post_setup/);
});

const sessions = (m: Record<string, string>) => (email: string) => m[email];

test('tokens are reused until shortly before they expire', async () => {
  let n = 0; let t = 0;
  const tok = createTokens({ token: async () => ({ accessToken: `T${++n}`, expiresIn: 3600, email: 'a' }) }, sessions({ a: 'S' }), () => t);
  const get = tok.source('a');
  assert.equal(await get(), 'T1');
  assert.equal(await get(), 'T1');
  t += 3600 * 1000 - 119_000; // inside the two-minute safety margin
  assert.equal(await get(), 'T2');
});

test('asking for a fresh token (after a 401) skips the cache', async () => {
  let n = 0;
  const tok = createTokens({ token: async () => ({ accessToken: `T${++n}`, expiresIn: 3600, email: 'a' }) }, sessions({ a: 'S' }));
  const get = tok.source('a');
  await get();
  assert.equal(await get(true), 'T2');
});

test('parallel callers share one request', async () => {
  let n = 0;
  const tok = createTokens({ token: async () => { n++; await new Promise((r) => setTimeout(r, 5)); return { accessToken: 'T', expiresIn: 3600, email: 'a' }; } }, sessions({ a: 'S' }));
  const get = tok.source('a');
  await Promise.all([get(), get(), get(true)]);
  assert.equal(n, 1);
});

test('each account uses its own session and token', async () => {
  const used: string[] = [];
  const tok = createTokens({ token: async (session: string) => { used.push(session); return { accessToken: `T-${session}`, expiresIn: 3600, email: 'x' }; } }, sessions({ a: 'SA', b: 'SB' }));
  assert.equal(await tok.source('a')(), 'T-SA');
  assert.equal(await tok.source('b')(), 'T-SB');
  assert.deepEqual(used, ['SA', 'SB']);
});

test('no session for an account is "signed out", not a crash', async () => {
  const tok = createTokens({ token: async () => ({ accessToken: 'T', expiresIn: 3600, email: 'x' }) }, sessions({}));
  await assert.rejects(() => tok.source('a')(), (e: ServerError) => e.status === 401);
});
