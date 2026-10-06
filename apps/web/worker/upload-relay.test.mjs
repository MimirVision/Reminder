import test from 'node:test';
import assert from 'node:assert/strict';
import { isUploadAddress, relayUpload } from './upload-relay.js';

const ADDR = "https://outlook.office.com/api/gv1.0/users('u')/messages('m')/AttachmentSessions('s')?authtoken=T";
const put = (over = {}, body = new Uint8Array(1000)) => new Request('https://site.example/api/post-upload', {
  method: 'PUT', body,
  headers: { 'X-Upload-Url': ADDR, 'Content-Range': 'bytes 0-999/5000', 'Content-Type': 'application/octet-stream', 'Sec-Fetch-Site': 'same-origin', ...over },
});
const outlook = (calls, answer = () => new Response(JSON.stringify({ nextExpectedRanges: ['1000-'] }), { status: 200, headers: { 'Content-Type': 'application/json' } })) =>
  async (url, init) => { calls.push({ url: String(url), init }); return answer(); };

test('a slice is passed on to Outlook with its range, and the answer comes back as it is', async () => {
  const calls = [];
  const r = await relayUpload(put(), outlook(calls));
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('X-Post-Relay'), '1');
  assert.equal(r.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await r.json(), { nextExpectedRanges: ['1000-'] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, ADDR);
  assert.equal(calls[0].init.method, 'PUT');
  assert.equal(calls[0].init.headers['Content-Range'], 'bytes 0-999/5000');
  assert.equal(calls[0].init.body.byteLength, 1000);
  assert.equal(calls[0].init.redirect, 'manual');
});

test('nothing but the range and the type is sent on: no sign-in, no cookies, nothing from the page', async () => {
  const calls = [];
  await relayUpload(put({ Authorization: 'Bearer secret', Cookie: 'a=b', Origin: 'https://site.example' }), outlook(calls));
  assert.deepEqual(Object.keys(calls[0].init.headers).sort(), ['Content-Range', 'Content-Type']);
});

test('Outlook\'s refusals and its "created" answer for the last slice pass through with their status', async () => {
  for (const status of [201, 400, 401, 404, 416, 500]) {
    const r = await relayUpload(put(), outlook([], () => new Response(status === 201 ? null : '{"error":{"code":"x"}}', { status })));
    assert.equal(r.status, status);
    assert.equal(r.headers.get('X-Post-Relay'), '1');
  }
});

test('only an Outlook upload address is accepted', () => {
  assert.equal(isUploadAddress(ADDR), true);
  assert.equal(isUploadAddress("https://outlook.office365.com/api/v2.0/users('u')/messages('m')/AttachmentSessions('s')"), true);
  for (const bad of [
    '', 'nonsense', 'http://outlook.office.com/api/x/AttachmentSessions(\'s\')',
    "https://evil.example/api/x/AttachmentSessions('s')", "https://outlook.office.com.evil.example/api/x/AttachmentSessions('s')",
    "https://user:pw@outlook.office.com/api/x/AttachmentSessions('s')", "https://outlook.office.com:8443/api/x/AttachmentSessions('s')",
    'https://outlook.office.com/api/gv1.0/me/messages', 'https://graph.microsoft.com/v1.0/me/messages', 'https://169.254.169.254/latest/meta-data/',
    "https://outlook.office.com/%E0%A4%A/AttachmentSessions(", 'https://outlook.office.com/',
  ]) assert.equal(isUploadAddress(bad), false, bad);
});

test('anything else is refused before Outlook is asked', async () => {
  const calls = [];
  const send = outlook(calls);
  const cases = [
    [new Request('https://site.example/api/post-upload', { method: 'GET' }), 405],
    [new Request('https://site.example/api/post-upload', { method: 'POST', body: 'x' }), 405],
    [put({ 'X-Upload-Url': 'https://evil.example/AttachmentSessions(1)' }), 400],
    [put({ 'X-Upload-Url': '' }), 400],
    [put({ 'Content-Range': '' }), 400],
    [put({ 'Content-Range': 'bytes 0-999/abc' }), 400],
    [put({ 'Sec-Fetch-Site': 'cross-site' }), 403],
    [put({ 'Sec-Fetch-Site': 'same-site' }), 403],
    [put({}, new Uint8Array(0)), 400],
    [put({}, new Uint8Array(4 * 1024 * 1024 + 1)), 413],
  ];
  for (const [req, status] of cases) {
    const r = await relayUpload(req, send);
    assert.equal(r.status, status, `${req.method} ${req.headers.get('X-Upload-Url')} -> ${r.status}`);
    assert.equal(r.headers.get('X-Post-Relay'), '1', 'the browser can tell this came from the relay');
  }
  assert.equal(calls.length, 0);
});

test('a slice of exactly 4 MB is accepted', async () => {
  const r = await relayUpload(put({}, new Uint8Array(4 * 1024 * 1024)), outlook([]));
  assert.equal(r.status, 200);
});

test('when Outlook cannot be reached the answer is a clear 502', async () => {
  const r = await relayUpload(put(), async () => { throw new Error('connect'); });
  assert.equal(r.status, 502);
  assert.equal((await r.json()).error.code, 'relay');
});

test('a request without a Sec-Fetch-Site header (not a browser) still works, since it needs the private address anyway', async () => {
  const headers = { 'X-Upload-Url': ADDR, 'Content-Range': 'bytes 0-9/10' };
  const r = await relayUpload(new Request('https://site.example/api/post-upload', { method: 'PUT', body: new Uint8Array(10), headers }), outlook([]));
  assert.equal(r.status, 200);
});
