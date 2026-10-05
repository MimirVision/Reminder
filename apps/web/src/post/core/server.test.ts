import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, createTokens, ServerError } from './server.ts';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

test('sends the key and the operation, returns the answer', async () => {
  let seen: { headers: Record<string, string>; body: any } | null = null;
  const s = createServer({ url: 'https://s/fn', key: 'K' }, (async (_u: string, init: RequestInit) => { seen = { headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) }; return json(200, { publicKey: 'P' }); }) as typeof fetch);
  assert.deepEqual(await s.vapid(), { publicKey: 'P' });
  assert.equal(seen!.headers['x-alerts-key'], 'K');
  assert.deepEqual(seen!.body, { op: 'vapid' });
});

test('plain-language errors for 401, 503, offline and server messages', async () => {
  const mk = (r: () => Response | Promise<Response>) => createServer({ url: 'u', key: 'k' }, (async () => r()) as typeof fetch);
  await assert.rejects(() => mk(() => json(401, {})).status(), (e: ServerError) => e.status === 401 && /key was not accepted/.test(e.message));
  await assert.rejects(() => mk(() => json(503, {})).status(), /not set up yet/);
  await assert.rejects(() => mk(() => { throw new Error('x'); }).status(), (e: ServerError) => e.status === 0 && /Cannot reach/.test(e.message));
  await assert.rejects(() => mk(() => json(400, { error: 'unknown account' })).token('a@b.no'), /unknown account/);
});

test('tokens are reused until shortly before they expire', async () => {
  let n = 0; let t = 0;
  const tok = createTokens({ token: async () => ({ accessToken: `T${++n}`, expiresIn: 3600, email: 'a' }) }, () => t);
  const get = tok.source('a');
  assert.equal(await get(), 'T1');
  assert.equal(await get(), 'T1');
  t += 3600 * 1000 - 119_000; // inside the two-minute safety margin
  assert.equal(await get(), 'T2');
});

test('asking for a fresh token (after a 401) skips the cache', async () => {
  let n = 0;
  const tok = createTokens({ token: async () => ({ accessToken: `T${++n}`, expiresIn: 3600, email: 'a' }) });
  const get = tok.source('a');
  await get();
  assert.equal(await get(true), 'T2');
});

test('parallel callers share one request', async () => {
  let n = 0;
  const tok = createTokens({ token: async () => { n++; await new Promise((r) => setTimeout(r, 5)); return { accessToken: 'T', expiresIn: 3600, email: 'a' }; } });
  const get = tok.source('a');
  await Promise.all([get(), get(), get(true)]);
  assert.equal(n, 1);
});

test('accounts do not share tokens', async () => {
  const tok = createTokens({ token: async (e: string) => ({ accessToken: `T-${e}`, expiresIn: 3600, email: e }) });
  assert.equal(await tok.source('a')(), 'T-a');
  assert.equal(await tok.source('b')(), 'T-b');
});
