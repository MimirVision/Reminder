import test from 'node:test';
import assert from 'node:assert/strict';
import { createGraph, GraphError } from './graph.ts';

const res = (status: number, body: unknown = {}, headers: Record<string, string> = {}) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers });
function setup(responses: (Response | Error)[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const tokens: boolean[] = [];
  const sleeps: number[] = [];
  const g = createGraph({
    fetch: (async (url: string, init: RequestInit) => { calls.push({ url, init }); const r = responses.shift(); if (!r) throw new Error('no more responses'); if (r instanceof Error) throw r; return r; }) as typeof fetch,
    token: async (fresh) => { tokens.push(!!fresh); return fresh ? 'new' : 'old'; },
    sleep: async (ms) => { sleeps.push(ms); },
  });
  return { g, calls, tokens, sleeps };
}

test('sends the bearer token and parses json', async () => {
  const { g, calls } = setup([res(200, { unreadItemCount: 7 })]);
  assert.equal(await g.unreadCount(), 7);
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, 'Bearer old');
});

test('a refused token (401) is renewed once, then the call is repeated', async () => {
  const { g, calls, tokens } = setup([res(401, { error: { code: 'InvalidAuthenticationToken' } }), res(200, { unreadItemCount: 2 })]);
  assert.equal(await g.unreadCount(), 2);
  assert.deepEqual(tokens, [false, true]);
  assert.equal((calls[1].init.headers as Record<string, string>).Authorization, 'Bearer new');
});

test('a second 401 is an error, not a loop', async () => {
  const { g } = setup([res(401), res(401, { error: { code: 'Unauthorized', message: 'no' } })]);
  await assert.rejects(() => g.unreadCount(), (e: GraphError) => e.status === 401 && e.code === 'Unauthorized');
});

test('429 waits for Retry-After and tries again', async () => {
  const { g, sleeps } = setup([res(429, {}, { 'Retry-After': '3' }), res(200, { unreadItemCount: 1 })]);
  assert.equal(await g.unreadCount(), 1);
  assert.deepEqual(sleeps, [3000]);
});

test('503 backs off exponentially and gives up after the retries', async () => {
  const { g, sleeps } = setup([res(503), res(503), res(503), res(503, { error: { code: 'ServiceNotAvailable', message: 'x' } })]);
  await assert.rejects(() => g.unreadCount(), (e: GraphError) => e.status === 503);
  assert.deepEqual(sleeps, [500, 1000, 2000]);
});

test('network errors are retried and then reported as status 0', async () => {
  const { g } = setup([new Error('offline'), new Error('offline'), new Error('offline'), new Error('offline')]);
  await assert.rejects(() => g.unreadCount(), (e: GraphError) => e.status === 0 && e.code === 'network');
});

test('delta: first call filters by date, later calls use the saved link as is', async () => {
  const { g, calls } = setup([res(200, { value: [{ id: 'a' }], '@odata.deltaLink': 'https://graph/delta?token=1' }), res(200, { value: [] })]);
  const first = await g.deltaPage('inbox', undefined, '2026-09-01T00:00:00.000Z');
  assert.equal(first.delta, 'https://graph/delta?token=1');
  assert.match(calls[0].url, /mailFolders\/inbox\/messages\/delta\?\$select=.*&\$filter=receivedDateTime ge 2026-09-01/);
  await g.deltaPage('inbox', 'https://graph/delta?token=1');
  assert.equal(calls[1].url, 'https://graph/delta?token=1');
});

test('move returns the new id', async () => {
  const { g, calls } = setup([res(201, { id: 'NEW' })]);
  assert.equal(await g.move('old/id', 'archive'), 'NEW');
  assert.match(calls[0].url, /messages\/old%2Fid\/move$/);
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { destinationId: 'archive' });
});

test('batch splits into groups of 20 and keeps the order', async () => {
  const reply = (n: number) => res(200, { responses: Array.from({ length: n }, (_, i) => ({ id: String(i), status: 200, body: { n: i } })) });
  const { g, calls } = setup([reply(20), reply(5)]);
  const out = await g.batch(Array.from({ length: 25 }, (_, i) => ({ method: 'GET', url: `/me/messages/${i}` })));
  assert.equal(out.length, 25);
  assert.equal(calls.length, 2);
  assert.equal(JSON.parse(String(calls[1].init.body)).requests.length, 5);
  assert.equal(out[24].body.n, 4);
});

test('a missing batch answer becomes status 0, never a crash', async () => {
  const { g } = setup([res(200, { responses: [{ id: '0', status: 200, body: {} }] })]);
  const out = await g.batch([{ method: 'GET', url: '/a' }, { method: 'GET', url: '/b' }]);
  assert.equal(out[1].status, 0);
});

test('204 and 202 answers have no body', async () => {
  const { g } = setup([res(204), res(202)]);
  await g.setRead('a', true);
  await g.sendMail({ subject: 's', body: 'b', to: ['x@y.no'] });
});

test('sendMail builds recipients and saves to sent items', async () => {
  const { g, calls } = setup([res(202)]);
  await g.sendMail({ subject: 'Hei', body: 'Tekst', to: ['a@b.no'], cc: ['c@d.no'] });
  const b = JSON.parse(String(calls[0].init.body));
  assert.equal(b.saveToSentItems, true);
  assert.equal(b.message.toRecipients[0].emailAddress.address, 'a@b.no');
  assert.equal(b.message.ccRecipients[0].emailAddress.address, 'c@d.no');
  assert.deepEqual(b.message.bccRecipients, []);
});

test('search strips quotes so the query cannot break out of $search', async () => {
  const { g, calls } = setup([res(200, { value: [] })]);
  await g.search('he"llo');
  assert.match(calls[0].url, /\$search="hello"/);
});

test('attachmentBlob decodes base64', async () => {
  const { g } = setup([res(200, { name: 'a.txt', contentType: 'text/plain', contentBytes: btoa('hi') })]);
  const a = await g.attachmentBlob('m', 'a');
  assert.equal(new TextDecoder().decode(a.bytes), 'hi');
});

test('batch says how long to wait for a call Microsoft asked us to slow down on', async () => {
  const { g } = setup([res(200, { responses: [{ id: '0', status: 200, body: {} }, { id: '1', status: 429, headers: { 'Retry-After': '7' }, body: {} }, { id: '2', status: 429, headers: { 'retry-after': 'soon' }, body: {} }] })]);
  const out = await g.batch([{ method: 'GET', url: '/a' }, { method: 'GET', url: '/b' }, { method: 'GET', url: '/c' }]);
  assert.deepEqual(out.map((o) => [o.status, o.retryAfter]), [[200, undefined], [429, 7], [429, undefined]]);
});

test('sentRecipients collects each address you have written to once, in lower case, across pages', async () => {
  const msg = (...to: string[]) => ({ toRecipients: to.map((address) => ({ emailAddress: { address } })), ccRecipients: [{ emailAddress: { address: 'CC@x.no' } }] });
  const { g, calls } = setup([
    res(200, { value: [msg('Anna@X.no', 'per@x.no'), msg('anna@x.no')], '@odata.nextLink': 'https://graph/next?p=2' }),
    res(200, { value: [msg('kari@x.no', 'not-an-address', '')] }),
  ]);
  assert.deepEqual((await g.sentRecipients()).sort(), ['anna@x.no', 'cc@x.no', 'kari@x.no', 'per@x.no']);
  assert.match(calls[0].url, /mailFolders\/sentitems\/messages\?\$select=toRecipients,ccRecipients&\$orderby=sentDateTime desc&\$top=100/);
  assert.equal(calls[1].url, 'https://graph/next?p=2');
});

test('sentRecipients stops after the pages it was asked for', async () => {
  const page = () => res(200, { value: [], '@odata.nextLink': 'https://graph/next' });
  const { g, calls } = setup([page(), page(), page()]);
  await g.sentRecipients(2);
  assert.equal(calls.length, 2);
});
