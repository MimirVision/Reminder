import test from 'node:test';
import assert from 'node:assert/strict';
import { createGraph, GraphError, toBase64, type GraphDeps } from './graph.ts';

const res = (status: number, body: unknown = {}, headers: Record<string, string> = {}) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers });
function setup(responses: (Response | Error)[], extra: Partial<GraphDeps> = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const tokens: boolean[] = [];
  const sleeps: number[] = [];
  const g = createGraph({
    fetch: (async (url: string, init: RequestInit) => { calls.push({ url, init }); const r = responses.shift(); if (!r) throw new Error('no more responses'); if (r instanceof Error) throw r; return r; }) as typeof fetch,
    token: async (fresh) => { tokens.push(!!fresh); return fresh ? 'new' : 'old'; },
    sleep: async (ms) => { sleeps.push(ms); },
    ...extra,
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

// ---- sending ---------------------------------------------------------------------------------------------------------------------------

const file = (name: string, size: number, type = 'application/pdf') => ({ name, type, bytes: new Uint8Array(size).fill(65) });
const hdr = (c: { init: RequestInit }) => c.init.headers as Record<string, string>;
const path = (c: { url: string }) => c.url.replace('https://graph.microsoft.com/v1.0', '');
const steps = (calls: { url: string; init: RequestInit }[]) => calls.map((c) => `${c.init.method} ${path(c)}`);
const note = (extra: object = {}) => ({ kind: 'new' as const, subject: 'Hei', body: 'Tekst', to: ['a@b.no'], ...extra });

/**
 * A pretend Outlook for the draft flow, with the parts that go wrong in real life: an answer that is lost after Outlook did the work
 * (`lostAfter`), a call that never arrives (`lostBefore`), and what a sent draft looks like afterwards (gone, or no longer a draft).
 */
function outlook(o: { lostAfter?: (m: string, p: string, n: number) => boolean; lostBefore?: (m: string, p: string, n: number) => boolean; afterSend?: 'gone' | 'not-a-draft' } = {}) {
  const drafts = new Map<string, { attachments: { name: string; size: number }[]; sent: boolean }>();
  const sentMail: string[] = [];
  const log: string[] = [];
  let made = 0;
  const seen = new Map<string, number>();
  const json = (status: number, body: unknown = {}) => new Response(status === 204 ? null : JSON.stringify(body), { status });
  const handle = (method: string, path: string, init: RequestInit): Response => {
    let m: RegExpMatchArray | null;
    if (method === 'POST' && path === '/me/messages') { const id = `D${++made}`; drafts.set(id, { attachments: [], sent: false }); return json(201, { id }); }
    if (method === 'POST' && (m = path.match(/^\/me\/messages\/[^/]+\/(createReply|createReplyAll|createForward)$/))) { const id = `D${++made}`; drafts.set(id, { attachments: [], sent: false }); return json(201, { id }); }
    if (method === 'POST' && (m = path.match(/^\/me\/messages\/([^/]+)\/attachments$/))) {
      const d = drafts.get(decodeURIComponent(m[1]));
      if (!d || d.sent) return json(404, { error: { code: 'ErrorItemNotFound', message: 'gone' } });
      const b = JSON.parse(String(init.body)); d.attachments.push({ name: b.name, size: atob(b.contentBytes).length }); return json(201, {});
    }
    if (method === 'GET' && (m = path.match(/^\/me\/messages\/([^/]+)\/attachments\?/))) {
      const d = drafts.get(decodeURIComponent(m[1]));
      return d && !d.sent ? json(200, { value: d.attachments }) : json(404, { error: { code: 'ErrorItemNotFound', message: 'gone' } });
    }
    if (method === 'GET' && (m = path.match(/^\/me\/messages\/([^/]+)\?\$select=isDraft$/))) {
      const d = drafts.get(decodeURIComponent(m[1]));
      if (!d || (d.sent && o.afterSend !== 'not-a-draft')) return json(404, { error: { code: 'ErrorItemNotFound', message: 'gone' } });
      return json(200, { isDraft: !d.sent });
    }
    if (method === 'POST' && (m = path.match(/^\/me\/messages\/([^/]+)\/send$/))) {
      const id = decodeURIComponent(m[1]); const d = drafts.get(id);
      if (!d || d.sent) return json(404, { error: { code: 'ErrorItemNotFound', message: 'gone' } });
      d.sent = true; sentMail.push(id); return json(202);
    }
    if (method === 'DELETE' && (m = path.match(/^\/me\/messages\/([^/]+)$/))) { drafts.delete(decodeURIComponent(m[1])); return json(204); }
    return json(500, { error: { code: 'unexpected', message: `${method} ${path}` } });
  };
  const fetch = (async (url: string, init: RequestInit) => {
    const p = String(url).replace('https://graph.microsoft.com/v1.0', '');
    const method = String(init.method);
    const key = `${method} ${p}`;
    const n = (seen.get(key) ?? 0) + 1; seen.set(key, n);
    log.push(key);
    if (o.lostBefore?.(method, p, n)) throw new Error('Failed to fetch');
    const r = handle(method, p, init);
    if (o.lostAfter?.(method, p, n)) throw new Error('Failed to fetch');
    return r;
  }) as typeof globalThis.fetch;
  const graph = (extra: Partial<GraphDeps> = {}) => createGraph({ fetch, token: async () => 't', sleep: async () => {}, ...extra });
  return { fetch, graph, drafts, sentMail, log };
}

test('a mail is sent in one call without files, and a lost answer is not answered by sending it again', async () => {
  const a = setup([res(202)]);
  await a.g.sendMail({ subject: 's', body: 'b', to: ['a@b.no'] });
  assert.equal(a.calls.length, 1);
  const b = setup([new Error('offline'), res(202)]);
  await assert.rejects(() => b.g.sendMail({ subject: 's', body: 'b', to: ['a@b.no'] }), (e: GraphError) => e.status === 0);
  assert.equal(b.calls.length, 1, 'whether the first try went through is not known, so it is not repeated');
});

test('deliver makes a draft and sends it, and writes each step down before the next one begins', async () => {
  const { g, calls } = setup([res(201, { id: 'D/1' }), res(202)]);
  const log: string[] = [];
  await g.deliver(note({ cc: ['c@d.no'] }), [], undefined, async (p) => { log.push(`${p.phase}:${p.id} after ${calls.length} calls`); });
  assert.deepEqual(steps(calls), ['POST /me/messages', 'POST /me/messages/D%2F1/send']);
  assert.deepEqual(log, ['made:D/1 after 1 calls', 'sending:D/1 after 1 calls'], 'the "sending" mark is on disk before the send call is made');
  const draft = JSON.parse(String(calls[0].init.body));
  assert.equal(draft.subject, 'Hei');
  assert.deepEqual(draft.body, { contentType: 'Text', content: 'Tekst' });
  assert.equal(draft.toRecipients[0].emailAddress.address, 'a@b.no');
  assert.equal(draft.ccRecipients[0].emailAddress.address, 'c@d.no');
  assert.deepEqual(draft.bccRecipients, []);
});

test('a reply, a reply all and a forward are made with their own calls, so the conversation and the original are kept', async () => {
  const reply = setup([res(201, { id: 'R1' }), res(202)]);
  await reply.g.deliver({ kind: 'reply', replyTo: 'orig/1', body: 'Takk!' });
  assert.deepEqual(steps(reply.calls), ['POST /me/messages/orig%2F1/createReply', 'POST /me/messages/R1/send']);
  assert.deepEqual(JSON.parse(String(reply.calls[0].init.body)), { comment: 'Takk!' });
  const all = setup([res(201, { id: 'R1' }), res(202)]);
  await all.g.deliver({ kind: 'replyAll', replyTo: 'o', body: 'x' }, [file('f.pdf', 10)].slice(0, 0));
  assert.match(all.calls[0].url, /\/o\/createReplyAll$/);
  const fwd = setup([res(201, { id: 'F1' }), res(201, {}), res(202)]);
  await fwd.g.deliver({ kind: 'forward', replyTo: 'o', to: ['z@y.no'], body: 'se her' }, [file('f.pdf', 10)]);
  assert.deepEqual(steps(fwd.calls), ['POST /me/messages/o/createForward', 'POST /me/messages/F1/attachments', 'POST /me/messages/F1/send']);
  assert.deepEqual(JSON.parse(String(fwd.calls[0].init.body)), { comment: 'se her', toRecipients: [{ emailAddress: { address: 'z@y.no' } }] });
});

test('files go onto the draft one by one, whatever their size, before it is sent', async () => {
  const { g, calls } = setup([res(201, { id: 'D/1' }), res(201, {}), res(201, {}), res(202)]);
  await g.deliver(note({ cc: ['c@d.no'] }), [file('a.pdf', 1_500_000), { name: 'b.bin', type: '', bytes: new Uint8Array([1, 2, 3]) }]);
  assert.deepEqual(steps(calls), ['POST /me/messages', 'POST /me/messages/D%2F1/attachments', 'POST /me/messages/D%2F1/attachments', 'POST /me/messages/D%2F1/send']);
  const first = JSON.parse(String(calls[1].init.body));
  assert.deepEqual([first['@odata.type'], first.name, first.contentType], ['#microsoft.graph.fileAttachment', 'a.pdf', 'application/pdf']);
  assert.equal(first.contentBytes.length, Math.ceil(1_500_000 / 3) * 4);
  const second = JSON.parse(String(calls[2].init.body));
  assert.deepEqual([second.name, second.contentType, second.contentBytes], ['b.bin', 'application/octet-stream', 'AQID']);
  assert.equal(calls.every((c) => hdr(c).Authorization === 'Bearer old'), true);
});

test('a file over 3 MB goes up in slices to the private upload address, without the sign-in', async () => {
  const size = 9_000_000;
  const { g, calls } = setup([res(201, { id: 'D1' }), res(200, { uploadUrl: 'https://upload.example/session/abc' }), res(200), res(200), res(201), res(202)]);
  await g.deliver(note(), [file('big.pdf', size)]);
  const urls = calls.map((c) => path(c));
  assert.deepEqual(urls, ['/me/messages', '/me/messages/D1/attachments/createUploadSession', 'https://upload.example/session/abc', 'https://upload.example/session/abc', 'https://upload.example/session/abc', '/me/messages/D1/send']);
  assert.deepEqual(JSON.parse(String(calls[1].init.body)), { AttachmentItem: { attachmentType: 'file', name: 'big.pdf', size, contentType: 'application/pdf' } });
  const ranges = calls.slice(2, 5).map((c) => hdr(c)['Content-Range']);
  assert.deepEqual(ranges, ['bytes 0-3276799/9000000', 'bytes 3276800-6553599/9000000', 'bytes 6553600-8999999/9000000']);
  for (const c of calls.slice(2, 5)) {
    assert.equal(c.init.method, 'PUT');
    assert.equal(hdr(c).Authorization, undefined, 'the upload address carries its own permission');
    assert.equal(hdr(c)['Content-Type'], 'application/octet-stream');
  }
  assert.equal((calls[2].init.body as Uint8Array).byteLength, 3_276_800);
  assert.equal((calls[4].init.body as Uint8Array).byteLength, size - 2 * 3_276_800);
  assert.equal(3_276_800 % (320 * 1024), 0, 'a multiple of 320 KiB, as OneDrive asks');
  assert.equal(3_276_800 % (200 * 1024), 0, 'a multiple of 200 KiB, as Outlook recommends');
  assert.ok(3_276_800 < 4_000_000, 'under Microsoft\'s 4 MB per call');
});

test('a refused upload slice is an error that leaves the draft alone: the caller decides whether to try again or delete it', async () => {
  const { g, calls } = setup([res(201, { id: 'D1' }), res(200, { uploadUrl: 'https://upload.example/s' }), res(401, { error: { code: 'Unauthorized', message: 'no' } })]);
  await assert.rejects(() => g.deliver(note(), [file('big.pdf', 4_000_000)]), (e: GraphError) => e.status === 401);
  assert.equal(calls.length, 3, 'the sign-in is not "renewed" for an address that never wanted it, and nothing is deleted behind the caller\'s back');
  const gone = setup([res(204)]);
  await gone.g.discard('D/1');
  assert.deepEqual(steps(gone.calls), ['DELETE /me/messages/D%2F1']);
  const failing = setup([res(500), res(500), res(500), res(500)]);
  await failing.g.discard('D1'); // never throws: a draft left behind is harmless
});

test('a draft Outlook did not create is an error, not a send to nowhere', async () => {
  const { g, calls } = setup([res(201, {})]);
  await assert.rejects(() => g.deliver(note(), []), (e: GraphError) => e.code === 'draft');
  assert.equal(calls.length, 1);
});

test('the send call is made once: a lost answer is not repeated, but "slow down" is waited out', async () => {
  const lost = setup([res(201, { id: 'D1' }), new Error('Failed to fetch'), res(202)]);
  await assert.rejects(() => lost.g.deliver(note(), []), (e: GraphError) => e.status === 0 && e.code === 'network');
  assert.deepEqual(steps(lost.calls), ['POST /me/messages', 'POST /me/messages/D1/send']);
  const gateway = setup([res(201, { id: 'D1' }), res(504), res(202)]);
  await assert.rejects(() => gateway.g.deliver(note(), []), (e: GraphError) => e.status === 504);
  assert.equal(gateway.calls.length, 2, 'a gateway timeout does not say whether the message was sent');
  const slow = setup([res(201, { id: 'D1' }), res(429, {}, { 'Retry-After': '2' }), res(202)]);
  await slow.g.deliver(note(), []);
  assert.deepEqual(steps(slow.calls), ['POST /me/messages', 'POST /me/messages/D1/send', 'POST /me/messages/D1/send']);
  assert.deepEqual(slow.sleeps, [2000]);
});

test('if the progress cannot be written down, nothing is sent', async () => {
  const { g, calls } = setup([res(201, { id: 'D1' }), res(202)]);
  await assert.rejects(() => g.deliver(note(), [], undefined, async (p) => { if (p.phase === 'sending') throw new Error('disk full'); }), /disk full/);
  assert.deepEqual(steps(calls), ['POST /me/messages']);
});

// ---- the answer is lost: the message must go exactly once ------------------------------------------------------------------------------------

test('an earlier try that stopped after "send" was asked for: a message that has left is not sent again (it is gone from Drafts)', async () => {
  const o = outlook({ lostAfter: (m, p) => m === 'POST' && /\/send$/.test(p) });
  const g = o.graph();
  const seen: DraftProgressLike[] = [];
  await assert.rejects(() => g.deliver(note(), [file('a.pdf', 1000)], undefined, async (p) => { seen.push(p); }), (e: GraphError) => e.status === 0);
  assert.deepEqual(o.sentMail, ['D1'], 'Outlook did send it');
  assert.deepEqual(seen, [{ id: 'D1', phase: 'made' }, { id: 'D1', phase: 'sending' }]);
  await g.deliver(note(), [file('a.pdf', 1000)], seen.at(-1));
  assert.deepEqual(o.sentMail, ['D1'], 'the second try only looked, and sent nothing');
  assert.deepEqual(o.log.slice(-1), ['GET /me/messages/D1?$select=isDraft']);
});

test('the same when Outlook keeps the sent message under its id: it is no longer a draft, so it is not sent again', async () => {
  const o = outlook({ lostAfter: (m, p) => m === 'POST' && /\/send$/.test(p), afterSend: 'not-a-draft' });
  const g = o.graph();
  await assert.rejects(() => g.deliver(note(), [], undefined, async () => {}), (e: GraphError) => e.status === 0);
  await g.deliver(note(), [], { id: 'D1', phase: 'sending' });
  assert.deepEqual(o.sentMail, ['D1']);
});

test('an earlier try that stopped before "send" arrived: the draft is still there, so exactly that draft is sent, with nothing made twice', async () => {
  const o = outlook({ lostBefore: (m, p, n) => m === 'POST' && /\/send$/.test(p) && n === 1 });
  const g = o.graph();
  const seen: DraftProgressLike[] = [];
  await assert.rejects(() => g.deliver(note(), [file('a.pdf', 1000)], undefined, async (p) => { seen.push(p); }), (e: GraphError) => e.status === 0);
  assert.deepEqual(o.sentMail, []);
  await g.deliver(note(), [file('a.pdf', 1000)], seen.at(-1));
  assert.deepEqual(o.sentMail, ['D1']);
  assert.equal(o.drafts.size, 1, 'no second draft');
  assert.equal(o.drafts.get('D1')!.attachments.length, 1, 'the file is on it once');
});

test('an earlier try that stopped while the files went up: the files already on the draft are not added again', async () => {
  const o = outlook({ lostBefore: (m, p, n) => m === 'POST' && /\/attachments$/.test(p) && n === 2 });
  const g = o.graph({ maxRetries: 0 });
  const seen: DraftProgressLike[] = [];
  await assert.rejects(() => g.deliver(note(), [file('a.pdf', 1000), file('b.pdf', 2000)], undefined, async (p) => { seen.push(p); }), (e: GraphError) => e.status === 0);
  assert.deepEqual(o.drafts.get('D1')!.attachments.map((a) => a.name), ['a.pdf']);
  await g.deliver(note(), [file('a.pdf', 1000), file('b.pdf', 2000)], seen.at(-1));
  assert.deepEqual(o.drafts.get('D1')!.attachments.map((a) => a.name), ['a.pdf', 'b.pdf']);
  assert.deepEqual(o.sentMail, ['D1']);
});

test('a draft that has disappeared before "send" was asked for is made again; one that disappeared after is a message that left', async () => {
  const o = outlook();
  const g = o.graph();
  await g.deliver(note(), [], { id: 'GONE', phase: 'made' });
  assert.deepEqual(o.sentMail, ['D1'], 'a new draft was made and sent');
  const o2 = outlook();
  await o2.graph().deliver(note(), [], { id: 'GONE', phase: 'sending' });
  assert.deepEqual(o2.sentMail, [], 'nothing is sent: it was sent already');
  assert.deepEqual(o2.log, ['GET /me/messages/GONE?$select=isDraft']);
});

test('a file whose answer was lost is looked for on the draft before it is sent again, so it is never on it twice', async () => {
  const o = outlook({ lostAfter: (m, p, n) => m === 'POST' && /\/attachments$/.test(p) && n === 1 });
  const g = o.graph();
  await g.deliver(note(), [file('a.pdf', 1000)]);
  assert.deepEqual(o.drafts.get('D1')!.attachments.map((a) => a.name), ['a.pdf']);
  assert.deepEqual(o.log, ['POST /me/messages', 'POST /me/messages/D1/attachments', 'GET /me/messages/D1/attachments?$select=name,size', 'POST /me/messages/D1/send']);
  // and when the file did not arrive, it is sent again
  const o2 = outlook({ lostBefore: (m, p, n) => m === 'POST' && /\/attachments$/.test(p) && n === 1 });
  await o2.graph().deliver(note(), [file('a.pdf', 1000)]);
  assert.deepEqual(o2.drafts.get('D1')!.attachments.map((a) => a.name), ['a.pdf']);
  assert.equal(o2.log.filter((l) => l === 'POST /me/messages/D1/attachments').length, 2);
});

test('Outlook counting a file a few bytes differently does not make it a different file', async () => {
  const o = outlook();
  o.drafts.set('D9', { attachments: [{ name: 'a.pdf', size: 1000 + 300 }], sent: false });
  await o.graph().deliver(note(), [file('a.pdf', 1000), file('a.pdf', 90_000)], { id: 'D9', phase: 'made' });
  assert.deepEqual(o.drafts.get('D9')!.attachments.map((a) => a.size), [1300, 90_000], 'the small one was recognised, the big one with the same name was added');
});

type DraftProgressLike = { id: string; phase: 'made' | 'sending' };

// ---- calls that never answer -------------------------------------------------------------------------------------------------------------------

test('a call that never answers is cut off and counts as a dropped connection, tried again as usual', async () => {
  const aborted: boolean[] = [];
  const g = createGraph({
    fetch: ((_url: string, init: RequestInit) => new Promise<Response>((_, reject) => { init.signal!.addEventListener('abort', () => { aborted.push(true); reject(new DOMException('aborted', 'AbortError')); }); })) as typeof fetch,
    token: async () => 't', sleep: async () => {}, timeoutMs: 15, maxRetries: 2,
  });
  const t0 = Date.now();
  await assert.rejects(() => g.unreadCount(), (e: GraphError) => e.status === 0 && e.code === 'timeout');
  assert.equal(aborted.length, 3, 'one try and two more, each cut off');
  assert.ok(Date.now() - t0 < 2000);
});

test('a fetch that ignores the stop signal cannot hold things up either', async () => {
  const g = createGraph({ fetch: (() => new Promise<Response>(() => {})) as typeof fetch, token: async () => 't', sleep: async () => {}, timeoutMs: 15, maxRetries: 0 });
  await assert.rejects(() => g.unreadCount(), (e: GraphError) => e.code === 'timeout');
});

test('an answer that starts and then stops halfway is cut off too', async () => {
  const half = () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"unreadItem')); } }), { status: 200 });
  const g = createGraph({ fetch: (async () => half()) as typeof fetch, token: async () => 't', sleep: async () => {}, timeoutMs: 15, maxRetries: 0 });
  await assert.rejects(() => g.unreadCount(), (e: GraphError) => e.code === 'timeout');
});

test('files get four times as long as everything else, and a slow answer inside that time still arrives', async () => {
  const later = (ms: number, make: () => Response) => (() => new Promise<Response>((r) => setTimeout(() => r(make()), ms))) as unknown as typeof fetch;
  const quick = createGraph({ fetch: later(60, () => res(200, { unreadItemCount: 1 })), token: async () => 't', sleep: async () => {}, timeoutMs: 30, maxRetries: 0 });
  await assert.rejects(() => quick.unreadCount(), (e: GraphError) => e.code === 'timeout');
  const files = createGraph({ fetch: later(60, () => new Response(new Uint8Array([1, 2, 3]), { status: 200 })), token: async () => 't', sleep: async () => {}, timeoutMs: 30, maxRetries: 0 });
  assert.deepEqual((await files.attachmentValue('m', 'a')).bytes, new Uint8Array([1, 2, 3]));
});

// ---- seeing files ----------------------------------------------------------------------------------------------------------------------

test('the attachment list asks only for what every kind of attachment has, and says what kind each is', async () => {
  const { g, calls } = setup([res(200, { value: [
    { '@odata.type': '#microsoft.graph.fileAttachment', id: 'a', name: 'k.pdf', size: 10, contentType: 'application/pdf', isInline: false },
    { '@odata.type': '#microsoft.graph.itemAttachment', id: 'b', name: 'Re: hei', size: 20, contentType: null, isInline: false },
    { '@odata.type': '#microsoft.graph.referenceAttachment', id: 'c', name: 'Sky.docx', size: 0, contentType: 'text/html', isInline: false },
    { id: 'd', isInline: true },
  ] })]);
  const list = await g.attachments('m/1');
  assert.match(calls[0].url, /\/me\/messages\/m%2F1\/attachments\?\$select=id,name,size,contentType,isInline$/);
  assert.deepEqual(list.map((a) => [a.id, a.kind, a.inline]), [['a', 'file', false], ['b', 'item', false], ['c', 'link', false], ['d', 'file', true]]);
  assert.equal(list[3].name, 'attachment');
  assert.equal(list[1].contentType, '');
});

test('an attachment comes back as raw bytes with its type, however big', async () => {
  const bytes = Uint8Array.from({ length: 300_000 }, (_, i) => i % 256);
  const { g, calls } = setup([new Response(bytes, { status: 200, headers: { 'Content-Type': 'application/pdf' } })]);
  const r = await g.attachmentValue('m', 'a/b');
  assert.match(calls[0].url, /\/me\/messages\/m\/attachments\/a%2Fb\/\$value$/);
  assert.equal(r.type, 'application/pdf');
  assert.deepEqual(r.bytes, bytes);
});

test('a failed attachment download is a GraphError that says why', async () => {
  const { g } = setup([res(404, { error: { code: 'ErrorItemNotFound', message: 'gone' } })]);
  await assert.rejects(() => g.attachmentValue('m', 'a'), (e: GraphError) => e.status === 404 && e.code === 'ErrorItemNotFound');
});

test('the JSON route also gives the content id of a picture inside the mail, and where a cloud file lives', async () => {
  const { g } = setup([res(200, { name: 'p.png', contentType: 'image/png', contentBytes: btoa('x'), contentId: '<Logo@01D>' }), res(200, { name: 'Sky.docx', contentType: 'text/html', contentBytes: '', sourceUrl: 'https://x.sharepoint.com/f' })]);
  assert.equal((await g.attachmentBlob('m', 'a')).cid, 'logo@01d');
  assert.equal((await g.attachmentBlob('m', 'b')).link, 'https://x.sharepoint.com/f');
});

// ---- the way round when the browser may not talk to Microsoft's upload address ----------------------------------------------------------

const relayed = (status = 200, body: unknown = {}) => new Response(JSON.stringify(body), { status, headers: { 'X-Post-Relay': '1' } });
const session = () => res(200, { uploadUrl: 'https://upload.example/s?authtoken=T' });

test('when the browser cannot reach the upload address, the site passes the slices on, and remembers that', async () => {
  const routes: string[] = [];
  const { g, calls } = setup([res(201, { id: 'D1' }), session(), new Error('Failed to fetch'), relayed(200), relayed(201), res(202)], { uploadRelay: 'https://site.example/api/post-upload', onUploadRoute: (r) => routes.push(r) });
  await g.deliver(note(), [file('big.pdf', 5_000_000)]);
  assert.deepEqual(calls.slice(2).map((c) => c.url), ['https://upload.example/s?authtoken=T', 'https://site.example/api/post-upload', 'https://site.example/api/post-upload', 'https://graph.microsoft.com/v1.0/me/messages/D1/send']);
  assert.equal(hdr(calls[3])['X-Upload-Url'], 'https://upload.example/s?authtoken=T');
  assert.equal(hdr(calls[3])['Content-Range'], 'bytes 0-3276799/5000000');
  assert.equal(hdr(calls[4])['Content-Range'], 'bytes 3276800-4999999/5000000');
  assert.equal(hdr(calls[3]).Authorization, undefined, 'the sign-in never goes to the relay either');
  assert.deepEqual(routes, ['relay']);
});

test('the direct way is tried once, not with the usual waiting and retrying', async () => {
  const { g, sleeps } = setup([res(201, { id: 'D1' }), session(), new Error('Failed to fetch'), relayed(200), res(202)], { uploadRelay: 'https://site.example/api/post-upload' });
  await g.deliver(note(), [file('big.pdf', 3_100_000)]);
  assert.deepEqual(sleeps, []);
});

test('starting with the relay (it worked last time) never tries the direct way', async () => {
  const { g, calls } = setup([res(201, { id: 'D1' }), session(), relayed(201), res(202)], { uploadRelay: 'https://site.example/api/post-upload', uploadViaRelay: true });
  await g.deliver(note(), [file('big.pdf', 3_100_000)]);
  assert.equal(calls.some((c) => c.url.startsWith('https://upload.example')), false);
});

test('without a relay, a dropped connection while uploading is retried as usual and then reported', async () => {
  const net = () => new Error('Failed to fetch');
  const { g, sleeps } = setup([res(201, { id: 'D1' }), session(), net(), net(), net(), net()], { maxRetries: 3 });
  // the draft is then looked at (nothing arrived), and the upload is tried again from the start, up to the usual number of times
  await assert.rejects(() => g.deliver(note(), [file('big.pdf', 3_100_000)]), (e: GraphError) => e.status === 0);
  assert.deepEqual(sleeps.slice(0, 3), [500, 1000, 2000]);
});

test('a missing relay (the site answers with its web page) is an error, never a successful upload, and not tried over and over', async () => {
  const { g, calls } = setup([res(201, { id: 'D1' }), session(), new Error('Failed to fetch'), new Response('<html></html>', { status: 200 })], { uploadRelay: 'https://site.example/api/post-upload' });
  await assert.rejects(() => g.deliver(note(), [file('big.pdf', 3_100_000)]), (e: GraphError) => e.code === 'upload');
  assert.equal(calls.length, 4);
});

test('Microsoft refusing a slice is reported as it is, the relay is not a second chance', async () => {
  const { g, calls } = setup([res(201, { id: 'D1' }), session(), res(403, { error: { code: 'Forbidden', message: 'expired' } })], { uploadRelay: 'https://site.example/api/post-upload' });
  await assert.rejects(() => g.deliver(note(), [file('big.pdf', 3_100_000)]), (e: GraphError) => e.status === 403);
  assert.equal(calls.some((c) => c.url === 'https://site.example/api/post-upload'), false);
});

// ---- conversations -----------------------------------------------------------------------------------------------------------------------

test('a conversation is asked for by its id, safely quoted and encoded, without a sort order Microsoft would refuse', async () => {
  const { g, calls } = setup([res(200, { value: [{ id: 'm1' }, { id: 'm2' }] })]);
  const rows = await g.conversation("AAQk=/+it's");
  assert.deepEqual(rows.map((r) => r.id), ['m1', 'm2']);
  const url = decodeURIComponent(calls[0].url.replace('https://graph.microsoft.com/v1.0', ''));
  assert.match(url, /^\/me\/messages\?\$filter=conversationId eq 'AAQk=\/\+it''s'&\$select=.*parentFolderId.*,isDraft&\$top=50$/);
  assert.doesNotMatch(url, /orderby/i);
  assert.doesNotMatch(calls[0].url, /it's/); // the quote itself is encoded, so it cannot end the filter early
});

test('a long conversation is followed over pages, up to the limit', async () => {
  const page = (from: number, next?: string) => res(200, { value: Array.from({ length: 50 }, (_, i) => ({ id: `m${from + i}` })), ...(next ? { '@odata.nextLink': next } : {}) });
  const a = setup([page(0, 'https://graph/p2'), page(50, 'https://graph/p3'), page(100)]);
  assert.equal((await a.g.conversation('C')).length, 100); // the default limit is two full pages, so the third is never asked for
  assert.equal(a.calls.length, 2);
  assert.equal(a.calls[1].url, 'https://graph/p2');
  const b = setup([page(0, 'https://graph/p2'), page(50)]);
  assert.equal((await b.g.conversation('C', 30)).length, 30); // a smaller limit is respected in what is given back
  assert.equal(b.calls.length, 1);
});

test('a conversation Microsoft cannot find is an empty list, and a failure is an error the caller can show', async () => {
  const { g } = setup([res(200, {}), res(500, { error: { code: 'ErrorInternalServerError', message: 'x' } })]);
  assert.deepEqual(await g.conversation('C'), []);
  await assert.rejects(() => g.conversation('C'), (e: GraphError) => e.status === 500);
});

test('folder ids come from one batch, and a folder that is missing is left out', async () => {
  const { g, calls } = setup([res(200, { responses: [{ id: '0', status: 200, body: { id: 'DEL' } }, { id: '1', status: 404, body: { error: {} } }, { id: '2', status: 200, body: { id: 'DRAFTS' } }] })]);
  const ids = await g.folderIds(['deleteditems', 'junkemail', 'drafts']);
  assert.deepEqual(ids, { deleteditems: 'DEL', drafts: 'DRAFTS' });
  assert.equal(calls.length, 1);
  const sent = JSON.parse(String(calls[0].init.body)).requests.map((r: any) => r.url);
  assert.deepEqual(sent, ['/me/mailFolders/deleteditems?$select=id', '/me/mailFolders/junkemail?$select=id', '/me/mailFolders/drafts?$select=id']);
});
