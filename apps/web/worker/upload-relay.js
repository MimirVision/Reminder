// Post's way round for big attachments. Outlook takes a file over 3 MB in slices, sent to a private upload address on its own servers. A
// browser may not be allowed to talk to that address, so when it is not, Post hands each slice to this route and it is passed on from here.
//
// It is not a general proxy: it accepts one thing, a PUT of at most 4 MB with a Content-Range, to an Outlook upload address (the address
// itself carries the permission, so no sign-in is ever sent through here), and it does not follow redirects.

const HOSTS = new Set(['outlook.office.com', 'outlook.office365.com', 'outlook.live.com']);
const MAX_SLICE = 4 * 1024 * 1024;

export function isUploadAddress(value) {
  let u;
  try { u = new URL(String(value)); } catch { return false; }
  let path;
  try { path = decodeURIComponent(u.pathname); } catch { return false; }
  return u.protocol === 'https:' && !u.port && !u.username && !u.password && HOSTS.has(u.hostname) && /\/AttachmentSessions\(/i.test(path);
}

/** `send` is the fetch that reaches Outlook (replaced in tests). */
export async function relayUpload(request, send = fetch) {
  const reply = (status, message) => new Response(JSON.stringify({ error: { code: 'relay', message } }), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Post-Relay': '1' } });
  if (request.method !== 'PUT') return reply(405, 'PUT only');
  const site = request.headers.get('Sec-Fetch-Site');
  if (site && site !== 'same-origin') return reply(403, 'Post only');
  const target = request.headers.get('X-Upload-Url') ?? '';
  if (!isUploadAddress(target)) return reply(400, 'Not an Outlook upload address');
  const range = request.headers.get('Content-Range') ?? '';
  if (!/^bytes \d{1,12}-\d{1,12}\/\d{1,12}$/.test(range)) return reply(400, 'Content-Range is missing');
  const announced = Number(request.headers.get('Content-Length'));
  if (announced > MAX_SLICE) return reply(413, 'Slice too big');
  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > MAX_SLICE) return reply(bytes.byteLength ? 413 : 400, bytes.byteLength ? 'Slice too big' : 'Nothing to upload');
  let res;
  try {
    res = await send(target, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'Content-Range': range }, body: bytes, redirect: 'manual' });
  } catch {
    return reply(502, 'Could not reach Outlook');
  }
  const headers = new Headers({ 'Cache-Control': 'no-store', 'X-Post-Relay': '1' });
  const type = res.headers.get('Content-Type');
  if (type) headers.set('Content-Type', type);
  return new Response(res.status === 204 || res.status === 205 || res.status === 304 ? null : res.body, { status: res.status, headers });
}
