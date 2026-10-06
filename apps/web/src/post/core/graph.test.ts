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

// ---- sending files -----------------------------------------------------------------------------------------------------------------------

const file = (name: string, size: number, type = 'application/pdf') => ({ name, type, bytes: new Uint8Array(size).fill(65) });
const hdr = (c: { init: RequestInit }) => c.init.headers as Record<string, string>;

test('toBase64 handles files bigger than one chunk', () => {
  const bytes = Uint8Array.from({ length: 100_000 }, (_, i) => i % 251);
  assert.deepEqual(Uint8Array.from(atob(toBase64(bytes)), (c) => c.charCodeAt(0)), bytes);
  assert.equal(toBase64(new Uint8Array(0)), '');
});

test('a mail without files is sent exactly as before', async () => {
  const { g, calls } = setup([res(202)]);
  await g.sendMail({ subject: 's', body: 'b', to: ['a@b.no'], files: [] });
  assert.equal(calls.length, 1);
  assert.equal(JSON.parse(String(calls[0].init.body)).message.attachments, undefined);
});

test('a few small files travel inside the message, in one call', async () => {
  const { g, calls } = setup([res(202)]);
  await g.sendMail({ subject: 's', body: 'b', to: ['a@b.no'], files: [file('a.pdf', 1000), { name: 'b.bin', type: '', bytes: new Uint8Array([1, 2, 3]) }] });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/me\/sendMail$/);
  const b = JSON.parse(String(calls[0].init.body));
  assert.equal(b.saveToSentItems, true);
  assert.deepEqual(b.message.attachments.map((a: any) => [a['@odata.type'], a.name, a.contentType]), [['#microsoft.graph.fileAttachment', 'a.pdf', 'application/pdf'], ['#microsoft.graph.fileAttachment', 'b.bin', 'application/octet-stream']]);
  assert.equal(b.message.attachments[0].contentBytes.length, Math.ceil(1000 / 3) * 4);
  assert.equal(b.message.attachments[1].contentBytes, 'AQID');
});

test('files that are too many to travel inside go through a draft: made, filled one by one, then sent', async () => {
  const { g, calls } = setup([res(201, { id: 'D/1' }), res(201, {}), res(201, {}), res(202)]);
  await g.sendMail({ subject: 'Hei', body: 'Tekst', to: ['a@b.no'], cc: ['c@d.no'], files: [file('a.pdf', 1_500_000), file('b.pdf', 1_500_000)] });
  assert.deepEqual(calls.map((c) => `${c.init.method} ${c.url.replace('https://graph.microsoft.com/v1.0', '')}`), ['POST /me/messages', 'POST /me/messages/D%2F1/attachments', 'POST /me/messages/D%2F1/attachments', 'POST /me/messages/D%2F1/send']);
  const draft = JSON.parse(String(calls[0].init.body));
  assert.equal(draft.subject, 'Hei');
  assert.equal(draft.toRecipients[0].emailAddress.address, 'a@b.no');
  assert.equal(draft.ccRecipients[0].emailAddress.address, 'c@d.no');
  assert.equal(JSON.parse(String(calls[1].init.body)).name, 'a.pdf');
  assert.equal(calls.every((c) => hdr(c).Authorization === 'Bearer old'), true);
});

test('a file over 3 MB goes up in slices to the private upload address, without the sign-in', async () => {
  const size = 9_000_000;
  const { g, calls } = setup([res(201, { id: 'D1' }), res(200, { uploadUrl: 'https://upload.example/session/abc' }), res(200), res(200), res(201), res(202)]);
  await g.sendMail({ subject: 's', body: 'b', to: ['a@b.no'], files: [file('big.pdf', size)] });
  const urls = calls.map((c) => c.url.replace('https://graph.microsoft.com/v1.0', ''));
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

test('a refused upload slice is an error, and the draft is deleted so nothing is left in Drafts', async () => {
  const { g, calls } = setup([res(201, { id: 'D1' }), res(200, { uploadUrl: 'https://upload.example/s' }), res(401, { error: { code: 'Unauthorized', message: 'no' } }), res(204)]);
  await assert.rejects(() => g.sendMail({ subject: 's', body: 'b', to: ['a@b.no'], files: [file('big.pdf', 4_000_000)] }), (e: GraphError) => e.status === 401);
  assert.equal(calls.at(-1)!.init.method, 'DELETE');
  assert.match(calls.at(-1)!.url, /\/me\/messages\/D1$/);
  assert.equal(calls.length, 4, 'the sign-in is not "renewed" for an address that never wanted it');
});

test('if the draft cannot be deleted either, the first error is the one reported', async () => {
  const { g } = setup([res(201, { id: 'D1' }), res(413, { error: { code: 'ErrorMessageSizeExceeded', message: 'too big' } }), res(500), res(500), res(500), res(500)]);
  await assert.rejects(() => g.sendMail({ subject: 's', body: 'b', to: ['a@b.no'], files: [file('a.pdf', 2_900_000), file('b.pdf', 2_900_000)] }), (e: GraphError) => e.status === 413 && e.code === 'ErrorMessageSizeExceeded');
});

test('a draft Outlook did not create is an error, not a send to nowhere', async () => {
  const { g, calls } = setup([res(201, {})]);
  await assert.rejects(() => g.sendMail({ subject: 's', body: 'b', to: ['a@b.no'], files: [file('a.pdf', 2_000_000), file('b.pdf', 2_000_000)] }), (e: GraphError) => e.code === 'draft');
  assert.equal(calls.length, 1);
});

test('a reply with files is made as a draft that keeps the conversation, then sent', async () => {
  const { g, calls } = setup([res(201, { id: 'R1' }), res(201, {}), res(202)]);
  await g.reply('orig/1', 'Takk!', false, [file('svar.pdf', 100)]);
  assert.deepEqual(calls.map((c) => `${c.init.method} ${c.url.replace('https://graph.microsoft.com/v1.0', '')}`), ['POST /me/messages/orig%2F1/createReply', 'POST /me/messages/R1/attachments', 'POST /me/messages/R1/send']);
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { comment: 'Takk!' });
});

test('reply all and forward with files use their own draft calls', async () => {
  const a = setup([res(201, { id: 'R1' }), res(201, {}), res(202)]);
  await a.g.reply('o', 'x', true, [file('f.pdf', 10)]);
  assert.match(a.calls[0].url, /\/o\/createReplyAll$/);
  const b = setup([res(201, { id: 'F1' }), res(201, {}), res(202)]);
  await b.g.forward('o', ['z@y.no'], 'se her', [file('f.pdf', 10)]);
  assert.match(b.calls[0].url, /\/o\/createForward$/);
  assert.deepEqual(JSON.parse(String(b.calls[0].init.body)), { comment: 'se her', toRecipients: [{ emailAddress: { address: 'z@y.no' } }] });
  assert.match(b.calls[2].url, /\/F1\/send$/);
});

test('reply and forward without files are the plain one-call versions', async () => {
  const { g, calls } = setup([res(202), res(202), res(202)]);
  await g.reply('o', 'x');
  await g.reply('o', 'x', true, []);
  await g.forward('o', ['z@y.no'], 'se her');
  assert.deepEqual(calls.map((c) => c.url.replace('https://graph.microsoft.com/v1.0', '')), ['/me/messages/o/reply', '/me/messages/o/replyAll', '/me/messages/o/forward']);
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
  await g.sendMail({ subject: 's', body: 'b', to: ['a@b.no'], files: [file('big.pdf', 5_000_000)] });
  assert.deepEqual(calls.slice(2).map((c) => c.url), ['https://upload.example/s?authtoken=T', 'https://site.example/api/post-upload', 'https://site.example/api/post-upload', 'https://graph.microsoft.com/v1.0/me/messages/D1/send']);
  assert.equal(hdr(calls[3])['X-Upload-Url'], 'https://upload.example/s?authtoken=T');
  assert.equal(hdr(calls[3])['Content-Range'], 'bytes 0-3276799/5000000');
  assert.equal(hdr(calls[4])['Content-Range'], 'bytes 3276800-4999999/5000000');
  assert.equal(hdr(calls[3]).Authorization, undefined, 'the sign-in never goes to the relay either');
  assert.deepEqual(routes, ['relay']);
});

test('the direct way is tried once, not with the usual waiting and retrying', async () => {
  const { g, sleeps } = setup([res(201, { id: 'D1' }), session(), new Error('Failed to fetch'), relayed(200), res(202)], { uploadRelay: 'https://site.example/api/post-upload' });
  await g.sendMail({ subject: 's', body: 'b', to: ['a@b.no'], files: [file('big.pdf', 3_100_000)] });
  assert.deepEqual(sleeps, []);
});

test('starting with the relay (it worked last time) never tries the direct way', async () => {
  const { g, calls } = setup([res(201, { id: 'D1' }), session(), relayed(201), res(202)], { uploadRelay: 'https://site.example/api/post-upload', uploadViaRelay: true });
  await g.sendMail({ subject: 's', body: 'b', to: ['a@b.no'], files: [file('big.pdf', 3_100_000)] });
  assert.equal(calls.some((c) => c.url.startsWith('https://upload.example')), false);
});

test('without a relay, a dropped connection while uploading is retried as usual and then reported', async () => {
  const net = () => new Error('Failed to fetch');
  const { g, sleeps } = setup([res(201, { id: 'D1' }), session(), net(), net(), net(), net(), res(204)]);
  await assert.rejects(() => g.sendMail({ subject: 's', body: 'b', to: ['a@b.no'], files: [file('big.pdf', 3_100_000)] }), (e: GraphError) => e.status === 0 && e.code === 'network');
  assert.deepEqual(sleeps, [500, 1000, 2000]);
});

test('a missing relay (the site answers with its web page) is an error, never a successful upload', async () => {
  const { g } = setup([res(201, { id: 'D1' }), session(), new Error('Failed to fetch'), new Response('<html></html>', { status: 200 }), res(204)], { uploadRelay: 'https://site.example/api/post-upload' });
  await assert.rejects(() => g.sendMail({ subject: 's', body: 'b', to: ['a@b.no'], files: [file('big.pdf', 3_100_000)] }), (e: GraphError) => e.code === 'upload');
});

test('Microsoft refusing a slice is reported as it is, the relay is not a second chance', async () => {
  const { g, calls } = setup([res(201, { id: 'D1' }), session(), res(403, { error: { code: 'Forbidden', message: 'expired' } }), res(204)], { uploadRelay: 'https://site.example/api/post-upload' });
  await assert.rejects(() => g.sendMail({ subject: 's', body: 'b', to: ['a@b.no'], files: [file('big.pdf', 3_100_000)] }), (e: GraphError) => e.status === 403);
  assert.equal(calls.some((c) => c.url === 'https://site.example/api/post-upload'), false);
});
