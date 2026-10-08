import test from 'node:test';
import assert from 'node:assert/strict';
import { createController } from './controller.ts';
import { memoryStore, type Store } from './store.ts';

const SERVER = 'https://s.example/fn';
const GRAPH = 'https://graph.microsoft.com/v1.0';
const A = 'a@outlook.com';
const W = 'w@firma.no';
const MARIA = { name: 'Maria Lund', address: 'maria@x.no' };

// A pretend Outlook with folders. A mailbox is a set of folders and the messages in them, and this answers the calls Post makes about them the way
// Outlook does: a moved message gets a new id, a sent draft goes to Sent Items under a new id, a folder page has a link to the next one. The
// standard folders have Norwegian names, as in a Norwegian mailbox: Post names them itself.
const STANDARD: [string, string][] = [['inbox', 'Innboks'], ['drafts', 'Kladd'], ['sentitems', 'Sendte elementer'], ['archive', 'Arkiv'], ['junkemail', 'Søppelpost'], ['deleteditems', 'Slettede elementer'], ['outbox', 'Utboks']];
const idOf = (name: string) => (STANDARD.some(([n]) => n === name) ? `ID-${name}` : name);

interface Person { name: string; address: string }
interface Msg { id: string; folder: string; subject: string; received: string; from?: string; fromName?: string; to?: Person[]; cc?: Person[]; bcc?: Person[]; isRead?: boolean; flagged?: boolean; draft?: boolean; body?: string; attachments?: { name: string; size: number }[]; modified?: string; conversationId?: string }
interface Box { folders: Map<string, { id: string; name: string; parent: string }>; msgs: Map<string, Msg> }
type Answer = { status: number; body?: unknown };

function outlook(emails: string[] = [A]) {
  const log: string[] = [];
  const flags = {
    offline: false, noHeaders: false, down: new Set<string>(), permanentStatus: 204, moveStatus: 201, sendStatus: 202, patchStatus: 200,
    /** What Outlook calls a move to a folder that is not there (it may say "item not found", as for a message that is gone). */ missingFolder: 'ErrorFolderNotFound',
    /** Calls that Outlook carries out and then loses the answer to (the connection drops on the way back). */ loseAfter: [] as string[],
    /** A folder whose pages are held back until the gate opens. */ hold: null as null | { folder: string; until: Promise<void> },
  };
  const boxes = new Map<string, Box>(emails.map((e) => [e, { folders: new Map(STANDARD.map(([n, name]) => [`ID-${n}`, { id: `ID-${n}`, name, parent: 'ROOT' }])), msgs: new Map() }]));
  const box = (email: string) => boxes.get(email)!;
  const put = (email: string, where: string, m: Partial<Msg> & { id: string }) => { box(email).msgs.set(m.id, { subject: `Subject ${m.id}`, received: '2026-10-01T10:00:00Z', isRead: true, ...m, folder: idOf(where) }); };
  const folder = (email: string, id: string, name: string, parent = 'ROOT') => { box(email).folders.set(id, { id, name, parent: idOf(parent) }); };
  const inFolder = (email: string, where: string) => [...box(email).msgs.values()].filter((m) => m.folder === idOf(where));
  const ids = (email: string, where: string) => inFolder(email, where).map((m) => m.id).sort();
  const people = (list: Person[] = []) => list.map((p) => ({ emailAddress: { name: p.name, address: p.address } }));
  const raw = (m: Msg) => ({
    id: m.id, conversationId: m.conversationId ?? `c-${m.id}`, receivedDateTime: m.received, lastModifiedDateTime: m.modified ?? m.received, subject: m.subject,
    from: { emailAddress: { name: m.fromName ?? 'Anna Berg', address: m.from ?? 'anna@x.no' } }, bodyPreview: m.body ?? 'preview', isRead: m.isRead !== false, isDraft: !!m.draft,
    flag: { flagStatus: m.flagged ? 'flagged' : 'notFlagged' }, hasAttachments: !!m.attachments?.length, parentFolderId: m.folder, toRecipients: people(m.to),
  });
  const folderBody = (b: Box, f: { id: string; name: string; parent: string }) => {
    const mine = [...b.msgs.values()].filter((m) => m.folder === f.id);
    return { id: f.id, displayName: f.name, parentFolderId: f.parent, childFolderCount: [...b.folders.values()].filter((x) => x.parent === f.id).length, unreadItemCount: mine.filter((m) => m.isRead === false).length, totalItemCount: mine.length };
  };
  const ok = (body: unknown = {}, status = 200): Answer => ({ status, body });
  const fail = (status: number, code: string, message: string): Answer => ({ status, body: { error: { code, message } } });
  const missing = () => fail(404, 'ErrorItemNotFound', 'The specified object was not found in the store.');
  let seq = 0;
  let stamps = 0;
  /** Every change to a message moves its "last changed" forward, as Outlook does. */
  const stamp = () => new Date(Date.parse('2026-10-05T11:00:00Z') + (++stamps) * 1000).toISOString();

  async function handle(email: string, b: Box, method: string, path: string, body: any): Promise<Answer> {
    const url = new URL(path.startsWith('http') ? path : `${GRAPH}${path}`);
    const p = url.pathname.replace(/^\/v1\.0/, '');
    const q = url.searchParams;
    const select = q.get('$select') ?? '';
    let m: RegExpExecArray | null;
    const dest = (x: string) => (b.folders.has(x) ? x : b.folders.has(idOf(x)) ? idOf(x) : null);
    if (p === '/$batch') {
      const responses = [];
      for (const r of body.requests) responses.push({ id: r.id, ...(await handle(email, b, r.method, r.url, r.body)) });
      return ok({ responses });
    }
    if (url.hostname === 'graph' || /^\/me\/mailFolders\/[^/]+\/messages\/delta$/.test(p)) { log.push('delta'); return ok({ value: inFolder(email, 'inbox').map(raw), '@odata.deltaLink': `https://graph/delta?d=${++seq}` }); }
    if (method === 'GET' && p === '/me/mailFolders') { log.push('folders'); return ok({ value: [...b.folders.values()].filter((f) => f.parent === 'ROOT').map((f) => folderBody(b, f)) }); }
    if (method === 'GET' && (m = /^\/me\/mailFolders\/([^/]+)$/.exec(p))) { const id = dest(decodeURIComponent(m[1])); const f = id ? b.folders.get(id) : undefined; return f ? ok(folderBody(b, f)) : missing(); }
    if (method === 'GET' && (m = /^\/me\/mailFolders\/([^/]+)\/childFolders$/.exec(p))) { const id = decodeURIComponent(m[1]); return ok({ value: [...b.folders.values()].filter((f) => f.parent === id).map((f) => folderBody(b, f)) }); }
    if (method === 'GET' && (m = /^\/me\/mailFolders\/([^/]+)\/messages$/.exec(p))) {
      const id = dest(decodeURIComponent(m[1]));
      if (!id) return missing();
      if (select === 'toRecipients,ccRecipients') return ok({ value: inFolder(email, id).map((x) => ({ toRecipients: people(x.to), ccRecipients: [] })) });
      log.push(`page ${id}${q.get('skip') ? ` skip ${q.get('skip')}` : ''}`);
      if (flags.hold?.folder === id) await flags.hold.until;
      const order = q.get('$orderby') ?? '';
      const key = (x: Msg) => (/lastModified/.test(order) ? x.modified ?? x.received : x.received);
      const all = inFolder(email, id).sort((x, y) => key(y).localeCompare(key(x)));
      const skip = Number(q.get('skip') ?? 0), top = Number(q.get('$top') ?? 40);
      const next = skip + top < all.length ? `${GRAPH}${p}?$top=${top}&$orderby=${order}&skip=${skip + top}` : undefined;
      return ok({ value: all.slice(skip, skip + top).map(raw), ...(next ? { '@odata.nextLink': next } : {}) });
    }
    if (method === 'GET' && p === '/me/messages' && q.has('$search')) {
      log.push('search');
      const term = (q.get('$search') ?? '').replace(/"/g, '').toLowerCase();
      return ok({ value: [...b.msgs.values()].filter((x) => x.subject.toLowerCase().includes(term)).slice(0, 25).map(raw) });
    }
    if (method === 'GET' && p === '/me/messages' && q.has('$filter')) {
      const id = /conversationId eq '(.*)'/.exec(q.get('$filter') ?? '')?.[1];
      return ok({ value: [...b.msgs.values()].filter((x) => (x.conversationId ?? `c-${x.id}`) === id).map(raw) });
    }
    if (method === 'POST' && (m = /^\/me\/messages\/([^/]+)\/move$/.exec(p))) {
      const id = decodeURIComponent(m[1]);
      log.push(`move ${id} ${body.destinationId}`);
      if (flags.moveStatus !== 201) return fail(flags.moveStatus, 'ErrorAccessDenied', 'Access is denied.');
      const x = b.msgs.get(id);
      if (!x) return missing();
      const to = dest(String(body.destinationId));
      if (!to) return fail(404, flags.missingFolder, 'The folder was not found.');
      b.msgs.delete(id);
      b.msgs.set(`${id}~`, { ...x, id: `${id}~`, folder: to });
      return ok({ id: `${id}~` }, 201);
    }
    if (method === 'PATCH' && (m = /^\/me\/messages\/([^/?]+)$/.exec(p))) {
      const id = decodeURIComponent(m[1]);
      log.push(`patch ${id} ${JSON.stringify(body)}`);
      if (flags.patchStatus !== 200) return fail(flags.patchStatus, 'ErrorAccessDenied', 'Access is denied.');
      const x = b.msgs.get(id);
      if (!x) return missing();
      const addresses = (rs: any[]): Person[] => rs.map((r) => ({ name: r.emailAddress.address, address: r.emailAddress.address }));
      x.modified = stamp();
      if ('isRead' in body) x.isRead = !!body.isRead;
      if (body.flag) x.flagged = body.flag.flagStatus === 'flagged';
      if ('subject' in body) x.subject = body.subject;
      if (body.body) x.body = body.body.content;
      if (body.toRecipients) x.to = addresses(body.toRecipients);
      if (body.ccRecipients) x.cc = addresses(body.ccRecipients);
      return ok({});
    }
    if (method === 'GET' && (m = /^\/me\/messages\/([^/?]+)$/.exec(p))) {
      const id = decodeURIComponent(m[1]);
      const x = b.msgs.get(id);
      if (!x) return missing();
      if (select === 'isDraft') { log.push(`isDraft ${id}`); return ok({ isDraft: !!x.draft }); }
      if (select === 'internetMessageHeaders') return flags.noHeaders ? fail(500, 'ErrorServerBusy', 'busy') : ok({ internetMessageHeaders: [] });
      if (select.includes('bccRecipients')) return ok({ subject: x.subject, body: { contentType: 'text', content: x.body ?? '' }, toRecipients: people(x.to), ccRecipients: people(x.cc), bccRecipients: people(x.bcc), isDraft: !!x.draft, lastModifiedDateTime: x.modified ?? x.received });
      if (select.startsWith('body')) return ok({ body: { contentType: 'html', content: `<p>${x.body ?? 'Hei'}</p>` }, toRecipients: people(x.to), hasAttachments: !!x.attachments?.length });
      log.push(`get ${id}`);
      return ok(raw(x));
    }
    if (method === 'GET' && (m = /^\/me\/messages\/([^/]+)\/attachments$/.exec(p))) {
      const x = b.msgs.get(decodeURIComponent(m[1]));
      if (!x) return missing();
      return ok({ value: (x.attachments ?? []).map((a, i) => ({ id: `att${i}`, name: a.name, size: a.size, contentType: 'application/octet-stream', isInline: false, '@odata.type': '#microsoft.graph.fileAttachment' })) });
    }
    if (method === 'POST' && (m = /^\/me\/messages\/([^/]+)\/attachments$/.exec(p))) {
      const id = decodeURIComponent(m[1]);
      const x = b.msgs.get(id);
      if (!x) return missing();
      log.push(`attach ${id} ${body.name}`);
      x.attachments = [...(x.attachments ?? []), { name: body.name, size: atob(body.contentBytes).length }];
      return ok({}, 201);
    }
    if (method === 'POST' && (m = /^\/me\/messages\/([^/]+)\/send$/.exec(p))) {
      const id = decodeURIComponent(m[1]);
      log.push(`send ${id}`);
      const x = b.msgs.get(id);
      if (!x?.draft) return missing();
      if (flags.sendStatus !== 202) return fail(flags.sendStatus, 'ErrorInvalidRecipients', 'One or more recipients are not valid.');
      b.msgs.delete(id);
      b.msgs.set(`${id}~`, { ...x, id: `${id}~`, folder: 'ID-sentitems', draft: false });
      if (flags.loseAfter.includes('send')) { flags.loseAfter.splice(flags.loseAfter.indexOf('send'), 1); throw new Error('Failed to fetch'); }
      return ok(null, 202);
    }
    if (method === 'POST' && (m = /^\/me\/messages\/([^/]+)\/permanentDelete$/.exec(p))) {
      const id = decodeURIComponent(m[1]);
      log.push(`permanent ${id}`);
      if (flags.permanentStatus !== 204) return fail(flags.permanentStatus, 'ErrorAccessDenied', 'Access is denied.');
      if (!b.msgs.has(id)) return missing();
      b.msgs.delete(id);
      return ok(null, 204);
    }
    if (method === 'DELETE' && (m = /^\/me\/messages\/([^/]+)$/.exec(p))) { const id = decodeURIComponent(m[1]); log.push(`delete ${id}`); b.msgs.delete(id); return ok(null, 204); }
    return fail(404, 'NotFound', `Nothing here: ${method} ${path}`);
  }

  const f = (async (url: string, init: RequestInit = {}) => {
    if (flags.offline) throw new Error('offline');
    const u = String(url);
    const h = (init.headers ?? {}) as Record<string, string>;
    const body = typeof init.body === 'string' && init.body ? JSON.parse(init.body) : undefined;
    if (u === SERVER) {
      const email = String(h['x-post-session'] ?? '').replace(/^.*\.s-/, '');
      const j = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });
      if (!boxes.has(email)) return j({ error: 'unauthorized' }, 401);
      if (body.op === 'status') return j({ devices: 1, accounts: [{ id: email === A ? '1' : '2', email, label: email === A ? 'Personal' : 'Work', mode: 'people', quiet: null, vips: [], subscription_expires_at: null, last_alert_at: null }] });
      if (body.op === 'token') return j({ accessToken: `T-${email}`, expiresIn: 3600, email });
      return j({ ok: true });
    }
    const email = String(h.Authorization ?? '').replace(/^Bearer T-/, '');
    const b = boxes.get(email);
    if (!b) return new Response('{}', { status: 401 });
    if (flags.down.has(email)) return new Response(JSON.stringify({ error: { code: 'ErrorServerBusy', message: 'Outlook is busy' } }), { status: 500 });
    const a = await handle(email, b, init.method ?? 'GET', u, body);
    return new Response(a.status === 204 || a.status === 202 ? null : JSON.stringify(a.body ?? {}), { status: a.status });
  }) as typeof fetch;

  return { f, log, flags, put, folder, ids, dropFolder: (email: string, id: string) => { box(email).folders.delete(id); }, drop: (email: string, id: string) => { box(email).msgs.delete(id); }, get: (email: string, id: string) => box(email).msgs.get(id) };
}

function make(w = outlook(), opts: { emails?: string[]; store?: Store; kv?: Map<string, string>; at?: number } = {}) {
  const emails = opts.emails ?? [A];
  const store = opts.store ?? memoryStore();
  const kv = opts.kv ?? new Map<string, string>([['post.sessions', JSON.stringify(emails.map((e, i) => ({ email: e, id: String(i + 1), label: e === A ? 'Personal' : 'Work', session: `${i + 1}.s-${e}` })))]]);
  const timers: { fn: () => void; ms: number }[] = [];
  let t = opts.at ?? Date.parse('2026-10-05T10:00:00Z');
  const c = createController({
    store, fetch: w.f, serverUrl: SERVER, now: () => t, sleep: async () => {}, presortMs: 150, setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    kv: { get: (k) => kv.get(k) ?? null, set: (k, v) => void kv.set(k, v), del: (k) => void kv.delete(k) },
  });
  const runTimers = async () => { while (timers.length) { const x = timers.shift()!; x.fn(); await new Promise((r) => setTimeout(r, 5)); } };
  return { c, w, store, kv, advance: (ms: number) => { t += ms; }, runTimers };
}
type Made = ReturnType<typeof make>;

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** What waits to be sent, as the phone has it written down (the screen's copy follows a moment later). */
const waiting = async (x: Made) => ((await x.store.getMeta<{ id: string }[]>('outbox')) ?? []);
async function until(cond: () => boolean, what = 'something') { for (let i = 0; i < 400; i++) { if (cond()) return; await tick(5); } assert.fail(`timed out waiting for ${what}`); }
/** The undo time passes and everything that was waiting for it is carried out. */
const settle = async (x: Made) => { x.advance(7_000); await x.runTimers(); await tick(30); };

// ---- the list of folders -------------------------------------------------------------------------------------------------------------------------

test('the folders are listed in Post\'s words with their unread numbers, the ones you made come after, and nothing is asked for before a screen wants them', async () => {
  const w = outlook();
  w.folder(A, 'K', 'Kunder', 'inbox'); w.folder(A, 'P', 'Prosjekter');
  w.put(A, 'inbox', { id: 'i1', isRead: false }); w.put(A, 'inbox', { id: 'i2', isRead: false }); w.put(A, 'inbox', { id: 'i3' });
  w.put(A, 'archive', { id: 'a1' }); w.put(A, 'K', { id: 'k1', isRead: false });
  const { c } = make(w);
  await c.init();
  assert.deepEqual(c.getState().folders, []);
  assert.equal(w.log.includes('folders'), false);
  await c.loadFolders();
  const s = c.getState();
  assert.deepEqual(s.folders.map((x) => x.name), ['Inbox', 'Drafts', 'Sent', 'Archive', 'Junk', 'Deleted', 'Prosjekter', 'Kunder'], 'Outlook\'s Outbox is left out');
  assert.deepEqual(s.folders.find((x) => x.kind === 'inbox'), { account: A, id: 'ID-inbox', name: 'Inbox', kind: 'inbox', unread: 2, total: 3, depth: 0, where: '' });
  assert.deepEqual([s.folders.find((x) => x.name === 'Kunder')!.unread, s.folders.find((x) => x.name === 'Kunder')!.where], [1, 'Inbox']);
  assert.equal(s.foldersError, null);
  assert.equal(s.foldersLoading, false);
});

test('a list of folders that is only a moment old is not asked for again, but a pull to refresh or Retry always asks', async () => {
  const w = outlook();
  const { c, advance } = make(w);
  await c.init();
  const reads = () => w.log.filter((l) => l === 'folders').length;
  await c.loadFolders(); await c.loadFolders();
  assert.equal(reads(), 1);
  await c.loadFolders({ force: true });
  assert.equal(reads(), 2);
  advance(46_000);
  await c.loadFolders();
  assert.equal(reads(), 3);
});

test('two askers at once share one read of the folders; one that asks after a change waits for the read under way and reads again', async () => {
  const w = outlook();
  const { c } = make(w);
  await c.init();
  await Promise.all([c.loadFolders(), c.loadFolders()]);
  assert.equal(w.log.filter((l) => l === 'folders').length, 1);
  const first = c.loadFolders({ force: true });
  const second = c.loadFolders({ force: true });
  await Promise.all([first, second]);
  const reads = w.log.filter((l) => l === 'folders').length;
  assert.ok(reads === 2 || reads === 3, `a forced read after one under way: ${reads}`);
});

test('the folders last seen are kept on the phone: they are there at once, and with no connection', async () => {
  const w = outlook(); w.folder(A, 'P', 'Prosjekter');
  const first = make(w);
  await first.c.init(); await first.c.loadFolders();
  const second = make(w, { store: first.store });
  await second.c.init();
  w.flags.offline = true;
  await second.c.loadFolders({ force: true });
  const s = second.c.getState();
  assert.ok(s.folders.some((x) => x.name === 'Prosjekter'), 'the list from last time');
  assert.match(s.foldersError ?? '', /No connection/);
  assert.equal(s.foldersLoading, false);
});

test('a mailbox that cannot be read keeps the folders it had, the screen is told which one, and the next ask tries it again', async () => {
  const w = outlook([A, W]); w.folder(W, 'WP', 'Tilbud');
  const { c } = make(w, { emails: [A, W] });
  await c.init(); await c.loadFolders();
  assert.ok(c.getState().folders.some((x) => x.account === W && x.name === 'Tilbud'));
  w.flags.down.add(W);
  await c.loadFolders({ force: true });
  assert.ok(c.getState().folders.some((x) => x.account === W && x.name === 'Tilbud'), 'what was known stays');
  assert.match(c.getState().foldersError ?? '', /Work/);
  w.flags.down.delete(W);
  await c.loadFolders();
  assert.equal(c.getState().foldersError, null, 'a failed read does not count as fresh');
});

// ---- reading a folder ----------------------------------------------------------------------------------------------------------------------------

test('Sent is read from Outlook, newest first, and each message says who it went to', async () => {
  const w = outlook();
  w.put(A, 'sentitems', { id: 's1', subject: 'Tilbud', received: '2026-10-02T09:00:00Z', to: [MARIA] });
  w.put(A, 'sentitems', { id: 's2', subject: 'Re: Plan', received: '2026-10-03T09:00:00Z', to: [{ name: 'Per Hansen', address: 'per@x.no' }, { name: 'Kari Dahl', address: 'kari@x.no' }] });
  w.put(A, 'inbox', { id: 'i1' });
  const { c } = make(w);
  await c.init();
  const reading = c.openFolder({ kind: 'sent' });
  assert.equal(c.getState().folder?.state, 'loading', 'the screen is told at once');
  await reading;
  const v = c.getState().folder!;
  assert.deepEqual([v.state, v.more, v.error, v.partial], ['ready', false, null, []]);
  assert.deepEqual(v.items.map((m) => [m.id, m.to, m.toAddress, m.fk, m.folder]), [['s2', 'Per, Kari', 'per@x.no', 'sent', 'archive'], ['s1', 'Maria Lund', 'maria@x.no', 'sent', 'archive']]);
  assert.equal(c.getState().mail.length, 1, 'the inbox on the phone is not touched');
  assert.equal(c.remoteMail(A, 's1')?.subject, 'Tilbud', 'what was read can be opened in the reader');
});

test('Drafts come in the order they were last changed, and are marked as drafts', async () => {
  const w = outlook();
  w.put(A, 'drafts', { id: 'd1', draft: true, subject: 'Old one', received: '2026-10-01T10:00:00Z', modified: '2026-10-04T10:00:00Z' });
  w.put(A, 'drafts', { id: 'd2', draft: true, subject: 'Newer one', received: '2026-10-03T10:00:00Z', modified: '2026-10-03T11:00:00Z' });
  const { c } = make(w);
  await c.init();
  await c.openFolder({ kind: 'drafts' });
  assert.deepEqual(c.getState().folder!.items.map((m) => [m.id, m.draft, m.fk, m.received]), [['d1', true, 'drafts', '2026-10-04T10:00:00Z'], ['d2', true, 'drafts', '2026-10-03T11:00:00Z']]);
});

test('a long folder is read a page at a time, and "show more" adds the rest without repeating anything', async () => {
  const w = outlook();
  for (let i = 1; i <= 45; i++) w.put(A, 'archive', { id: `a${i}`, received: new Date(Date.UTC(2026, 8, 1, 0, i)).toISOString() });
  const { c } = make(w);
  await c.init();
  await c.openFolder({ kind: 'archive' });
  let v = c.getState().folder!;
  assert.equal(v.items.length, 40);
  assert.equal(v.more, true);
  assert.equal(v.items[0].id, 'a45');
  const more = c.moreInFolder();
  assert.equal(c.getState().folder!.paging, true);
  await more;
  v = c.getState().folder!;
  assert.deepEqual([v.items.length, v.more, v.paging, new Set(v.items.map((m) => m.id)).size], [45, false, false, 45]);
  await c.moreInFolder();
  assert.equal(w.log.filter((l) => l.startsWith('page ID-archive')).length, 2, 'there is no third page to ask for');
});

test('the same folder of two mailboxes is one list, newest first, and one mailbox can be opened alone', async () => {
  const w = outlook([A, W]);
  w.put(A, 'archive', { id: 'a1', received: '2026-10-01T10:00:00Z' }); w.put(W, 'archive', { id: 'w1', received: '2026-10-02T10:00:00Z' }); w.put(A, 'archive', { id: 'a2', received: '2026-10-03T10:00:00Z' });
  const { c } = make(w, { emails: [A, W] });
  await c.init();
  await c.openFolder({ kind: 'archive' });
  assert.deepEqual(c.getState().folder!.items.map((m) => m.id), ['a2', 'w1', 'a1']);
  await c.openFolder({ kind: 'archive', account: W });
  assert.deepEqual(c.getState().folder!.items.map((m) => m.id), ['w1']);
});

test('a folder of your own is opened by its id, in its own mailbox', async () => {
  const w = outlook([A, W]);
  w.folder(W, 'WK', 'Kunder');
  w.put(W, 'WK', { id: 'k1' }); w.put(W, 'inbox', { id: 'w9' });
  const { c } = make(w, { emails: [A, W] });
  await c.init();
  await c.openFolder({ kind: 'other', account: W, id: 'WK' });
  const v = c.getState().folder!;
  assert.deepEqual(v.items.map((m) => [m.id, m.fid, m.fk]), [['k1', 'WK', 'other']]);
});

test('when one mailbox cannot be read the others still show and it is named; when none can, what was shown stays and the problem is said', async () => {
  const w = outlook([A, W]);
  w.put(A, 'archive', { id: 'a1' }); w.put(W, 'archive', { id: 'w1' });
  const { c } = make(w, { emails: [A, W] });
  await c.init();
  await c.openFolder({ kind: 'archive' });
  w.flags.down.add(W);
  await c.openFolder({ kind: 'archive' }, { force: true });
  let v = c.getState().folder!;
  assert.deepEqual([v.items.map((m) => m.id), v.partial, v.state], [['a1'], ['Work'], 'ready']);
  w.flags.down.add(A);
  await c.openFolder({ kind: 'archive' }, { force: true });
  v = c.getState().folder!;
  assert.deepEqual([v.items.map((m) => m.id), v.state], [['a1'], 'ready'], 'what was shown stays');
  assert.match(v.error ?? '', /busy/i);
  await c.openFolder({ kind: 'sent' });
  v = c.getState().folder!;
  assert.deepEqual([v.items.length, v.state], [0, 'failed'], 'nothing to show and nothing could be read');
  w.flags.down.clear();
  await c.refreshFolder();
  assert.deepEqual([c.getState().folder!.state, c.getState().folder!.error], ['ready', null]);
});

test('an answer for a folder that is no longer open is dropped', async () => {
  const w = outlook();
  w.put(A, 'sentitems', { id: 's1' }); w.put(A, 'archive', { id: 'a1' });
  let open!: () => void;
  w.flags.hold = { folder: 'ID-sentitems', until: new Promise<void>((r) => { open = r; }) };
  const { c } = make(w);
  await c.init();
  const first = c.openFolder({ kind: 'sent' });
  await until(() => w.log.includes('page ID-sentitems'), 'the call for Sent to be on its way');
  await c.openFolder({ kind: 'archive' });
  open();
  await first;
  const v = c.getState().folder!;
  assert.deepEqual([v.target.kind, v.items.map((m) => m.id)], ['archive', ['a1']]);
});

test('a folder read a moment ago is not read again when it is opened again, but a refresh always reads it', async () => {
  const w = outlook();
  w.put(A, 'sentitems', { id: 's1' });
  const { c, advance } = make(w);
  await c.init();
  const pages = () => w.log.filter((l) => l === 'page ID-sentitems').length;
  await c.openFolder({ kind: 'sent' }); await c.openFolder({ kind: 'sent' });
  assert.equal(pages(), 1);
  advance(21_000);
  await c.openFolder({ kind: 'sent' });
  assert.equal(pages(), 2);
  await c.refreshFolder();
  assert.equal(pages(), 3);
  c.closeFolder();
  assert.equal(c.getState().folder, null);
});

// ---- moving mail ---------------------------------------------------------------------------------------------------------------------------------

test('moving a message out of a folder: it leaves the list at once, Outlook hears after the undo time, and the folders\' numbers follow', async () => {
  const w = outlook(); w.folder(A, 'K', 'Kunder');
  w.put(A, 'archive', { id: 'x1', subject: 'Tilbud', isRead: false }); w.put(A, 'archive', { id: 'x2' });
  const made = make(w); const { c } = made;
  await c.init(); await c.loadFolders(); await c.openFolder({ kind: 'archive' });
  const unread = (kind: string) => c.getState().folders.find((f) => f.kind === kind)!.unread;
  assert.equal(unread('archive'), 1);
  await c.moveTo([c.getState().folder!.items.find((x) => x.id === 'x1')!], { to: 'K', name: 'Kunder' });
  assert.deepEqual(c.getState().folder!.items.map((x) => x.id), ['x2']);
  assert.equal(c.getState().toast!.text, 'Moved to Kunder');
  assert.equal(unread('archive'), 0, 'the number follows at once');
  assert.equal(w.log.some((l) => l.startsWith('move')), false, 'Outlook has not heard yet');
  await settle(made);
  assert.ok(w.log.includes('move x1 K'));
  assert.deepEqual(w.ids(A, 'K'), ['x1~']);
  await until(() => c.getState().folders.find((f) => f.name === 'Kunder')?.total === 1, 'the folders to be counted again');
  assert.equal(c.getState().folders.find((f) => f.name === 'Kunder')!.unread, 1);
});

test('Undo puts the message back in its list with its unread number, and Outlook never hears of it', async () => {
  const w = outlook(); w.folder(A, 'K', 'Kunder');
  w.put(A, 'archive', { id: 'x1', isRead: false });
  const made = make(w); const { c } = made;
  await c.init(); await c.loadFolders(); await c.openFolder({ kind: 'archive' });
  await c.moveTo([c.getState().folder!.items[0]], { to: 'K', name: 'Kunder' });
  c.getState().toast!.undo!();
  await until(() => c.getState().folder!.items.length === 1, 'the message to come back');
  assert.equal(c.getState().folders.find((f) => f.kind === 'archive')!.unread, 1);
  await settle(made);
  assert.equal(w.log.some((l) => l.startsWith('move')), false);
  assert.deepEqual(w.ids(A, 'archive'), ['x1']);
});

test('mail moved to the inbox from a folder shows up in the inbox once Outlook has moved it', async () => {
  const w = outlook();
  w.put(A, 'deleteditems', { id: 'x1', subject: 'Slettet ved en feil' });
  const made = make(w); const { c } = made;
  await c.init(); await c.openFolder({ kind: 'deleted' });
  await c.moveTo([c.getState().folder!.items[0]], { to: 'inbox', name: 'Inbox' });
  assert.equal(c.getState().mail.length, 0);
  await settle(made);
  assert.ok(w.log.includes('move x1 inbox'));
  await until(() => c.getState().mail.some((m) => m.id === 'x1~'), 'the inbox to read it');
  assert.equal(c.getState().mail.find((m) => m.id === 'x1~')!.folder, 'inbox');
});

test('mail from the inbox goes to a folder of your own with one Undo, and is gone from the inbox at once', async () => {
  const w = outlook(); w.folder(A, 'K', 'Kunder');
  w.put(A, 'inbox', { id: 'i1', subject: 'Faktura' }); w.put(A, 'inbox', { id: 'i2', subject: 'Annet' });
  const made = make(w); const { c } = made;
  await c.init();
  await c.moveTo([c.getState().mail.find((m) => m.id === 'i1')!], { to: 'K', name: 'Kunder' });
  assert.deepEqual(c.getState().mail.map((m) => m.id), ['i2']);
  c.getState().toast!.undo!();
  await until(() => c.getState().mail.length === 2, 'Undo');
  await settle(made);
  assert.equal(w.log.some((l) => l.startsWith('move')), false);
  await c.moveTo([c.getState().mail.find((m) => m.id === 'i1')!], { to: 'K', name: 'Kunder' });
  await settle(made);
  assert.ok(w.log.includes('move i1 K'));
  assert.deepEqual(w.ids(A, 'K'), ['i1~']);
  assert.deepEqual(c.getState().mail.map((m) => m.id), ['i2']);
});

test('a conversation is moved as one: every message of it that was moved, and one toast for the rows', async () => {
  const w = outlook(); w.folder(A, 'K', 'Kunder');
  w.put(A, 'archive', { id: 'x1', conversationId: 'cc' }); w.put(A, 'archive', { id: 'x2', conversationId: 'cc' }); w.put(A, 'archive', { id: 'x3' });
  const made = make(w); const { c } = made;
  await c.init(); await c.openFolder({ kind: 'archive' });
  const items = c.getState().folder!.items;
  await c.moveTo(items, { to: 'K', name: 'Kunder' }, 2);
  assert.equal(c.getState().toast!.text, 'Moved 2 to Kunder');
  await settle(made);
  assert.deepEqual(w.ids(A, 'K'), ['x1~', 'x2~', 'x3~']);
});

test('mail in Sent can be archived or deleted like any other mail', async () => {
  const w = outlook();
  w.put(A, 'sentitems', { id: 's1', received: '2026-10-02T10:00:00Z' }); w.put(A, 'sentitems', { id: 's2', received: '2026-10-03T10:00:00Z' });
  const made = make(w); const { c } = made;
  await c.init(); await c.openFolder({ kind: 'sent' });
  const [newest, older] = c.getState().folder!.items;
  await c.archive([older]);
  assert.equal(c.getState().toast!.text, 'Archived');
  await c.trash([newest]);
  assert.equal(c.getState().toast!.text, 'Deleted');
  assert.deepEqual(c.getState().folder!.items, []);
  await settle(made);
  assert.deepEqual([w.ids(A, 'archive'), w.ids(A, 'deleteditems'), w.ids(A, 'sentitems')], [['s1~'], ['s2~'], []]);
});

test('mail that is waiting to be moved does not show in a folder list, even while Outlook still lists it there', async () => {
  const w = outlook(); w.folder(A, 'K', 'Kunder');
  w.put(A, 'archive', { id: 'x1' }); w.put(A, 'archive', { id: 'x2' });
  const { c } = make(w);
  await c.init(); await c.openFolder({ kind: 'archive' });
  await c.moveTo([c.getState().folder!.items.find((x) => x.id === 'x1')!], { to: 'K', name: 'Kunder' });
  await c.refreshFolder();
  assert.deepEqual(c.getState().folder!.items.map((x) => x.id), ['x2']);
});

test('when Outlook will not move a message it stays where it was, the folder is read again, and Post says so', async () => {
  const w = outlook(); w.folder(A, 'K', 'Kunder');
  w.put(A, 'archive', { id: 'x1' });
  const made = make(w); const { c } = made;
  await c.init(); await c.openFolder({ kind: 'archive' });
  await c.moveTo([c.getState().folder!.items[0]], { to: 'K', name: 'Kunder' });
  w.flags.moveStatus = 403;
  made.advance(7_000);
  await c.sync(); await c.sync(); await c.sync(); // refused three times: that will not change
  assert.match(c.getState().toast!.text, /Outlook would not move a message, so it stays where it was/);
  await until(() => c.getState().folder!.items.some((x) => x.id === 'x1'), 'the folder to be read again');
  assert.equal(c.getState().waiting, 0);
});

test('a move to a folder that was deleted meanwhile is refused at once and the message stays where it was', async () => {
  const w = outlook(); w.folder(A, 'K', 'Kunder');
  w.put(A, 'archive', { id: 'x1' });
  const made = make(w); const { c } = made;
  await c.init(); await c.loadFolders(); await c.openFolder({ kind: 'archive' });
  await c.moveTo([c.getState().folder!.items[0]], { to: 'K', name: 'Kunder' });
  w.dropFolder(A, 'K'); // somebody deletes the folder in Outlook before the move is carried out
  made.advance(7_000);
  await c.sync(); // one go is enough: a folder that is gone will not come back
  assert.match(c.getState().toast!.text, /Outlook would not move a message, so it stays where it was/);
  await until(() => c.getState().folder!.items.some((x) => x.id === 'x1'), 'the folder to be read again');
  assert.deepEqual(w.ids(A, 'archive'), ['x1']);
  assert.equal(c.getState().waiting, 0);
});

test('a move to a folder that Outlook answers "item not found" for is still a refused move when the message is there: it stays where it was', async () => {
  const w = outlook(); w.folder(A, 'K', 'Kunder');
  w.flags.missingFolder = 'ErrorItemNotFound';
  w.put(A, 'archive', { id: 'x1' });
  const made = make(w); const { c } = made;
  await c.init(); await c.loadFolders(); await c.openFolder({ kind: 'archive' });
  await c.moveTo([c.getState().folder!.items[0]], { to: 'K', name: 'Kunder' });
  w.dropFolder(A, 'K');
  made.advance(7_000);
  await c.sync();
  assert.match(c.getState().toast!.text, /Outlook would not move a message, so it stays where it was/, 'the person is told');
  await until(() => c.getState().folder!.items.some((x) => x.id === 'x1'), 'the folder to be read again');
  assert.deepEqual(w.ids(A, 'archive'), ['x1']);
  assert.equal(c.getState().waiting, 0);
});

test('when Outlook will not archive mail that was in a folder, Post says it stays there; mail from the inbox comes back to the inbox', async () => {
  const w = outlook();
  w.put(A, 'sentitems', { id: 's1', to: [MARIA] }); w.put(A, 'inbox', { id: 'i1' });
  const made = make(w); const { c } = made;
  await c.init(); await c.openFolder({ kind: 'sent' });
  await c.archive([c.getState().folder!.items[0]]);
  w.flags.moveStatus = 403;
  made.advance(7_000);
  await c.sync(); await c.sync(); await c.sync();
  assert.match(c.getState().toast!.text, /Outlook would not archive a message, so it stays where it was\./);
  assert.doesNotMatch(c.getState().toast!.text, /inbox/);
  await c.archive([c.getState().mail.find((m) => m.id === 'i1')!]);
  made.advance(7_000);
  await c.sync(); await c.sync(); await c.sync();
  assert.match(c.getState().toast!.text, /Outlook would not archive a message, so it comes back to your inbox\./);
});

test('archiving or deleting from the inbox does not read the whole list of folders again each time, but moving mail to a folder of your own does', async () => {
  const w = outlook(); w.folder(A, 'K', 'Kunder');
  for (const id of ['i1', 'i2', 'i3', 'i4']) w.put(A, 'inbox', { id, isRead: false });
  const made = make(w); const { c } = made;
  await c.init(); await c.loadFolders();
  const reads = () => w.log.filter((l) => l === 'folders').length;
  assert.equal(reads(), 1);
  const mail = (id: string) => c.getState().mail.find((m) => m.id === id)!;
  await c.archive([mail('i1')]); await settle(made);
  await c.trash([mail('i2')]); await settle(made); await tick(50);
  assert.equal(reads(), 1, 'the list was read a moment ago: it is not read again after each one');
  made.advance(60_000);
  await c.archive([mail('i3')]); await settle(made);
  await until(() => reads() === 2, 'the list of folders to be read again once it is old');
  await c.moveTo([mail('i4')], { to: 'K', name: 'Kunder' }); await settle(made);
  await until(() => reads() === 3, 'mail moved into a folder of your own to be counted at once, however new the list is');
  assert.equal(c.getState().folders.find((f) => f.name === 'Kunder')!.unread, 1);
});

// ---- reading and flagging mail that is not in the inbox ------------------------------------------------------------------------------------------

test('reading and flagging mail in a folder changes the copy on screen, reaches Outlook at once, and keeps the folder\'s unread number right', async () => {
  const w = outlook();
  w.put(A, 'archive', { id: 'x1', isRead: false }); w.put(A, 'archive', { id: 'x2', isRead: false });
  const { c } = make(w);
  await c.init(); await c.loadFolders(); await c.openFolder({ kind: 'archive' });
  const item = (id: string) => c.getState().folder!.items.find((m) => m.id === id)!;
  const unread = () => c.getState().folders.find((f) => f.kind === 'archive')!.unread;
  assert.equal(unread(), 2);
  await c.setRead(item('x1'), true);
  assert.deepEqual([item('x1').isRead, unread()], [true, 1]);
  assert.equal(c.remoteMail(A, 'x1')!.isRead, true, 'the reader sees the same');
  await until(() => w.log.some((l) => l.startsWith('patch x1') && l.includes('"isRead":true')), 'Outlook to hear');
  await c.markRead([item('x2'), item('x1')], { quiet: true });
  assert.equal(unread(), 0);
  await c.setRead(item('x1'), false);
  assert.deepEqual([item('x1').isRead, unread()], [false, 1]);
  await c.setFlags([item('x2')], true);
  assert.equal(item('x2').flagged, true);
  await until(() => w.log.some((l) => l.startsWith('patch x2') && l.includes('flagged')), 'Outlook to hear of the flag');
  assert.equal(w.get(A, 'x2')!.flagged, true);
  assert.equal(w.get(A, 'x2')!.isRead, true);
});

test('reading something Post has not seen (or that is gone from the folder) changes nothing', async () => {
  const w = outlook();
  w.put(A, 'archive', { id: 'x1', isRead: false });
  const { c } = make(w);
  await c.init(); await c.openFolder({ kind: 'archive' });
  const ghost = { ...c.getState().folder!.items[0], key: `${A}|nope`, id: 'nope' };
  await c.setRead(ghost, true);
  await c.markRead([ghost], { quiet: true });
  await c.setFlags([ghost], true);
  assert.equal(w.log.some((l) => l.startsWith('patch nope')), false);
  assert.equal(c.getState().folder!.items[0].isRead, false);
});

// ---- finding a message ---------------------------------------------------------------------------------------------------------------------------

test('a message that is not in the inbox is found at Outlook by its id, and knows its folder once the folders are listed', async () => {
  const w = outlook();
  w.put(A, 'archive', { id: 'z1', subject: 'Gammel' }); w.put(A, 'sentitems', { id: 'z2', subject: 'Sendt' }); w.put(A, 'inbox', { id: 'i1' });
  const { c } = make(w);
  await c.init();
  const stored = await c.findMail(A, 'i1');
  assert.equal(stored?.folder, 'inbox', 'the inbox on the phone answers without asking Outlook');
  assert.equal(w.log.includes('get i1'), false);
  const first = await c.findMail(A, 'z1');
  assert.deepEqual([first?.subject, first?.fid, first?.fk], ['Gammel', 'ID-archive', undefined]);
  await c.loadFolders();
  const second = await c.findMail(A, 'z2');
  assert.deepEqual([second?.fid, second?.fk], ['ID-sentitems', 'sent']);
  assert.equal(c.folderOf(first!)?.name, 'Archive', 'a message that was found before the folders were listed still learns its folder from them');
  assert.equal(await c.findMail(A, 'nothing'), null);
  assert.equal((await c.findMail(A, 'z1'))?.subject, 'Gammel');
  assert.equal(w.log.filter((l) => l === 'get z1').length, 1, 'asked for once');
});

test('search results from Outlook know their folder, and one from Sent says who it went to', async () => {
  const w = outlook();
  w.put(A, 'sentitems', { id: 's1', subject: 'Faktura sendt', to: [MARIA] }); w.put(A, 'archive', { id: 'a1', subject: 'Faktura gammel' }); w.put(A, 'inbox', { id: 'i1', subject: 'Faktura ny' });
  const { c } = make(w);
  await c.init();
  const found = await c.searchRemote('faktura');
  const by = Object.fromEntries(found.map((m) => [m.id, m]));
  assert.deepEqual(Object.keys(by).sort(), ['a1', 's1'], 'what is in the inbox on the phone is not listed twice');
  assert.deepEqual([by.s1.fk, by.s1.to, by.a1.fk, by.a1.to], ['sent', 'Maria Lund', 'archive', undefined]);
  assert.ok(c.getState().folders.length > 0, 'the folders were listed alongside');
});

// ---- drafts ---------------------------------------------------------------------------------------------------------------------------------------

const D1 = { account: A, id: 'd1' };
const DRAFT = { id: 'd1', draft: true, subject: 'Tilbud', body: 'Hei Maria\n\nHer er tilbudet.', to: [MARIA], cc: [{ name: 'Kari', address: 'kari@x.no' }], bcc: [{ name: 'Meg', address: 'meg@x.no' }], attachments: [{ name: 'tilbud.pdf', size: 1200 }] };

test('a draft is opened with its text, who it is for and the files already on it; one that has gone out is refused', async () => {
  const w = outlook();
  w.put(A, 'drafts', DRAFT); w.put(A, 'sentitems', { id: 's9', subject: 'Gone' });
  const { c } = make(w);
  await c.init();
  const d = await c.openDraft(A, 'd1');
  assert.deepEqual(d.content, { subject: 'Tilbud', body: 'Hei Maria\n\nHer er tilbudet.', to: ['maria@x.no'], cc: ['kari@x.no'], bcc: ['meg@x.no'], isDraft: true, modified: '2026-10-01T10:00:00Z' });
  assert.deepEqual(d.files.map((x) => [x.name, x.size, x.kind]), [['tilbud.pdf', 1200, 'file']]);
  await assert.rejects(c.openDraft(A, 's9'), /already been sent/);
  await assert.rejects(c.openDraft(A, 'missing'), /not in Outlook any more/);
});

test('saving a draft changes it at Outlook (text and who it is for, never its Bcc or files) and the list shows the change', async () => {
  const w = outlook();
  w.put(A, 'drafts', DRAFT);
  const { c } = make(w);
  await c.init(); await c.openFolder({ kind: 'drafts' });
  await c.saveDraftEdits(A, 'd1', { subject: 'Tilbud 2', body: 'Ny tekst', to: ['maria@x.no', 'per@x.no'], cc: [] });
  const stored = w.get(A, 'd1')!;
  assert.deepEqual([stored.subject, stored.body, stored.to!.map((p) => p.address), stored.cc!.map((p) => p.address), stored.bcc!.map((p) => p.address), stored.attachments!.length], ['Tilbud 2', 'Ny tekst', ['maria@x.no', 'per@x.no'], [], ['meg@x.no'], 1]);
  const row = c.getState().folder!.items[0];
  assert.deepEqual([row.subject, row.preview, row.toAddress], ['Tilbud 2', 'Ny tekst', 'maria@x.no']);
  c.getState().folder!.at && assert.equal(c.getState().folder!.at, 0, 'the list is read again the next time it is opened');
  w.flags.patchStatus = 403;
  await assert.rejects(c.saveDraftEdits(A, 'd1', { subject: 'X', body: 'Y', to: [], cc: [] }), /Access is denied/);
  assert.equal(w.get(A, 'd1')!.subject, 'Tilbud 2', 'a refusal changes nothing, and the editor keeps what was typed');
});

test('a draft is edited at Outlook and sent from there: its text replaced, only the new files added, and it goes once', async () => {
  const w = outlook();
  w.put(A, 'drafts', DRAFT);
  const made = make(w); const { c } = made;
  await c.init(); c.setSettings({ undoSend: 0 }); await c.openFolder({ kind: 'drafts' });
  const ok = await c.send({ account: A, kind: 'draft', to: ['maria@x.no'], cc: [], subject: 'Tilbud (endret)', body: 'ny tekst', replyTo: 'd1' }, [
    { name: 'tilbud.pdf', type: 'application/pdf', bytes: new Uint8Array(1200) }, // already on the draft
    { name: 'ekstra.txt', type: 'text/plain', bytes: new TextEncoder().encode('hello') },
  ]);
  assert.equal(ok, true);
  assert.deepEqual(c.getState().folder!.items, [], 'a draft that is on its way is not a draft to open');
  await c.flushOutbox();
  const sent = w.get(A, 'd1~')!;
  assert.deepEqual([sent.folder, sent.draft, sent.subject, sent.body], ['ID-sentitems', false, 'Tilbud (endret)', 'ny tekst']);
  assert.deepEqual(sent.attachments!.map((a) => a.name), ['tilbud.pdf', 'ekstra.txt'], 'the file already there is not added twice');
  assert.deepEqual(sent.bcc!.map((p) => p.address), ['meg@x.no'], 'Bcc stays on the draft');
  assert.equal(w.log.filter((l) => l === 'send d1').length, 1);
  assert.equal(w.log.some((l) => l.startsWith('delete')), false);
  assert.equal((await waiting(made)).length, 0);
  await c.openFolder({ kind: 'drafts' }, { force: true });
  assert.deepEqual(c.getState().folder!.items, []);
});

test('a draft whose "send" lost its answer on the way back is not sent again', async () => {
  const w = outlook();
  w.put(A, 'drafts', DRAFT);
  const made = make(w); const { c } = made;
  await c.init(); c.setSettings({ undoSend: 0 });
  w.flags.loseAfter.push('send');
  await c.send({ account: A, kind: 'draft', to: ['maria@x.no'], cc: [], subject: 'Tilbud', body: 'tekst', replyTo: 'd1' });
  await c.flushOutbox();
  assert.equal((await waiting(made)).length, 1, 'not known to have gone');
  await c.flushOutbox();
  assert.equal(w.log.filter((l) => l === 'send d1').length, 1);
  assert.equal((await waiting(made)).length, 0);
  assert.deepEqual(w.ids(A, 'sentitems'), ['d1~']);
});

test('a draft Outlook refuses to send stays a draft at Outlook, and what was typed comes back to the editor as that draft', async () => {
  const w = outlook();
  w.put(A, 'drafts', DRAFT);
  const made = make(w); const { c } = made;
  await c.init(); c.setSettings({ undoSend: 0 });
  w.flags.sendStatus = 400;
  await c.send({ account: A, kind: 'draft', to: ['maria@x.no'], cc: [], subject: 'Tilbud', body: 'ny tekst', replyTo: 'd1' });
  await c.flushOutbox();
  assert.equal((await waiting(made)).length, 0);
  assert.ok(w.get(A, 'd1'), 'the draft is still at Outlook');
  assert.equal(w.log.some((l) => l.startsWith('delete')), false, 'a draft that is the person\'s own is never thrown away');
  const saved = c.loadDraft(D1);
  assert.deepEqual([saved?.mode, saved?.replyTo, saved?.body], ['draft', 'd1', 'ny tekst']);
  assert.equal(c.loadDraft(), null, 'it comes back to the draft\'s own place, not to the message being written');
  assert.match(c.getState().toast!.text, /Could not send/);
});

test('Undo while a draft waits brings it back: it is a draft again, and what was typed is kept for the editor', async () => {
  const w = outlook();
  w.put(A, 'drafts', DRAFT);
  const made = make(w); const { c } = made;
  await c.init();
  await c.send({ account: A, kind: 'draft', to: ['maria@x.no'], cc: [], subject: 'Tilbud', body: 'ny tekst', replyTo: 'd1' });
  await c.openFolder({ kind: 'drafts' });
  assert.deepEqual(c.getState().folder!.items, [], 'waiting to be sent: not listed');
  await c.cancelSend(c.getState().outbox[0].id);
  assert.equal((await waiting(made)).length, 0);
  assert.deepEqual([c.loadDraft(D1)?.mode, c.loadDraft(D1)?.replyTo, c.loadDraft(D1)?.body], ['draft', 'd1', 'ny tekst']);
  assert.equal(c.loadDraft(), null, 'and the message being written is not touched');
  await c.openFolder({ kind: 'drafts' });
  assert.deepEqual(c.getState().folder!.items.map((m) => m.id), ['d1']);
  assert.equal(w.log.some((l) => l === 'send d1'), false);
});

test('what comes back from a send that was undone or refused remembers when Outlook last changed the draft, but a draft that is gone does not', async () => {
  const w = outlook();
  w.put(A, 'drafts', DRAFT);
  const made = make(w); const { c } = made;
  await c.init();
  const read = (await c.openDraft(A, 'd1')).content.modified;
  assert.ok(read, 'Outlook says when the draft was last changed');
  const out = { account: A, kind: 'draft' as const, to: ['maria@x.no'], cc: [], subject: 'Tilbud', body: 'ny tekst', replyTo: 'd1', modified: read };
  await c.send(out);
  await c.cancelSend(c.getState().outbox[0].id);
  assert.equal(c.loadDraft(D1)?.modified, read, 'after Undo, so a change made at Outlook since is noticed when the draft is opened again');
  c.saveDraft(null, D1);
  c.setSettings({ undoSend: 0 });
  w.flags.sendStatus = 400;
  await c.send(out);
  await c.flushOutbox();
  assert.equal(c.loadDraft(D1)?.modified, read, 'after a send that Outlook refused');
  w.flags.sendStatus = 202;
  c.saveDraft(null, D1);
  w.drop(A, 'd1');
  await c.send(out);
  await c.flushOutbox();
  const own = c.loadDraft();
  assert.deepEqual([own?.mode, own?.modified], ['new', undefined], 'a message of its own has no draft at Outlook to be compared with');
  assert.equal('modified' in JSON.parse(JSON.stringify(own)), false);
});

test('with the Drafts list open, Undo lists the draft again at once, and so does a send that Outlook refuses', async () => {
  const w = outlook();
  w.put(A, 'drafts', DRAFT);
  const made = make(w); const { c } = made;
  await c.init(); await c.openFolder({ kind: 'drafts' });
  const out = { account: A, kind: 'draft' as const, to: ['maria@x.no'], cc: [], subject: 'Tilbud', body: 'ny tekst', replyTo: 'd1' };
  await c.send(out);
  assert.deepEqual(c.getState().folder!.items, [], 'waiting to be sent: not listed');
  await c.cancelSend(c.getState().outbox[0].id);
  assert.deepEqual(c.getState().folder!.items.map((m) => m.id), ['d1'], 'listed again the moment Undo is used, without asking Outlook');
  c.setSettings({ undoSend: 0 });
  w.flags.sendStatus = 400;
  await c.send(out);
  assert.deepEqual(c.getState().folder!.items, [], 'on its way again');
  await c.flushOutbox();
  assert.deepEqual(c.getState().folder!.items.map((m) => m.id), ['d1'], 'a draft that Outlook refused to send is listed again');
});

test('sending a draft does not throw away a different message that is half written, but sending that message does', async () => {
  const w = outlook();
  w.put(A, 'drafts', DRAFT);
  const { c } = make(w);
  await c.init(); c.setSettings({ undoSend: 0 });
  const half = { account: A, to: 'x@y.no', cc: '', subject: 'halv', body: 'halvferdig', mode: 'new' as const };
  c.saveDraft(half);
  c.saveDraft({ ...half, subject: 'endret', mode: 'draft', replyTo: 'd1' }, D1);
  await c.send({ account: A, kind: 'draft', to: ['maria@x.no'], cc: [], subject: 'Tilbud', body: 'tekst', replyTo: 'd1' });
  assert.equal(c.loadDraft()?.subject, 'halv', 'the message being written stays');
  assert.equal(c.loadDraft(D1), null, 'what was kept for the draft that went goes with it');
  await c.send({ account: A, kind: 'new', to: ['x@y.no'], cc: [], subject: 'halv', body: 'halvferdig' });
  assert.equal(c.loadDraft(), null, 'sending that message clears it');
});

test('what is kept for a draft at Outlook and the message being written never touch each other, files included', async () => {
  const w = outlook();
  w.put(A, 'drafts', DRAFT); w.put(A, 'drafts', { ...DRAFT, id: 'd2', subject: 'Annen' });
  const { c } = make(w);
  await c.init();
  const file = (name: string, n: number) => ({ name, type: 'application/pdf', bytes: new Uint8Array(n) });
  const D2 = { account: A, id: 'd2' };
  const mine = { account: A, to: 'x@y.no', cc: '', subject: 'halv', body: 'halvferdig', mode: 'new' as const };
  c.saveDraft(mine); await c.saveDraftFiles([file('ny.pdf', 10)]);
  // opening a draft and changing it leaves the half-written message, and its file, as they were
  c.saveDraft({ account: A, to: 'maria@x.no', cc: '', subject: 'Tilbud 2', body: 'endret', replyTo: 'd1', mode: 'draft' }, D1);
  await c.saveDraftFiles([file('d1.pdf', 20)], D1);
  c.saveDraft({ account: A, to: 'maria@x.no', cc: '', subject: 'Annen 2', body: 'endret', replyTo: 'd2', mode: 'draft' }, D2);
  assert.equal(c.loadDraft()?.subject, 'halv');
  assert.deepEqual((await c.loadDraftFiles()).map((f) => f.name), ['ny.pdf']);
  assert.deepEqual([c.loadDraft(D1)?.subject, c.loadDraft(D2)?.subject], ['Tilbud 2', 'Annen 2'], 'each draft has its own');
  assert.deepEqual((await c.loadDraftFiles(D1)).map((f) => f.name), ['d1.pdf']);
  assert.deepEqual(await c.loadDraftFiles(D2), [], 'a draft that was given no files has none');
  // and the other way round: writing, or giving up on, the message being written leaves the drafts' changes
  c.saveDraft(null);
  assert.equal(c.loadDraft(), null);
  assert.deepEqual(await c.loadDraftFiles(), [], 'its file went with it');
  assert.deepEqual([c.loadDraft(D1)?.subject, c.loadDraft(D2)?.subject], ['Tilbud 2', 'Annen 2']);
  assert.deepEqual((await c.loadDraftFiles(D1)).map((f) => f.name), ['d1.pdf'], 'and so did not the draft\'s file');
  // giving up on one draft's changes leaves the other's
  c.saveDraft(null, D1); await tick(20);
  assert.equal(c.loadDraft(D1), null);
  assert.deepEqual(await c.loadDraftFiles(D1), []);
  assert.equal(c.loadDraft(D2)?.subject, 'Annen 2');
  assert.equal(c.loadDraft({ account: W, id: 'd2' }), null, 'the same id in another mailbox is another draft');
});

test('changes kept for a draft are let go of when its mailbox is removed, and when nobody has opened the draft for a month', async () => {
  const w = outlook([A, W]);
  const kv = new Map<string, string>([['post.sessions', JSON.stringify([A, W].map((e, i) => ({ email: e, id: String(i + 1), label: e === A ? 'Personal' : 'Work', session: `${i + 1}.s-${e}` })))]]);
  const store = memoryStore();
  const first = make(w, { emails: [A, W], store, kv });
  await first.c.init();
  const file = [{ name: 'a.pdf', type: 'application/pdf', bytes: new Uint8Array(5) }];
  const edit = (account: string, id: string) => ({ account, to: 'x@y.no', cc: '', subject: `endret ${id}`, body: 't', replyTo: id, mode: 'draft' as const });
  first.c.saveDraft(edit(A, 'old'), { account: A, id: 'old' }); await first.c.saveDraftFiles(file, { account: A, id: 'old' });
  first.advance(20 * 24 * 3600 * 1000);
  first.c.saveDraft(edit(A, 'new'), { account: A, id: 'new' });
  first.c.saveDraft(edit(W, 'w1'), { account: W, id: 'w1' }); await first.c.saveDraftFiles(file, { account: W, id: 'w1' });
  // a start 20 days later: the first is 40 days old, the others 20 days or less
  const later = make(w, { emails: [A, W], store, kv, at: Date.parse('2026-10-05T10:00:00Z') + 40 * 24 * 3600 * 1000 });
  await later.c.init(); await tick(20);
  assert.equal(later.c.loadDraft({ account: A, id: 'old' }), null, 'a month old: let go of');
  assert.deepEqual(await later.c.loadDraftFiles({ account: A, id: 'old' }), [], 'with its files');
  assert.equal(later.c.loadDraft({ account: A, id: 'new' })?.subject, 'endret new', 'a recent one stays');
  await later.c.removeAccount(W);
  assert.equal(later.c.loadDraft({ account: W, id: 'w1' }), null, 'a removed mailbox takes what was kept for its drafts');
  assert.deepEqual(await later.c.loadDraftFiles({ account: W, id: 'w1' }), [], 'and their files');
  assert.equal(later.c.loadDraft({ account: A, id: 'new' })?.subject, 'endret new', 'the other mailbox keeps its own');
});

test('a draft that is not at Outlook any more when it is sent is not lost: its text comes back as a message of its own, and is not listed as a draft', async () => {
  const w = outlook();
  w.put(A, 'drafts', DRAFT);
  const made = make(w); const { c } = made;
  await c.init(); c.setSettings({ undoSend: 0 }); await c.openFolder({ kind: 'drafts' });
  await c.send({ account: A, kind: 'draft', to: ['maria@x.no'], cc: [], subject: 'Tilbud', body: 'ny tekst', replyTo: 'd1' }, [{ name: 'a.pdf', type: 'application/pdf', bytes: new Uint8Array(30) }]);
  w.drop(A, 'd1'); // sent or deleted in another app meanwhile
  await c.flushOutbox();
  assert.equal((await waiting(made)).length, 0);
  const back = c.loadDraft();
  assert.deepEqual([back?.mode, back?.replyTo, back?.subject, back?.body, back?.to], ['new', undefined, 'Tilbud', 'ny tekst', 'maria@x.no'], 'handed back as a new message');
  assert.deepEqual((await c.loadDraftFiles()).map((f) => f.name), ['a.pdf'], 'with its file');
  assert.equal(c.loadDraft(D1), null, 'nothing is kept for a draft that cannot be opened');
  assert.deepEqual(c.getState().folder!.items, [], 'and the Drafts list has no row that cannot be opened');
  assert.match(c.getState().toast!.text, /no longer in Outlook/);
  assert.equal(w.log.some((l) => l.startsWith('delete')), false);
});

test('only what was changed in a draft is written back: a text left alone is not replaced by the plain text it was read as', async () => {
  const w = outlook();
  w.put(A, 'drafts', { ...DRAFT, body: 'plain text of a formatted draft' });
  const made = make(w); const { c } = made;
  await c.init(); c.setSettings({ undoSend: 0 });
  // sent without a change: nothing is written to the draft before it goes
  await c.send({ account: A, kind: 'draft', to: ['maria@x.no'], cc: ['kari@x.no'], subject: 'Tilbud', body: 'plain text of a formatted draft', replyTo: 'd1', edited: [] });
  await c.flushOutbox();
  assert.equal(w.log.some((l) => l.startsWith('patch')), false, 'no change, no write');
  assert.equal(w.log.filter((l) => l === 'send d1').length, 1);
  assert.equal(w.get(A, 'd1~')!.body, 'plain text of a formatted draft');
  // only the subject was changed: only the subject is written
  w.put(A, 'drafts', { ...DRAFT, id: 'd3' });
  await c.send({ account: A, kind: 'draft', to: ['maria@x.no'], cc: ['kari@x.no'], subject: 'Nytt emne', body: 'plain text', replyTo: 'd3', edited: ['subject'] });
  await c.flushOutbox();
  const patch = w.log.filter((l) => l.startsWith('patch d3'));
  assert.deepEqual(patch, ['patch d3 {"subject":"Nytt emne"}'], 'the subject and nothing else');
  assert.equal(w.get(A, 'd3~')!.body, DRAFT.body, 'the text of the draft is as it was');
  assert.deepEqual(w.get(A, 'd3~')!.to!.map((p) => p.name), ['Maria Lund'], 'and so is the name that went with the address');
  // an outbox item from before this was told (no `edited`) writes everything, as it always did
  w.put(A, 'drafts', { ...DRAFT, id: 'd4' });
  await c.send({ account: A, kind: 'draft', to: ['maria@x.no'], cc: [], subject: 'S', body: 'B', replyTo: 'd4' });
  await c.flushOutbox();
  assert.equal(w.log.filter((l) => l.startsWith('patch d4'))[0], 'patch d4 {"subject":"S","body":{"contentType":"Text","content":"B"},"toRecipients":[{"emailAddress":{"address":"maria@x.no"}}],"ccRecipients":[]}');
});

test('saving a draft puts the files that were added on it too, once however often it is tried, and only what was changed is written', async () => {
  const w = outlook();
  w.put(A, 'drafts', DRAFT);
  const { c } = make(w);
  await c.init();
  const file = (name: string, n: number) => ({ name, type: 'application/pdf', bytes: new Uint8Array(n) });
  await c.saveDraftEdits(A, 'd1', { subject: 'Tilbud', body: 'x', to: ['maria@x.no'], cc: ['kari@x.no'], edited: [] }, [file('tilbud.pdf', 1200), file('ny.pdf', 50)]);
  assert.deepEqual(w.get(A, 'd1')!.attachments!.map((a) => a.name), ['tilbud.pdf', 'ny.pdf'], 'the one that was there is not added again');
  assert.equal(w.log.some((l) => l.startsWith('patch')), false, 'nothing was changed in the text, so nothing is written to it');
  await c.saveDraftEdits(A, 'd1', { subject: 'Tilbud', body: 'x', to: ['maria@x.no'], cc: [], edited: ['cc'] }, [file('ny.pdf', 50)]);
  assert.equal(w.get(A, 'd1')!.attachments!.length, 2, 'trying again never adds a file twice');
  assert.deepEqual(w.log.filter((l) => l.startsWith('patch')), ['patch d1 {"ccRecipients":[]}']);
  w.drop(A, 'd1');
  await assert.rejects(c.saveDraftEdits(A, 'd1', { subject: 'X', body: 'Y', to: [], cc: [] }), /no longer in Outlook/);
});

test('a draft says when Outlook last changed it, and that moves on when the draft is saved', async () => {
  const w = outlook();
  w.put(A, 'drafts', DRAFT);
  const { c } = make(w);
  await c.init();
  const before = (await c.openDraft(A, 'd1')).content.modified;
  await c.saveDraftEdits(A, 'd1', { subject: 'Nytt', body: 'x', to: ['maria@x.no'], cc: [], edited: ['subject'] });
  const after = (await c.openDraft(A, 'd1')).content.modified;
  assert.ok(before && after && after > before, `${before} -> ${after}`);
});

// ---- mailboxes -----------------------------------------------------------------------------------------------------------------------------------

test('removing a mailbox takes its folders, and the mail seen in them, off the screen', async () => {
  const w = outlook([A, W]);
  w.folder(W, 'WK', 'Tilbud');
  w.put(A, 'archive', { id: 'a1' }); w.put(W, 'archive', { id: 'w1' });
  const { c } = make(w, { emails: [A, W] });
  await c.init(); await c.loadFolders(); await c.openFolder({ kind: 'archive' });
  assert.equal(c.getState().folder!.items.length, 2);
  await c.removeAccount(W);
  const s = c.getState();
  assert.deepEqual(s.folders.map((f) => f.account).filter((a) => a === W), []);
  assert.deepEqual(s.folder!.items.map((m) => m.id), ['a1']);
  assert.equal(c.remoteMail(W, 'w1'), undefined);
  await c.openFolder({ kind: 'archive', account: A });
  await c.removeAccount(A);
  assert.equal(c.getState().folder, null, 'the folder of a mailbox that is gone is closed');
});

test('signing out of everything forgets the folders', async () => {
  const w = outlook();
  w.put(A, 'archive', { id: 'a1' });
  const { c } = make(w);
  await c.init(); await c.loadFolders(); await c.openFolder({ kind: 'archive' });
  c.forgetEverything();
  assert.deepEqual([c.getState().folders, c.getState().folder, c.remoteMail(A, 'a1')], [[], null, undefined]);
});

test('signing out of everything also lets go of what was changed in drafts and not saved, files included', async () => {
  const w = outlook();
  w.put(A, 'drafts', DRAFT);
  const kv = new Map<string, string>([['post.sessions', JSON.stringify([{ email: A, id: '1', label: 'Personal', session: `1.s-${A}` }])]]);
  const { c } = make(w, { kv });
  await c.init();
  c.saveDraft({ account: A, to: 'maria@x.no', cc: '', subject: 'endret', body: 'ikke lagret', replyTo: 'd1', mode: 'draft' }, D1);
  await c.saveDraftFiles([{ name: 'a.pdf', type: 'application/pdf', bytes: new Uint8Array(20) }], D1);
  assert.ok(kv.get('post.draftedits'), 'kept on the phone');
  c.forgetEverything();
  assert.equal(kv.has('post.draftedits'), false, 'gone from the phone');
  assert.equal(c.loadDraft(D1), null);
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(await c.loadDraftFiles(D1), [], 'and its files');
});


// ---- deleting for good --------------------------------------------------------------------------------------------------------------------------

const msgs = (w: ReturnType<typeof outlook>, where: string, n: number, email = A) => { for (let i = 0; i < n; i++) w.put(email, where, { id: `${where}-${i}`, received: `2026-10-0${1 + (i % 4)}T1${i % 10}:00:00Z` }); };

test('emptying Deleted reads every message of the folder from Outlook, deletes them for good, and leaves the other folders alone', async () => {
  const w = outlook();
  msgs(w, 'deleteditems', 5); msgs(w, 'archive', 2); msgs(w, 'junkemail', 2);
  const made = make(w); const { c } = made;
  await c.init(); await c.loadFolders(); await c.openFolder({ kind: 'deleted' });
  assert.equal(c.getState().folder!.items.length, 5);
  await c.emptyFolder({ kind: 'deleted' });
  assert.deepEqual(w.ids(A, 'deleteditems'), []);
  assert.equal(w.ids(A, 'archive').length, 2); assert.equal(w.ids(A, 'junkemail').length, 2);
  assert.equal(w.log.filter((l) => l.startsWith('permanent')).length, 5);
  assert.equal(w.log.some((l) => l.startsWith('move') || l.startsWith('delete ')), false, 'never the ordinary delete or a move');
  assert.equal(c.getState().toast!.text, 'Deleted 5 messages for good');
  assert.equal(c.getState().erasing, null);
  assert.deepEqual(c.getState().folder!.items, []);
  await until(() => c.getState().folders.find((f) => f.kind === 'deleted')?.total === 0, 'the folders to be counted again');
});

test('emptying Junk deletes for good too, and a folder that is already empty says so', async () => {
  const w = outlook(); msgs(w, 'junkemail', 3);
  const { c } = make(w);
  await c.init(); await c.openFolder({ kind: 'junk' });
  await c.emptyFolder({ kind: 'junk' });
  assert.deepEqual(w.ids(A, 'junkemail'), []);
  assert.equal(c.getState().toast!.text, 'Deleted 3 messages for good');
  await c.emptyFolder({ kind: 'junk' });
  assert.equal(c.getState().toast!.text, 'Junk is already empty');
});

test('a folder longer than a page is emptied in full, not only what is on the screen', async () => {
  const w = outlook(); msgs(w, 'deleteditems', 450);
  const { c } = make(w);
  await c.init(); await c.openFolder({ kind: 'deleted' });
  assert.equal(c.getState().folder!.items.length, 40, 'the screen has the first page');
  await c.emptyFolder({ kind: 'deleted' });
  assert.deepEqual(w.ids(A, 'deleteditems'), []);
  assert.equal(c.getState().toast!.text, 'Deleted 450 messages for good');
});

test('mail that is on its way out of the folder (moved back, still waiting for its Undo time) is not deleted', async () => {
  const w = outlook(); msgs(w, 'deleteditems', 3);
  const made = make(w); const { c } = made;
  await c.init(); await c.openFolder({ kind: 'deleted' });
  const back = c.getState().folder!.items.find((x) => x.id === 'deleteditems-1')!;
  await c.moveTo([back], { to: 'inbox', name: 'Inbox' });
  await c.emptyFolder({ kind: 'deleted' });
  assert.deepEqual(w.ids(A, 'deleteditems'), ['deleteditems-1'], 'the one that was moved back is still there');
  await settle(made);
  assert.deepEqual(w.ids(A, 'inbox'), ['deleteditems-1~'], 'and the move still goes through');
});

test('with two mailboxes, emptying one folder of one mailbox leaves the other alone, and "all" empties both', async () => {
  const w = outlook([A, W]); msgs(w, 'junkemail', 2, A); msgs(w, 'junkemail', 3, W);
  const { c } = make(w, { emails: [A, W] });
  await c.init();
  await c.emptyFolder({ kind: 'junk', account: A });
  assert.deepEqual([w.ids(A, 'junkemail').length, w.ids(W, 'junkemail').length], [0, 3]);
  await c.emptyFolder({ kind: 'junk' });
  assert.deepEqual([w.ids(A, 'junkemail').length, w.ids(W, 'junkemail').length], [0, 0]);
});

test('the messages picked in Deleted are deleted for good and nothing else is; they leave the list at once', async () => {
  const w = outlook(); msgs(w, 'deleteditems', 5);
  const { c } = make(w);
  await c.init(); await c.openFolder({ kind: 'deleted' });
  const items = c.getState().folder!.items;
  const pick = items.filter((x) => ['deleteditems-0', 'deleteditems-3'].includes(x.id));
  await c.eraseMail(pick);
  assert.deepEqual(w.ids(A, 'deleteditems'), ['deleteditems-1', 'deleteditems-2', 'deleteditems-4']);
  assert.deepEqual(c.getState().folder!.items.map((x) => x.id).sort(), ['deleteditems-1', 'deleteditems-2', 'deleteditems-4']);
  assert.equal(c.getState().toast!.text, 'Deleted 2 messages for good');
});

test('when Outlook does not know the permanent delete, the ordinary delete does the job', async () => {
  const w = outlook(); msgs(w, 'deleteditems', 3); w.flags.permanentStatus = 400;
  const { c } = make(w);
  await c.init();
  await c.emptyFolder({ kind: 'deleted' });
  assert.deepEqual(w.ids(A, 'deleteditems'), []);
  assert.equal(w.log.filter((l) => l.startsWith('delete ')).length, 3);
  assert.equal(c.getState().toast!.text, 'Deleted 3 messages for good');
});

test('when Outlook refuses, Post stops after the first try, says how many are gone, and the mail is still listed', async () => {
  const w = outlook(); msgs(w, 'deleteditems', 100); w.flags.permanentStatus = 403;
  const { c } = make(w);
  await c.init(); await c.openFolder({ kind: 'deleted' });
  await c.emptyFolder({ kind: 'deleted' });
  assert.equal(w.ids(A, 'deleteditems').length, 100);
  assert.equal(w.log.filter((l) => l.startsWith('permanent')).length, 40, 'one chunk, then it gives up');
  assert.equal(c.getState().toast!.text, 'Deleted 0 of 100. The rest could not be deleted just now: try again.');
  assert.equal(c.getState().erasing, null);
  assert.equal(c.getState().folder!.items.length, 40);
});

test('with no connection nothing is deleted and the screen says so', async () => {
  const w = outlook(); msgs(w, 'junkemail', 3);
  const { c } = make(w);
  await c.init();
  w.flags.offline = true;
  await c.emptyFolder({ kind: 'junk' });
  assert.match(c.getState().toast!.text, /^Could not empty Junk: No connection\./);
  assert.equal(c.getState().erasing, null);
  w.flags.offline = false;
  assert.equal(w.ids(A, 'junkemail').length, 3);
});

test('the screen is told how far it is while mail is deleted, and a second go while one is under way does nothing', async () => {
  const w = outlook(); msgs(w, 'junkemail', 90);
  const { c } = make(w);
  await c.init();
  const seen: string[] = [];
  c.subscribe(() => { const e = c.getState().erasing; if (e) seen.push(`${e.what} ${e.done}/${e.total}`); });
  const first = c.emptyFolder({ kind: 'junk' });
  const second = c.emptyFolder({ kind: 'junk' });
  await Promise.all([first, second]);
  assert.ok(seen.includes('Emptying Junk 0/90') && seen.includes('Emptying Junk 40/90') && seen.includes('Emptying Junk 90/90'), seen.join(' | '));
  assert.equal(w.log.filter((l) => l.startsWith('permanent')).length, 90, 'each message once');
});

// ---- blocking a sender, and tidying by itself ---------------------------------------------------------------------------------------------------

const OLD = '2026-09-10T10:00:00Z';   // 25 days before the pretend clock
const NEW = '2026-10-04T10:00:00Z';   // a day before it
const inbox = (w: ReturnType<typeof outlook>, id: string, from: string, received = NEW, extra: Partial<Msg> = {}) => w.put(A, 'inbox', { id, from, subject: `Tilbud ${id}`, received, ...extra });
const blockKeys = (c: Made['c']) => c.getState().blocked;
const inboxIds = (c: Made['c']) => c.getState().mail.map((m) => m.id).sort();

test('blocking a sender moves their mail to Junk at once, with an Undo, and keeps them out of the icon number by sorting them as promotions', async () => {
  const w = outlook();
  inbox(w, 'b1', 'spam@x.no'); inbox(w, 'b2', 'Spam@X.no'); inbox(w, 'o1', 'anna@y.no');
  const made = make(w); const { c } = made;
  await c.init(); await c.sync();
  await c.blockSender('spam@x.no');
  assert.deepEqual(inboxIds(c), ['o1'], 'both leave the inbox at once');
  assert.equal(c.getState().toast!.text, 'Blocked spam@x.no. 2 messages moved to Junk.');
  assert.deepEqual(blockKeys(c), ['spam@x.no']);
  assert.equal(c.getState().overrides['spam@x.no'], 'promo');
  assert.deepEqual(await made.store.getMeta('blocked'), ['spam@x.no'], 'kept on the phone');
  assert.equal(w.log.some((l) => l.startsWith('move b')), false, 'Outlook has not heard yet');
  await settle(made);
  assert.deepEqual(w.ids(A, 'junkemail'), ['b1~', 'b2~']);
  assert.deepEqual(w.ids(A, 'inbox'), ['o1']);
});

test('Undo of a block brings the mail back and lifts the block', async () => {
  const w = outlook(); inbox(w, 'b1', 'spam@x.no'); inbox(w, 'o1', 'anna@y.no');
  const made = make(w); const { c } = made;
  await c.init(); await c.sync();
  await c.blockSender('spam@x.no');
  c.getState().toast!.undo!();
  await until(() => inboxIds(c).includes('b1'), 'the mail to come back');
  assert.deepEqual(blockKeys(c), []);
  assert.deepEqual(c.getState().overrides, {});
  await settle(made);
  assert.deepEqual(w.ids(A, 'junkemail'), [], 'and Outlook never heard of it');
});

test('blocking a company covers every address and sub-domain of it, never a shared mail provider, and flagged mail is left alone', async () => {
  const w = outlook();
  inbox(w, 'c1', 'a@acme.com'); inbox(w, 'c2', 'news@mail.acme.com'); inbox(w, 'c3', 'b@acme.com', NEW, { flagged: true }); inbox(w, 'g1', 'x@gmail.com');
  const made = make(w); const { c } = made;
  await c.init(); await c.sync();
  await c.blockSender('a@acme.com', 'company');
  assert.deepEqual(blockKeys(c), ['@acme.com']);
  assert.deepEqual(inboxIds(c), ['c3', 'g1'], 'the flagged one stays');
  await c.blockSender('x@gmail.com', 'company');
  assert.deepEqual(blockKeys(c), ['@acme.com', 'x@gmail.com'], 'gmail.com is blocked as that one address only');
  assert.deepEqual(inboxIds(c), ['c3']);
});

test('mail from a blocked sender that arrives later goes to Junk when Post is open, and what you brought back stays', async () => {
  const w = outlook(); inbox(w, 'o1', 'anna@y.no');
  const made = make(w); const { c } = made;
  await c.init(); await c.sync();
  await c.blockSender('spam@x.no');
  inbox(w, 'n1', 'spam@x.no');
  await settle(made);
  await c.sync(); await c.sortInBackground(); await c.autoTidy();
  await until(() => !inboxIds(c).includes('n1'), 'the new one to be moved');
  assert.deepEqual(inboxIds(c), ['o1'], 'the new one is moved at once');
  assert.match(c.getState().toast!.text, /^Moved 1 message from a blocked sender to Junk$/);
  await settle(made);
  assert.deepEqual(w.ids(A, 'junkemail'), ['n1~']);
  // brought back on purpose: Not junk
  await c.openFolder({ kind: 'junk' });
  await c.moveTo(c.getState().folder!.items, { to: 'inbox', name: 'Inbox' });
  await settle(made);
  await c.sync(); await c.sortInBackground(); await c.autoTidy(); await tick(50);
  assert.equal(inboxIds(c).length, 2, 'it is in the inbox again');
  await settle(made);
  assert.equal(w.ids(A, 'junkemail').length, 0, 'and it is not moved to Junk again');
});

test('unblocking forgets the block and the tab choice that came with it, but not a tab choice made since', async () => {
  const w = outlook(); inbox(w, 'b1', 'spam@x.no');
  const made = make(w); const { c } = made;
  await c.init(); await c.sync();
  await c.blockSender('spam@x.no');
  await c.unblock('spam@x.no');
  assert.deepEqual(blockKeys(c), []); assert.deepEqual(c.getState().overrides, {});
  await c.blockSender('spam@x.no');
  await c.moveSender('spam@x.no', 'update');
  await c.unblock('spam@x.no');
  assert.equal(c.getState().overrides['spam@x.no'], 'update', 'a tab you chose since stays');
});

const promos = (w: ReturnType<typeof outlook>) => {
  inbox(w, 'p-old', 'shop@x.no', OLD); inbox(w, 'p-new', 'shop@x.no', NEW); inbox(w, 'p-flag', 'shop@x.no', OLD, { flagged: true }); inbox(w, 'h-old', 'anna@y.no', OLD);
};

test('with auto clean-up on, promotions older than the chosen days are archived by themselves, with an Undo, and nothing else is touched', async () => {
  const w = outlook(); promos(w);
  const made = make(w); const { c } = made;
  await c.init(); await c.moveSender('shop@x.no', 'promo'); await c.sync(); await c.sortInBackground(); await settle(made);
  await c.autoTidy();
  assert.equal(inboxIds(c).length, 4, 'off by default: nothing moves');
  c.setSettings({ autoClean: 7 });
  await until(() => !inboxIds(c).includes('p-old'), 'the old promotion to be archived');
  assert.deepEqual(inboxIds(c), ['h-old', 'p-flag', 'p-new'], 'the new one, the flagged one and the person stay');
  assert.equal(c.getState().toast!.text, 'Archived 1 old promotion');
  await settle(made);
  assert.deepEqual(w.ids(A, 'archive'), ['p-old~']);
});

test('Undo of an automatic clean-up keeps the mail: it is not archived again at the next sync', async () => {
  const w = outlook(); promos(w);
  const made = make(w); const { c } = made;
  await c.init(); await c.moveSender('shop@x.no', 'promo'); await c.sync(); await c.sortInBackground(); await settle(made);
  c.setSettings({ autoClean: 7 });
  await until(() => !inboxIds(c).includes('p-old'), 'the old promotion to be archived');
  c.getState().toast!.undo!();
  await until(() => inboxIds(c).includes('p-old'), 'the mail to come back');
  await settle(made);
  await c.sync(); await c.sortInBackground(); await c.autoTidy(); await tick(100); await settle(made);
  assert.ok(c.getState().mail.every((m) => m.sig !== undefined), 'everything has been sorted again, so it could have been archived');
  assert.ok(inboxIds(c).includes('p-old'), 'still in the inbox');
  assert.deepEqual(w.ids(A, 'archive'), []);
});

test('mail whose sorting is only a first guess is never archived by itself', async () => {
  const w = outlook(); promos(w);
  const made = make(w); const { c } = made;
  w.flags.noHeaders = true;
  await c.init(); await c.moveSender('shop@x.no', 'promo'); await c.sync(); await c.sortInBackground();
  assert.ok(c.getState().mail.some((m) => m.sig === undefined), 'the header marks have not been read');
  await settle(made);
  c.setSettings({ autoClean: 7 });
  await tick(50);
  assert.equal(inboxIds(c).length, 4, 'nothing moved');
});

test('the choices of auto clean-up are 3, 7, 14 and 30 days, and anything else is read as off', async () => {
  const { loadSettings } = await import('./settings.ts');
  for (const d of [0, 3, 7, 14, 30]) assert.equal(loadSettings({ autoClean: d }).autoClean, d);
  for (const bad of [5, -1, 'x', null, 7.5]) assert.equal(loadSettings({ autoClean: bad }).autoClean, 0);
  assert.equal(loadSettings({}).autoClean, 0, 'off unless you turn it on');
});

// ---- mute a conversation ---------------------------------------------------------------------------------------------------------------
const mutedKeys = (c: Made['c']) => c.getState().muted.map((x) => x.key);
const mailOf = (c: Made['c'], id: string) => c.getState().mail.find((m) => m.id === id)!;

test('muting a conversation archives what is in the inbox of it at once, with an Undo, and keeps it on the phone', async () => {
  const w = outlook();
  inbox(w, 'm1', 'anna@x.no', NEW, { conversationId: 'cc', subject: 'Re: Middag' }); inbox(w, 'm2', 'per@x.no', OLD, { conversationId: 'cc', subject: 'Middag' }); inbox(w, 'o1', 'anna@y.no');
  const made = make(w); const { c } = made;
  await c.init(); await c.sync();
  await c.muteConversation(mailOf(c, 'm1'));
  assert.deepEqual(inboxIds(c), ['o1'], 'both leave the inbox at once');
  assert.equal(c.getState().toast!.text, 'Muted “Middag”. 2 messages archived.');
  assert.equal(c.getState().muted.length, 1);
  assert.deepEqual((await made.store.getMeta<{ key: string; subject: string }[]>('muted'))?.map((x) => x.subject), ['Middag'], 'kept on the phone');
  await settle(made);
  assert.deepEqual(w.ids(A, 'archive'), ['m1~', 'm2~']);
  assert.deepEqual(w.ids(A, 'inbox'), ['o1']);
});

test('Undo of a mute brings the mail back and lifts the mute', async () => {
  const w = outlook(); inbox(w, 'm1', 'anna@x.no', NEW, { conversationId: 'cc' }); inbox(w, 'o1', 'anna@y.no');
  const made = make(w); const { c } = made;
  await c.init(); await c.sync();
  await c.muteConversation(mailOf(c, 'm1'));
  c.getState().toast!.undo!();
  await until(() => inboxIds(c).includes('m1'), 'the mail to come back');
  assert.deepEqual(mutedKeys(c), []);
  await settle(made);
  assert.deepEqual(w.ids(A, 'archive'), [], 'and Outlook never heard of it');
});

test('a reply that arrives later in a muted conversation is archived when Post is open, flagged mail and what you brought back stay', async () => {
  const w = outlook(); inbox(w, 'm1', 'anna@x.no', OLD, { conversationId: 'cc' }); inbox(w, 'o1', 'anna@y.no');
  const made = make(w); const { c } = made;
  await c.init(); await c.sync();
  await c.muteConversation(mailOf(c, 'm1'));
  await settle(made);
  inbox(w, 'n1', 'anna@x.no', NEW, { conversationId: 'cc' });
  await c.sync(); await c.sortInBackground(); await c.autoTidy();
  await until(() => !inboxIds(c).includes('n1'), 'the reply to be archived');
  assert.match(c.getState().toast!.text, /^Archived 1 message from a muted conversation$/);
  await settle(made);
  assert.deepEqual(w.ids(A, 'archive').sort(), ['m1~', 'n1~']);
  // flagged: left alone
  inbox(w, 'f1', 'anna@x.no', NEW, { conversationId: 'cc', flagged: true });
  await c.sync(); await c.sortInBackground(); await c.autoTidy(); await tick(50);
  assert.deepEqual(inboxIds(c), ['f1', 'o1']);
  // brought back on purpose: it stays
  await c.openFolder({ kind: 'archive' });
  await c.moveTo(c.getState().folder!.items.filter((m) => m.id.startsWith('n1')), { to: 'inbox', name: 'Inbox' });
  await settle(made);
  await c.sync(); await c.sortInBackground(); await c.autoTidy(); await tick(50);
  assert.equal(inboxIds(c).length, 3, 'it is in the inbox again');
  await settle(made);
  assert.equal(w.ids(A, 'archive').filter((id) => id.startsWith('n1')).length, 0, 'and it is not archived again');
});

test('unmuting forgets the mute with an Undo, and a message without a conversation cannot be muted', async () => {
  const w = outlook(); inbox(w, 'm1', 'anna@x.no', NEW, { conversationId: 'cc' }); inbox(w, 'o1', 'anna@y.no');
  const made = make(w); const { c } = made;
  await c.init(); await c.sync();
  await c.muteConversation(mailOf(c, 'm1'));
  await c.unmute(mutedKeys(c)[0]);
  assert.deepEqual(mutedKeys(c), []);
  c.getState().toast!.undo!();
  await until(() => mutedKeys(c).length === 1, 'the mute to come back');
  await c.muteConversation({ ...mailOf(c, 'o1'), conversationId: '' });
  assert.equal(mutedKeys(c).length, 1, 'nothing to mute without a conversation id');
});

// ---- where did my mail go? ------------------------------------------------------------------------------------------------------------------
const leftOf = (c: Made['c']) => c.getState().left;

test('the record says why mail left the inbox: archive, blocked sender, muted conversation, each in its own words', async () => {
  const w = outlook();
  inbox(w, 'a1', 'anna@x.no', NEW, { subject: 'Hei' }); inbox(w, 'b1', 'spam@x.no', NEW, { subject: 'Tilbud b1' }); inbox(w, 'm1', 'per@x.no', NEW, { conversationId: 'cc', subject: 'Middag' }); inbox(w, 'o1', 'ola@y.no');
  const made = make(w); const { c } = made;
  await c.init(); await c.sync();
  assert.deepEqual(leftOf(c), [], 'nothing before anything has happened');
  await c.archive([mailOf(c, 'a1')]);
  await c.blockSender('spam@x.no');
  await c.muteConversation(mailOf(c, 'm1'));
  const why = Object.fromEntries(leftOf(c).map((e) => [e.subject, e.why]));
  assert.deepEqual(why, { Hei: 'archive', 'Tilbud b1': 'blocked', Middag: 'muted' });
  assert.deepEqual((await made.store.getMeta<unknown[]>('leftlog'))?.length, 3, 'kept on the phone');
});

test('mail that Outlook took away is told as Outlook\'s doing', async () => {
  const w = outlook();
  inbox(w, 'a1', 'anna@x.no', NEW, { subject: 'Hei' }); inbox(w, 'o1', 'ola@y.no', NEW, { subject: 'Ola' });
  const f = w.f;
  let removeNext = false;
  w.f = (async (url: string, init?: RequestInit) => {
    if (removeNext && /delta/.test(String(url))) { removeNext = false; return new Response(JSON.stringify({ value: [{ id: 'o1', '@removed': { reason: 'deleted' } }], '@odata.deltaLink': 'https://graph/delta?d=99' }), { status: 200, headers: { 'content-type': 'application/json' } }); }
    return f(url, init);
  }) as typeof w.f;
  const made = make(w); const { c } = made;
  await c.init(); await c.sync();
  assert.deepEqual(inboxIds(c), ['a1', 'o1']);
  removeNext = true;
  await c.sync();
  assert.deepEqual(inboxIds(c), ['a1']);
  assert.deepEqual(leftOf(c).map((e) => [e.subject, e.why]), [['Ola', 'outlook']]);
});

test('signing an account out does not fill the record with its mail', async () => {
  const w = outlook([A, W]);
  w.put(W, 'inbox', { id: 'w1', from: 'x@w.no', subject: 'Jobb', received: NEW });
  const made = make(w, { emails: [A, W] }); const { c } = made;
  await c.init(); await c.sync();
  assert.ok(inboxIds(c).includes('w1'));
  await c.removeAccount(W);
  assert.equal(inboxIds(c).includes('w1'), false);
  assert.deepEqual(leftOf(c), []);
});
