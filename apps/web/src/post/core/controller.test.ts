import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanUpList, cleanUpThreads, createController, mailCounts, replyLaterThreads, snoozedThreads, visibleMail, visibleThreads, type Deps } from './controller.ts';
import { memoryStore, type Store } from './store.ts';

const SERVER = 'https://s.example/fn';
const acct = (email: string, label: string) => ({ id: label === 'Work' ? '2' : '1', email, label, mode: 'people', quiet: null, vips: [] as string[], subscription_expires_at: null, last_alert_at: null });

// A tiny fake of both the alert server and Microsoft Graph, behind one fetch.
function world() {
  const log: string[] = [];
  const inbox = new Map<string, any>();
  let nextDelta = 1;
  const accounts = new Map([['a@outlook.com', acct('a@outlook.com', 'Personal')]]);
  const flags = {
    offline: false, tokenFail: new Set<string>(), polled: false, nextEmail: 'w@firma.no', conversationFails: false, noFolder: new Set<string>(),
    /** What Outlook answers to "send" (202 is a message that went). */ sendStatus: 202,
    attachStatus: 201, uploadFails: false,
    /** Held at "send" until it opens: a message that is slow to go. */ gate: null as Promise<void> | null,
    /** The next time one of these (draft, attach, send) happens Outlook does the work and the answer is lost on the way back / the call never arrives. */
    loseAfter: [] as string[], loseBefore: [] as string[],
    /** Ids that were moved: Outlook no longer knows them. */ moved: new Set<string>(),
    /** What Outlook answers to a move (201 is one that worked). */ moveStatus: 201,
    /** A later sync (from a saved place) hears only what changed, as the real thing does; otherwise it hears everything every time. */ strictDelta: false,
  };
  const drafts = new Map<string, { kind: string; subject: string; body: string; to: string[]; cc: string[]; replyTo?: string; attachments: { name: string; size: number }[] }>(); // made and not sent
  const sentMails: { kind: string; subject: string; body: string; to: string[]; cc: string[]; replyTo?: string; attachments: { name: string; size: number }[] }[] = []; // what really went out
  let draftSeq = 0;
  let session: { draft: string; name: string; size: number } | null = null;
  const take = (list: string[], what: string) => { const i = list.indexOf(what); if (i < 0) return false; list.splice(i, 1); return true; };
  const convo = new Map<string, any[]>(); // conversation id -> every message of it in Outlook, whatever folder it is in
  const headers: Record<string, { name: string; value: string }[]> = {}; // what the hidden headers of each message say
  const sent: string[] = []; // who the person has written to (Sent Items)
  const add = (id: string, o: any = {}) => inbox.set(id, { id, subject: `Subject ${id}`, receivedDateTime: '2026-10-05T08:00:00Z', from: { emailAddress: { name: 'Anna', address: 'anna@x.no' } }, isRead: false, bodyPreview: 'preview', ...o });
  const f = (async (url: string, init: RequestInit = {}) => {
    if (flags.offline) throw new Error('offline');
    const u = String(url);
    const body = typeof init.body === 'string' && init.body ? JSON.parse(init.body) : {};
    if (u === SERVER) {
      log.push(`server ${body.op}`);
      const session = String((init.headers as Record<string, string>)['x-post-session'] ?? '');
      const email = session.replace(/^.*\.s-/, '');
      const known = session && accounts.has(email);
      const j = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });
      const doneFor = (e: string) => ({ status: 'done', id: '2', email: e, label: 'Work', session: `2.s-${e}`, expires: 'x' });
      if (body.op === 'signin_start') return j({ url: 'https://login.microsoftonline.com/authorize?state=ST', handle: 'H'.repeat(24) });
      if (body.op === 'signin_finish') { if (body.state === 'forged') return j({ error: 'This sign-in did not start here. Try again.' }, 400); accounts.set(flags.nextEmail, acct(flags.nextEmail, 'Work')); return j({ ...doneFor(flags.nextEmail), handle: 'H'.repeat(24) }); }
      if (body.op === 'signin_poll') { if (!flags.polled) return j({ status: 'pending' }); accounts.set(flags.nextEmail, acct(flags.nextEmail, 'Work')); return j(doneFor(flags.nextEmail)); }
      if (body.op === 'signin_forget') return j({ ok: true });
      if (!known) return j({ error: 'unauthorized' }, 401);
      if (body.op === 'status') return j({ devices: 1, accounts: [accounts.get(email)] });
      if (body.op === 'token') return flags.tokenFail.has(email) ? j({ error: 'AADSTS700082: The refresh token has expired due to inactivity.' }, 400) : j({ accessToken: 'T', expiresIn: 3600, email });
      if (body.op === 'unregister') { accounts.delete(email); return j({ removed: true }); }
      return j({ ok: true });
    }
    const path = u.replace('https://graph.microsoft.com/v1.0', '');
    if (/messages\/delta/.test(path) || u.includes('graph/delta')) {
      log.push('graph delta');
      const changes = flags.strictDelta && u.includes('graph/delta') ? [] : [...inbox.values()];
      return new Response(JSON.stringify({ value: changes, '@odata.deltaLink': `https://graph/delta?d=${nextDelta++}` }));
    }
    if (path === '/$batch') return new Response(JSON.stringify({ responses: body.requests.map((r: any) => {
      const folder = /mailFolders\/([a-z]+)\?\$select=id/.exec(r.url);
      if (folder) { log.push(`graph folder ${folder[1]}`); return flags.noFolder.has(folder[1]) ? { id: r.id, status: 429, body: {} } : { id: r.id, status: 200, body: { id: `F-${folder[1]}` } }; }
      return { id: r.id, status: 200, body: { internetMessageHeaders: headers[decodeURIComponent(/messages\/([^?]+)/.exec(r.url)![1])] ?? [] } };
    }) }));
    if (path.startsWith('/me/messages?$filter=conversationId')) {
      const id = /conversationId eq '(.*)'/.exec(decodeURIComponent(path.split('$filter=')[1].split('&')[0]))![1].replace(/''/g, "'");
      log.push(`graph conversation ${id}`);
      return flags.conversationFails ? new Response('{}', { status: 500 }) : new Response(JSON.stringify({ value: convo.get(id) ?? [] }));
    }
    if (path.startsWith('/me/mailFolders/sentitems/messages')) { log.push('graph sent'); return new Response(JSON.stringify({ value: sent.map((address) => ({ toRecipients: [{ emailAddress: { address } }], ccRecipients: [] })) })); }
    let m: RegExpExecArray | null;
    // ---- sending: every message goes out through a draft ----
    const out = (o: unknown, status = 200) => new Response(status === 204 || status === 202 ? null : JSON.stringify(o), { status });
    const notFound = () => out({ error: { code: 'ErrorItemNotFound', message: 'The specified object was not found in the store.' } }, 404);
    const addr = (rs: any[] = []) => rs.map((r) => String(r?.emailAddress?.address ?? ''));
    if (init.method === 'POST' && path === '/me/messages') {
      log.push(`graph draft ${body.subject}`);
      if (take(flags.loseBefore, 'draft')) throw new Error('Failed to fetch');
      const id = `D${++draftSeq}`;
      drafts.set(id, { kind: 'new', subject: body.subject, body: body.body?.content ?? '', to: addr(body.toRecipients), cc: addr(body.ccRecipients), attachments: [] });
      if (take(flags.loseAfter, 'draft')) throw new Error('Failed to fetch');
      return out({ id }, 201);
    }
    if (init.method === 'POST' && (m = /^\/me\/messages\/([^/]+)\/(createReply|createReplyAll|createForward)$/.exec(path))) {
      const orig = decodeURIComponent(m[1]);
      log.push(`graph ${m[2]} ${orig}`);
      if (flags.moved.has(orig)) return notFound();
      const id = `D${++draftSeq}`;
      drafts.set(id, { kind: m[2] === 'createReply' ? 'reply' : m[2] === 'createReplyAll' ? 'replyAll' : 'forward', subject: '', body: body.comment ?? '', to: addr(body.toRecipients), cc: [], replyTo: orig, attachments: [] });
      return out({ id }, 201);
    }
    if (init.method === 'POST' && (m = /^\/me\/messages\/([^/]+)\/attachments\/createUploadSession$/.exec(path))) {
      log.push(`graph session ${m[1]} ${body.AttachmentItem.name} ${body.AttachmentItem.size}`);
      session = { draft: decodeURIComponent(m[1]), name: body.AttachmentItem.name, size: body.AttachmentItem.size };
      return out({ uploadUrl: 'https://upload.example/s?authtoken=T' });
    }
    if (u.startsWith('https://upload.example/')) {
      if (flags.uploadFails) throw new TypeError('Failed to fetch');
      const range = String((init.headers as Record<string, string>)['Content-Range']);
      log.push(`upload ${range}`);
      const end = /^bytes \d+-(\d+)\/(\d+)$/.exec(range);
      if (session && end && Number(end[1]) + 1 === Number(end[2])) drafts.get(session.draft)?.attachments.push({ name: session.name, size: session.size });
      return out({});
    }
    if (init.method === 'POST' && (m = /^\/me\/messages\/([^/]+)\/attachments$/.exec(path))) {
      const id = decodeURIComponent(m[1]);
      log.push(`graph attach ${id} ${body.name}`);
      if (take(flags.loseBefore, 'attach')) throw new Error('Failed to fetch');
      const d = drafts.get(id);
      if (!d) return notFound();
      if (flags.attachStatus === 201) d.attachments.push({ name: body.name, size: atob(body.contentBytes).length });
      if (take(flags.loseAfter, 'attach')) throw new Error('Failed to fetch');
      return out({}, flags.attachStatus);
    }
    if (init.method === 'GET' && (m = /^\/me\/messages\/([^/]+)\/attachments\?\$select=name,size$/.exec(path))) {
      const d = drafts.get(decodeURIComponent(m[1]));
      log.push(`graph draft attachments ${decodeURIComponent(m[1])}`);
      return d ? out({ value: d.attachments }) : notFound();
    }
    if (init.method === 'GET' && (m = /^\/me\/messages\/([^/?]+)\?\$select=isDraft$/.exec(path))) {
      log.push(`graph isDraft ${decodeURIComponent(m[1])}`);
      return drafts.has(decodeURIComponent(m[1])) ? out({ isDraft: true }) : notFound();
    }
    if (init.method === 'POST' && (m = /^\/me\/messages\/([^/]+)\/send$/.exec(path))) {
      const id = decodeURIComponent(m[1]);
      log.push(`graph send ${id}`);
      if (flags.gate) await flags.gate;
      if (take(flags.loseBefore, 'send')) throw new Error('Failed to fetch');
      const d = drafts.get(id);
      if (!d) return notFound();
      if (flags.sendStatus !== 202) return out({ error: { code: 'ErrorMessageSizeExceeded', message: 'The message is too large' } }, flags.sendStatus);
      sentMails.push(d); drafts.delete(id); // a sent draft is gone from Drafts
      if (take(flags.loseAfter, 'send')) throw new Error('Failed to fetch');
      return out(null, 202);
    }
    if (init.method === 'DELETE' && (m = /^\/me\/messages\/([^/]+)$/.exec(path))) { log.push(`graph delete ${decodeURIComponent(m[1])}`); drafts.delete(decodeURIComponent(m[1])); return out(null, 204); }
    if ((m = /^\/me\/messages\/([^/]+)\/move$/.exec(path))) {
      const id = decodeURIComponent(m[1]);
      log.push(`graph move ${id} ${body.destinationId}`);
      if (flags.moveStatus !== 201) return out({ error: { code: 'ErrorAccessDenied', message: 'Access is denied.' } }, flags.moveStatus);
      inbox.delete(id); flags.moved.add(id);
      return new Response(JSON.stringify({ id: `moved-${id}` }), { status: 201 });
    }
    if ((m = /^\/me\/messages\/([^/?]+)$/.exec(path)) && init.method === 'PATCH') { log.push(`graph patch ${decodeURIComponent(m[1])} ${JSON.stringify(body)}`); return new Response('{}'); }
    if ((m = /^\/me\/messages\/([^/?]+)\?\$select=body/.exec(path))) { log.push('graph body'); return new Response(JSON.stringify({ body: { contentType: 'html', content: '<p>Hei</p>' }, toRecipients: [{ emailAddress: { name: 'Meg', address: 'a@outlook.com' } }], hasAttachments: false })); }
    if (path === '/me/sendMail') { log.push(`graph sendMail ${body.message.subject}`); return new Response(null, { status: 202 }); }
    if (path.startsWith('/me/messages?$search')) { log.push('graph search'); return new Response(JSON.stringify({ value: [{ id: 'old1', subject: 'Gammel faktura', from: { emailAddress: { address: 'x@y.no' } }, receivedDateTime: '2025-01-01T00:00:00Z' }, ...[...inbox.values()].slice(0, 1)] })); }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
  return { f, log, add, inbox, flags, headers, sent, convo, drafts, sentMails, accounts: () => [...accounts.values()] };
}

function make(w = world(), extra: Partial<Deps> = {}) {
  const store = memoryStore();
  const kv = new Map<string, string>([['post.sessions', JSON.stringify([{ email: 'a@outlook.com', id: '1', label: 'Personal', session: '1.s-a@outlook.com' }])]]);
  const timers: { fn: () => void; ms: number }[] = [];
  let t = Date.parse('2026-10-05T10:00:00Z');
  const c = createController({
    store, fetch: w.f, serverUrl: SERVER, now: () => t, sleep: async () => {}, setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    kv: { get: (k) => kv.get(k) ?? null, set: (k, v) => void kv.set(k, v), del: (k) => void kv.delete(k) }, ...extra,
  });
  const runTimers = async () => { while (timers.length) { const x = timers.shift()!; x.fn(); await new Promise((r) => setTimeout(r, 5)); } };
  return { c, w, store, kv, advance: (ms: number) => { t += ms; }, runTimers };
}

test('opening the app syncs the inbox, from the saved accounts, and shows mail', async () => {
  const w = world(); w.add('1'); w.add('2');
  const { c } = make(w);
  await c.init();
  const s = c.getState();
  assert.equal(s.ready, true);
  assert.equal(s.mail.length, 2);
  assert.equal(s.accounts[0].email, 'a@outlook.com');
  assert.equal(s.sync.error, null);
});

test('archive: gone from the screen at once, sent to Outlook only after the undo window', async () => {
  const w = world(); w.add('1'); w.add('2');
  const { c, advance, runTimers } = make(w);
  await c.init();
  await c.archive([c.getState().mail.find((m) => m.id === '1')!]);
  assert.deepEqual(c.getState().mail.map((m) => m.id), ['2']);
  assert.equal(w.log.some((l) => l.startsWith('graph move')), false);
  assert.match(c.getState().toast!.text, /Archived/);
  advance(7000);
  await runTimers();
  assert.ok(w.log.includes('graph move 1 archive'));
  assert.equal(c.getState().waiting, 0);
});

test('undo brings the message back and nothing ever reaches Outlook', async () => {
  const w = world(); w.add('1');
  const { c, advance, runTimers } = make(w);
  await c.init();
  await c.archive([c.getState().mail[0]]);
  c.getState().toast!.undo!();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(c.getState().mail.length, 1);
  advance(10_000);
  await runTimers();
  assert.equal(w.log.some((l) => l.startsWith('graph move')), false);
});

test('archiving a message does not bring it back on the next sync, even before the server moved it', async () => {
  const w = world(); w.add('1'); w.add('2');
  const { c } = make(w);
  await c.init();
  await c.archive([c.getState().mail.find((m) => m.id === '1')!]);
  await c.sync(); // server still lists message 1 (the move is held back)
  assert.deepEqual(c.getState().mail.map((m) => m.id), ['2']);
});

test('bulk archive makes one toast and one undo for all', async () => {
  const w = world(); w.add('1'); w.add('2'); w.add('3');
  const { c } = make(w);
  await c.init();
  await c.archive(c.getState().mail.slice(0, 2));
  assert.equal(c.getState().toast!.text, 'Archived 2');
  c.getState().toast!.undo!();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(c.getState().mail.length, 3);
});

test('mark read is optimistic and goes to Outlook straight away', async () => {
  const w = world(); w.add('1');
  const { c } = make(w);
  await c.init();
  await c.setRead(c.getState().mail[0], true);
  assert.equal(c.getState().mail[0].isRead, true);
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(w.log.some((l) => l.includes('graph patch 1') && l.includes('"isRead":true')));
});

test('snooze hides the message from the inbox list until its time, and keeps it in Later', async () => {
  const w = world(); w.add('1');
  const { c } = make(w);
  await c.init();
  await c.snooze(c.getState().mail[0], new Date('2026-10-06T08:00:00Z'), 'tomorrow 08:00');
  const now = Date.parse('2026-10-05T10:00:00Z');
  assert.equal(visibleMail(c.getState(), now).length, 0);
  assert.equal(visibleMail(c.getState(), Date.parse('2026-10-06T09:00:00Z')).length, 1);
});

test('offline: the app opens with the stored mail and says so honestly', async () => {
  const w = world(); w.add('1');
  const { c } = make(w);
  await c.init();
  w.flags.offline = true;
  await c.sync();
  assert.equal(c.getState().mail.length, 1);
  assert.equal(c.getState().online, false);
});

test('offline archive waits, then goes through when back online', async () => {
  const w = world(); w.add('1');
  const { c, advance } = make(w);
  await c.init();
  await c.archive([c.getState().mail[0]]);
  advance(7000);
  w.flags.offline = true;
  await c.sync();
  assert.equal(c.getState().waiting, 1);
  w.flags.offline = false;
  await c.sync();
  assert.equal(c.getState().waiting, 0);
  assert.ok(w.log.includes('graph move 1 archive'));
});

test('an expired sign-in marks only that account, with a plain reason', async () => {
  const w = world(); w.add('1');
  const { c, advance } = make(w);
  await c.init();
  advance(2 * 3600 * 1000); // the cached access token has run out
  w.flags.tokenFail.add('a@outlook.com');
  await c.sync();
  assert.equal(c.getState().accounts[0].needsSignIn, true);
});

test('one button: start gives the Microsoft address; finishing in the same window signs the account in and reads its mail', async () => {
  const w = world(); w.add('1');
  const { c, kv } = make(w);
  await c.init();
  const url = await c.startSignIn('https://site.example/post/');
  assert.match(url, /login\.microsoftonline\.com/);
  assert.equal(c.getState().signingIn, true);
  const r = await c.finishSignIn('CODE', 'ST');
  assert.deepEqual(r, { email: 'w@firma.no', fromThisApp: true });
  assert.deepEqual(c.getState().accounts.map((a) => a.email), ['a@outlook.com', 'w@firma.no']);
  assert.equal(c.getState().signingIn, false);
  assert.equal(kv.get('post.pending'), undefined);
  assert.equal(JSON.parse(kv.get('post.sessions')!).length, 2);
});

test('the sign-in finished in another window: the landing page says so, and the app collects it when looked at again', async () => {
  const w = world();
  const { c } = make(w);
  await c.init();
  await c.startSignIn('https://site.example/post/');
  // the landing window is a different one: it has no pending sign-in of its own
  const other = make(w);
  await other.c.init();
  const r = await other.c.finishSignIn('CODE', 'ST');
  assert.equal(r.fromThisApp, false);
  assert.equal(other.c.getState().accounts.length, 1, 'that window did not keep a session');
  // back in the app: nothing yet, then Microsoft is done
  await c.collectSignIn();
  assert.equal(c.getState().accounts.length, 1);
  w.flags.polled = true;
  await c.collectSignIn();
  assert.deepEqual(c.getState().accounts.map((a) => a.email), ['a@outlook.com', 'w@firma.no']);
  assert.equal(c.getState().signingIn, false);
});

test('a forged sign-in return is refused and signs nobody in', async () => {
  const w = world();
  const { c } = make(w);
  await c.init();
  await assert.rejects(() => c.finishSignIn('CODE', 'forged'), /did not start here/);
  assert.equal(c.getState().accounts.length, 1);
});

test('a sign-in that was never finished is forgotten after a while', async () => {
  const w = world();
  const { c, kv } = make(w);
  await c.init();
  kv.set('post.pending', JSON.stringify({ handle: 'H'.repeat(24), at: Date.now() - 16 * 60_000 }));
  await c.collectSignIn();
  assert.equal(c.getState().signingIn, false);
});

test('removing an account clears its mail from this phone', async () => {
  const w = world(); w.add('1');
  const { c } = make(w);
  await c.init();
  await c.removeAccount('a@outlook.com');
  assert.equal(c.getState().mail.length, 0);
  assert.equal(c.getState().accounts.length, 0);
  assert.equal(c.getState().ready, true);
});

test('removing an account while its mail is still being sorted does not bring the mail back', async () => {
  const w = world(); w.add('1'); w.add('2');
  const inner = memoryStore();
  let release!: () => void;
  const hold = new Promise<void>((r) => { release = r; });
  // The sorting job has read the headers and is about to save them when the mailbox is removed.
  const store = { ...inner, async putMail(items: Parameters<typeof inner.putMail>[0]) { if (items.some((m) => m.sig)) await hold; await inner.putMail(items); } };
  const { c } = make(w, { store });
  await c.init();
  assert.equal(c.getState().sorting, true);
  const removing = c.removeAccount('a@outlook.com');
  setTimeout(release, 20);
  await removing;
  await new Promise((r) => setTimeout(r, 40));
  assert.equal((await inner.allMail()).length, 0);
  assert.equal(c.getState().mail.length, 0);
});

test('alert settings are shown at once and rolled back if the server refuses', async () => {
  const w = world();
  const { c } = make(w);
  await c.init();
  await c.setAlerts('a@outlook.com', { mode: 'all' });
  assert.equal(c.getState().accounts[0].mode, 'all');
  const bad = make(Object.assign(world(), {}));
  await bad.c.init();
  bad.w.flags.offline = true;
  await bad.c.setAlerts('a@outlook.com', { mode: 'off' });
  assert.equal(bad.c.getState().accounts[0].mode, 'people');
});

test('sending: held for the undo window, cancel returns it as a draft, otherwise it leaves', async () => {
  const w = world();
  const { c, advance, runTimers } = make(w);
  await c.init();
  await c.send({ account: 'a@outlook.com', kind: 'new', to: ['x@y.no'], cc: [], subject: 'Hei', body: 'Tekst' });
  assert.equal(w.log.some((l) => /^graph (draft|send)/.test(l)), false, 'nothing is made at Outlook while the undo time runs');
  const id = c.getState().outbox[0].id;
  await c.cancelSend(id);
  assert.equal(c.getState().outbox.length, 0);
  assert.equal(c.loadDraft()!.subject, 'Hei');
  await c.send({ account: 'a@outlook.com', kind: 'new', to: ['x@y.no'], cc: [], subject: 'Hei 2', body: 'Tekst' });
  advance(11_000);
  await runTimers();
  assert.deepEqual(w.log.filter((l) => /^graph (draft|send)/.test(l)), ['graph draft Hei 2', 'graph send D1']);
  assert.deepEqual(w.sentMails.map((x) => [x.kind, x.subject, x.to]), [['new', 'Hei 2', ['x@y.no']]]);
  assert.equal(c.getState().outbox.length, 0);
});

test('a queued mail survives closing the app: the next start sends it', async () => {
  const w = world();
  const first = make(w);
  await first.c.init();
  await first.c.send({ account: 'a@outlook.com', kind: 'reply', to: ['x@y.no'], cc: [], subject: 'Re', body: 'Ja', replyTo: 'm9' });
  // new controller on the same store, later
  const c2 = createController({ store: first.store, fetch: w.f, serverUrl: SERVER, now: () => Date.parse('2026-10-05T11:00:00Z'), kv: { get: (k) => first.kv.get(k) ?? null, set: (k, v) => void first.kv.set(k, v), del: (k) => void first.kv.delete(k) }, setTimer: () => 0 });
  await c2.init();
  assert.deepEqual(w.log.filter((l) => /^graph (create|send)/.test(l)), ['graph createReply m9', 'graph send D1']);
  assert.deepEqual(w.sentMails.map((x) => [x.kind, x.replyTo]), [['reply', 'm9']]);
});

test('moving a sender re-sorts all their mail, with an Undo', async () => {
  const w = world(); w.add('1'); w.add('2');
  const { c } = make(w);
  await c.init();
  const t = Date.parse('2026-10-05T10:00:00Z');
  assert.ok(c.getState().mail.every((m) => m.kind === 'person'));
  await c.moveSender('anna@x.no', 'promo');
  assert.ok(c.getState().mail.every((m) => m.kind === 'promo'));
  assert.match(c.getState().toast!.text, /Moved to Promotions/);
  assert.deepEqual([mailCounts(c.getState(), t).byKind.promo.unread, mailCounts(c.getState(), t).byKind.person.unread], [2, 0]);
  c.getState().toast!.undo!();
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(c.getState().mail.every((m) => m.kind === 'person'));
  await c.moveSender('anna@x.no', 'promo');
  await c.moveSender('anna@x.no', null);
  assert.ok(c.getState().mail.every((m) => m.kind === 'person'));
  assert.deepEqual(c.getState().overrides, {});
});

test('moving a whole company moves every sender at that domain, and a shared mail provider is never a company', async () => {
  const w = world(); w.add('1', { from: { emailAddress: { name: 'Ola', address: 'ola@mail.butikk.no' } } }); w.add('2', { from: { emailAddress: { name: 'Kari', address: 'kari@butikk.no' } } }); w.add('3', { from: { emailAddress: { name: 'Per', address: 'per@gmail.com' } } });
  const { c } = make(w);
  await c.init();
  await c.moveSender('ola@mail.butikk.no', 'update', 'company');
  assert.deepEqual(c.getState().overrides, { '@butikk.no': 'update' });
  assert.deepEqual(c.getState().mail.map((m) => [m.id, m.kind]).sort(), [['1', 'update'], ['2', 'update'], ['3', 'person']]);
  assert.match(c.getState().toast!.text, /Everything from butikk\.no/);
  await c.moveSender('per@gmail.com', 'promo', 'company');
  assert.deepEqual(c.getState().overrides, { '@butikk.no': 'update', 'per@gmail.com': 'promo' });
  await c.removeRule('@butikk.no');
  assert.deepEqual(c.getState().mail.map((m) => [m.id, m.kind]).sort(), [['1', 'person'], ['2', 'person'], ['3', 'promo']]);
});

test('older saved choices (newsletter, receipt, alert) are renamed when the app opens, and still apply', async () => {
  const w = world(); w.add('1');
  const { c, store } = make(w);
  await store.setMeta('overrides', { 'anna@x.no': 'newsletter', 'x@y.no': 'receipt', 'z@y.no': 'nonsense' });
  await c.init();
  assert.deepEqual(c.getState().overrides, { 'anna@x.no': 'update', 'x@y.no': 'transaction' });
  assert.deepEqual(await store.getMeta('overrides'), { 'anna@x.no': 'update', 'x@y.no': 'transaction' });
  assert.equal(c.getState().mail[0].kind, 'update');
});

test('the inbox opens on Primary; each tab shows its own mail and its own unread count; nothing is hidden from All', async () => {
  const w = world();
  w.add('1', { subject: 'Middag?' });
  w.add('2', { subject: 'Ukens tilbud', from: { emailAddress: { name: 'Butikk', address: 'tilbud@butikk.no' } } });
  w.add('3', { subject: 'Din kvittering', from: { emailAddress: { name: 'Vipps', address: 'noreply@vipps.no' } }, isRead: true });
  w.headers['2'] = [{ name: 'List-Unsubscribe', value: '<https://u>' }];
  const { c } = make(w);
  await c.init();
  await c.sortInBackground();
  const t = Date.parse('2026-10-05T10:00:00Z');
  const s = c.getState();
  assert.equal(s.view, 'person');
  assert.deepEqual(visibleMail(s, t).map((m) => m.id), ['1']);
  assert.deepEqual(visibleMail({ ...s, view: 'promo' }, t).map((m) => m.id), ['2']);
  assert.deepEqual(visibleMail({ ...s, view: 'transaction' }, t).map((m) => m.id), ['3']);
  assert.deepEqual(visibleMail({ ...s, view: 'all' }, t).map((m) => m.id).sort(), ['1', '2', '3']);
  assert.deepEqual(visibleMail({ ...s, view: 'all', unreadOnly: true }, t).map((m) => m.id).sort(), ['1', '2']);
  const n = mailCounts(s, t);
  assert.deepEqual([n.total, n.unread, n.unsorted], [3, 2, 0]);
  assert.deepEqual(Object.fromEntries(Object.entries(n.byKind).map(([k, v]) => [k, `${v.unread}/${v.total}`])), { person: '1/1', transaction: '0/1', update: '0/0', promo: '1/1' });
  c.setView('promo'); c.setUnreadOnly(true);
  assert.deepEqual([c.getState().view, c.getState().unreadOnly], ['promo', true]);
});

test('mail is first sorted by words, then by its hidden headers in the background, and the screen says so while that runs', async () => {
  const w = world();
  for (let i = 1; i <= 3; i++) { w.add(String(i), { subject: `Nytt ${i}` }); w.headers[String(i)] = [{ name: 'List-Unsubscribe', value: '<https://u>' }]; }
  const { c } = make(w);
  const seen: boolean[] = [];
  c.subscribe(() => { const x = c.getState().sorting; if (seen[seen.length - 1] !== x) seen.push(x); });
  await c.init();
  await c.sortInBackground();
  assert.ok(c.getState().mail.every((m) => m.kind === 'promo' && m.sig?.includes('unsub')));
  assert.deepEqual(seen, [false, true, false], 'sorting switched on while it ran, and off when it was done');
  assert.equal(c.getState().sorting, false);
  // a second look does not ask again
  const asks = () => w.log.filter((l) => l === 'graph delta').length;
  const before = asks();
  await c.sync(); await c.sortInBackground();
  assert.equal(asks(), before + 1);
});

test('sorting runs alongside everything else, and two runs never overlap', async () => {
  const w = world(); w.add('1');
  const { c } = make(w);
  await c.init();
  w.add('2'); w.headers['2'] = [{ name: 'Precedence', value: 'bulk' }];
  const first = c.sortInBackground();
  assert.equal(c.sortInBackground(), first);
  await first;
  assert.equal(c.getState().sorting, false);
});

test('people you have written to are Primary even from a shop-like address; Sent Items is looked at again after six hours', async () => {
  const w = world();
  const at = (address: string) => ({ emailAddress: { name: 'Support', address } });
  w.add('1', { subject: 'Hvordan går det?', from: at('support@shop.no') });
  w.add('2', { subject: 'Hei', from: at('info@firma.no') });
  w.headers['1'] = w.headers['2'] = [{ name: 'X-Mailgun-Sid', value: 'abc' }];
  w.sent.push('Support@Shop.no');
  const { c, advance } = make(w);
  await c.init();
  await c.sortInBackground();
  const kinds = () => Object.fromEntries(c.getState().mail.map((m) => [m.id, m.kind]));
  assert.deepEqual(kinds(), { 1: 'person', 2: 'update' });
  assert.deepEqual(c.getState().mail.find((m) => m.id === '1')!.why, ['You have written to this address']);
  w.sent.push('info@firma.no');
  await c.sync();
  assert.equal(kinds()[2], 'update', 'Sent Items was looked at a moment ago');
  advance(7 * 3_600_000);
  await c.sync();
  assert.deepEqual(kinds(), { 1: 'person', 2: 'person' });
});

test('a message you send makes the recipient known at once', async () => {
  const w = world();
  w.add('1', { subject: 'Hvordan går det?', from: { emailAddress: { name: 'Support', address: 'support@shop.no' } } });
  w.headers['1'] = [{ name: 'X-Mailgun-Sid', value: 'abc' }];
  const { c, advance, runTimers } = make(w);
  await c.init();
  await c.sortInBackground();
  assert.equal(c.getState().mail[0].kind, 'update', 'a mailing service on a role address: not a person');
  await c.send({ account: 'a@outlook.com', kind: 'new', to: ['support@shop.no'], cc: [], subject: 'Hei', body: 'Tekst' });
  advance(11_000);
  await runTimers();
  assert.equal(c.getState().mail[0].kind, 'person');
});

test('a new VIP is always Primary', async () => {
  const w = world();
  w.add('1', { subject: 'Ukens tilbud', from: { emailAddress: { name: 'Butikk', address: 'tilbud@butikk.no' } } });
  w.headers['1'] = [{ name: 'List-Unsubscribe', value: '<https://u>' }];
  const { c } = make(w);
  await c.init();
  await c.sortInBackground();
  assert.equal(c.getState().mail[0].kind, 'promo');
  await c.setAlerts('a@outlook.com', { vips: ['tilbud@butikk.no'] });
  assert.equal(c.getState().mail[0].kind, 'person');
  assert.deepEqual(c.getState().mail[0].why, ['On your VIP list']);
});

test('Clean up archives promotions older than a week, never a flagged one, never another tab, with one Undo', async () => {
  const w = world();
  const shop = { emailAddress: { name: 'Butikk', address: 'tilbud@butikk.no' } };
  w.add('old1', { from: shop, subject: 'Rabatt 50%', receivedDateTime: '2026-09-20T08:00:00Z' });
  w.add('old2', { from: shop, subject: 'Rabatt 40%', receivedDateTime: '2026-09-21T08:00:00Z', isRead: true });
  w.add('flagged', { from: shop, subject: 'Rabatt 30%', receivedDateTime: '2026-09-21T09:00:00Z', flag: { flagStatus: 'flagged' } });
  w.add('fresh', { from: shop, subject: 'Rabatt 20%', receivedDateTime: '2026-10-04T08:00:00Z' });
  w.add('person', { subject: 'Middag?', receivedDateTime: '2026-09-01T08:00:00Z' });
  const { c, advance, runTimers } = make(w);
  await c.init();
  const t = Date.parse('2026-10-05T10:00:00Z');
  assert.deepEqual(cleanUpList(c.getState(), t, 7).map((m) => m.id).sort(), ['old1', 'old2']);
  assert.deepEqual(cleanUpList(c.getState(), t, 0).map((m) => m.id).sort(), ['fresh', 'old1', 'old2']);
  assert.equal(await c.cleanUp(7, t), 2);
  assert.equal(c.getState().toast!.text, 'Archived 2');
  assert.deepEqual(c.getState().mail.map((m) => m.id).sort(), ['flagged', 'fresh', 'person']);
  c.getState().toast!.undo!();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(c.getState().mail.length, 5);
  assert.equal(w.log.some((l) => l.startsWith('graph move')), false, 'nothing reached Outlook');
  assert.equal(await c.cleanUp(7, t), 2);
  advance(7000);
  await runTimers();
  assert.deepEqual(w.log.filter((l) => l.startsWith('graph move')).sort(), ['graph move old1 archive', 'graph move old2 archive']);
  assert.equal(await c.cleanUp(7, t), 0, 'nothing left to clean');
});

test('mark many as read: one toast, each one goes to Outlook', async () => {
  const w = world(); w.add('1'); w.add('2'); w.add('3', { isRead: true });
  const { c } = make(w);
  await c.init();
  await c.markRead(c.getState().mail);
  assert.equal(c.getState().toast!.text, 'Marked 2 as read');
  assert.ok(c.getState().mail.every((m) => m.isRead));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(w.log.filter((l) => l.includes('"isRead":true')).length, 2);
});

test('search: local first, then older mail from Outlook, without duplicates', async () => {
  const w = world(); w.add('1', { subject: 'Faktura oktober' });
  const { c } = make(w);
  await c.init();
  assert.equal(c.searchLocal('faktura').length, 1);
  const remote = await c.searchRemote('faktura');
  assert.deepEqual(remote.map((m) => m.id), ['old1']);
});

test('opening a message fetches the body once and keeps it for offline', async () => {
  const w = world(); w.add('1');
  const { c } = make(w);
  await c.init();
  const m = c.getState().mail[0];
  const b = await c.openBody(m);
  assert.equal(b.contentType, 'html');
  await c.openBody(m);
  assert.equal(w.log.filter((l) => l === 'graph body').length, 1);
});

test('bad saved sessions or settings never stop the app opening', async () => {
  const w = world();
  const { c, kv } = make(w);
  kv.set('post.sessions', '{nonsense'); kv.set('post.settings', 'null');
  await c.init();
  assert.equal(c.getState().accounts.length, 0);
  assert.equal(c.getState().ready, true);
});

test('without a Post server address the app says so instead of failing', async () => {
  const { c } = make(world(), { serverUrl: null });
  await c.init();
  assert.equal(c.getState().serverReady, false);
  await assert.rejects(() => c.startSignIn('https://x/post/'), /does not know where your Post server/);
});

// ---- files: seeing and sending ------------------------------------------------------------------------------------------------------------

const out = (name: string, size: number, type = 'application/pdf') => ({ name, type, bytes: new Uint8Array(size).fill(66) });
const settle = (ms = 10) => new Promise<void>((r) => setTimeout(r, ms));
/** What is waiting in the outbox right now, by subject (the screen's copy is refreshed by the caller of a run). */
const queued = async (store: ReturnType<typeof memoryStore>) => ((await store.getMeta<{ subject: string }[]>('outbox')) ?? []).map((x) => x.subject);

/** Drafts, attachments and upload addresses, in front of the ordinary world. */
function fileWorld(w: ReturnType<typeof world>) {
  const flags = { listFails: false, valueFails: false, jsonFails: false };
  const listings = new Map<string, any[]>();                                  // message id -> what the attachment list says
  const content = new Map<string, { bytes: Uint8Array; type: string }>();     // `${message}/${attachment}` -> the file
  const bodies = new Map<string, { html: string; hasAttachments: boolean }>();
  const calls: string[] = [];
  const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });
  const f = (async (url: string, init: RequestInit = {}) => {
    if (w.flags.offline) throw new Error('offline');
    const u = String(url);
    const method = init.method ?? 'GET';
    const path = u.replace('https://graph.microsoft.com/v1.0', '');
    let m: RegExpExecArray | null;
    if (method === 'GET' && (m = /^\/me\/messages\/([^/?]+)\?\$select=body/.exec(path))) {
      const b = bodies.get(decodeURIComponent(m[1]));
      if (b) { w.log.push('graph body'); return json({ body: { contentType: 'html', content: b.html }, toRecipients: [], hasAttachments: b.hasAttachments }); }
    }
    if (method === 'GET' && (m = /^\/me\/messages\/([^/]+)\/attachments\?/.exec(path)) && !w.drafts.has(decodeURIComponent(m[1]))) {
      calls.push(`list ${decodeURIComponent(m[1])}`);
      return flags.listFails ? json({ error: { code: 'ErrorInvalidProperty', message: 'Could not find a property named contentId' } }, 400) : json({ value: listings.get(decodeURIComponent(m[1])) ?? [] });
    }
    if (method === 'GET' && (m = /^\/me\/messages\/([^/]+)\/attachments\/([^/]+)\/\$value$/.exec(path))) {
      calls.push(`value ${decodeURIComponent(m[2])}`);
      const c = content.get(`${decodeURIComponent(m[1])}/${decodeURIComponent(m[2])}`);
      return flags.valueFails || !c ? json({ error: { code: 'ErrorInternalServerError', message: 'boom' } }, 500) : new Response(c.bytes as BodyInit, { status: 200, headers: { 'Content-Type': c.type } });
    }
    if (method === 'GET' && (m = /^\/me\/messages\/([^/]+)\/attachments\/([^/]+)$/.exec(path))) {
      calls.push(`json ${decodeURIComponent(m[2])}`);
      const c = content.get(`${decodeURIComponent(m[1])}/${decodeURIComponent(m[2])}`);
      if (flags.jsonFails || !c) return json({ error: { code: 'ErrorItemNotFound', message: 'gone' } }, 404);
      let bin = ''; c.bytes.forEach((b) => { bin += String.fromCharCode(b); });
      return json({ name: 'from-json.pdf', contentType: c.type, contentBytes: btoa(bin), contentId: '<Logo@1>' });
    }
    return w.f(url, init);
  }) as typeof fetch;
  return { f, flags, listings, content, bodies, calls };
}

const att = (id: string, name: string, over: Record<string, unknown> = {}) => ({ '@odata.type': '#microsoft.graph.fileAttachment', id, name, size: 100, contentType: 'application/pdf', isInline: false, ...over });

test('files: opening a message lists what is attached, once, and keeps the list for offline', async () => {
  const w = world(); w.add('1', { hasAttachments: true });
  const fw = fileWorld(w);
  fw.listings.set('1', [att('a1', 'Kontrakt.pdf'), att('a2', 'Re: hei', { '@odata.type': '#microsoft.graph.itemAttachment' })]);
  fw.bodies.set('1', { html: '<p>Se vedlagt</p>', hasAttachments: true });
  const { c } = make(w, { fetch: fw.f });
  await c.init();
  const m = c.getState().mail[0];
  const b = await c.openBody(m);
  assert.deepEqual(b.attachments.map((a) => [a.name, a.kind]), [['Kontrakt.pdf', 'file'], ['Re: hei', 'item']]);
  assert.equal(b.listed, true);
  await c.openBody(m);
  assert.deepEqual(fw.calls.filter((x) => x.startsWith('list')), ['list 1']);
});

test('files: when the list cannot be read the text still shows, and the next time the message is opened it is asked for again', async () => {
  const w = world(); w.add('1', { hasAttachments: true });
  const fw = fileWorld(w);
  fw.listings.set('1', [att('a1', 'Kontrakt.pdf')]);
  fw.bodies.set('1', { html: '<p>Se vedlagt</p>', hasAttachments: true });
  fw.flags.listFails = true;
  const { c, store } = make(w, { fetch: fw.f });
  await c.init();
  const m = c.getState().mail[0];
  const first = await c.openBody(m);
  assert.equal(first.content, '<p>Se vedlagt</p>');
  assert.equal(first.attachmentsFailed, true);
  assert.equal((await store.getBody(m.key))!.attachmentsFailed, true, 'saved, but marked, so it is not mistaken for "no files"');
  fw.flags.listFails = false;
  const again = await c.openBody(m);
  assert.deepEqual(again.attachments.map((a) => a.name), ['Kontrakt.pdf']);
  assert.equal(again.attachmentsFailed, false);
  assert.equal(w.log.filter((l) => l === 'graph body').length, 1, 'the text was not fetched twice');
});

test('files: a message saved by an older version without its files gets them the next time it is opened', async () => {
  const w = world(); w.add('1', { hasAttachments: true });
  const fw = fileWorld(w);
  fw.listings.set('1', [att('a1', 'Kontrakt.pdf')]);
  const { c, store } = make(w, { fetch: fw.f });
  await c.init();
  const m = c.getState().mail[0];
  await store.putBody({ key: m.key, contentType: 'html', content: '<p>Hei</p>', to: [], cc: [], attachments: [] }); // what the old version saved
  const b = await c.openBody(m);
  assert.deepEqual(b.attachments.map((a) => a.name), ['Kontrakt.pdf']);
});

test('files: pictures inside a message are found even though Outlook says "no attachments"', async () => {
  const w = world(); w.add('1', { hasAttachments: false });
  const fw = fileWorld(w);
  fw.listings.set('1', [att('p1', 'logo.png', { isInline: true, contentType: 'image/png' })]);
  fw.bodies.set('1', { html: '<img src="cid:logo@1">', hasAttachments: false });
  const { c } = make(w, { fetch: fw.f });
  await c.init();
  const b = await c.openBody(c.getState().mail[0]);
  assert.deepEqual(b.attachments.map((a) => [a.name, a.inline]), [['logo.png', true]]);
});

test('files: the list is asked for even when Outlook says there are no attachments (Apple Mail marks its files as part of the text)', async () => {
  const w = world(); w.add('1', { hasAttachments: false });
  const fw = fileWorld(w);
  fw.listings.set('1', [att('p1', 'Kontrakt.pdf', { isInline: true })]);
  const { c } = make(w, { fetch: fw.f });
  await c.init();
  const b = await c.openBody(c.getState().mail[0]);
  assert.deepEqual(b.attachments.map((a) => [a.name, a.inline]), [['Kontrakt.pdf', true]]);
  assert.equal(b.listed, true);
});

test('files: a message with nothing attached has an empty list, which is kept', async () => {
  const w = world(); w.add('1');
  const fw = fileWorld(w);
  const { c } = make(w, { fetch: fw.f });
  await c.init();
  const m = c.getState().mail[0];
  assert.deepEqual((await c.openBody(m)).attachments, []);
  await c.openBody(m);
  assert.deepEqual(fw.calls, ['list 1'], 'asked once, then remembered');
});

test('files: an attachment is fetched as the raw file, once, and opening it again costs nothing', async () => {
  const w = world(); w.add('1', { hasAttachments: true });
  const fw = fileWorld(w);
  fw.content.set('1/a1', { bytes: new Uint8Array([1, 2, 3, 4]), type: 'application/octet-stream' });
  const { c } = make(w, { fetch: fw.f });
  await c.init();
  const m = c.getState().mail[0];
  const ref = { id: 'a1', name: 'Kontrakt.PDF', size: 4, contentType: 'application/octet-stream', inline: false };
  const [x, y] = await Promise.all([c.openAttachment(m, ref), c.openAttachment(m, ref)]); // tapped twice at once
  assert.deepEqual([...x.bytes], [1, 2, 3, 4]);
  assert.equal(x.type, 'application/pdf', 'the name says pdf even though Outlook did not');
  assert.equal(x.name, 'Kontrakt.PDF');
  assert.equal(y, x);
  await c.openAttachment(m, ref);
  assert.deepEqual(fw.calls, ['value a1']);
});

test('files: if the raw route fails the older route is tried, and if both fail the first reason is given', async () => {
  const w = world(); w.add('1', { hasAttachments: true });
  const fw = fileWorld(w);
  fw.content.set('1/a1', { bytes: new Uint8Array([9, 8, 7]), type: 'application/pdf' });
  fw.flags.valueFails = true;
  const { c } = make(w, { fetch: fw.f });
  await c.init();
  const m = c.getState().mail[0];
  const ref = { id: 'a1', name: 'k.pdf', size: 3, contentType: 'application/pdf', inline: false };
  const got = await c.openAttachment(m, ref);
  assert.deepEqual([...got.bytes], [9, 8, 7]);
  assert.deepEqual(fw.calls, ['value a1', 'json a1']);
  fw.flags.jsonFails = true;
  await assert.rejects(() => c.openAttachment(m, { ...ref, id: 'a2' }), /boom/);
});

test('files: an attached message is saved as an .eml, without trying the file route, and a cloud link gives its address', async () => {
  const w = world(); w.add('1', { hasAttachments: true });
  const fw = fileWorld(w);
  fw.content.set('1/i1', { bytes: new TextEncoder().encode('From: a@b.no\r\n\r\nhei'), type: 'message/rfc822' });
  const { c } = make(w, { fetch: fw.f });
  await c.init();
  const m = c.getState().mail[0];
  const item = await c.openAttachment(m, { id: 'i1', name: 'Re: hei', size: 40, contentType: '', inline: false, kind: 'item' });
  assert.equal(item.name, 'Re_ hei.eml');
  assert.equal(item.type, 'message/rfc822');
  // a link attachment has no bytes: the JSON route says where it lives
  const w2 = world(); w2.add('1', { hasAttachments: true });
  const fw2 = fileWorld(w2);
  const base = fw2.f;
  const link = (async (url: string, init?: RequestInit) => /attachments\/l1$/.test(String(url)) ? new Response(JSON.stringify({ name: 'Sky.docx', contentType: 'text/html', contentBytes: '', sourceUrl: 'https://x.sharepoint.com/f' })) : base(url as string, init)) as typeof fetch;
  const b = make(w2, { fetch: link });
  await b.c.init();
  const l = await b.c.openAttachment(b.c.getState().mail[0], { id: 'l1', name: 'Sky.docx', size: 0, contentType: '', inline: false, kind: 'link' });
  assert.equal(l.link, 'https://x.sharepoint.com/f');
  assert.equal(l.bytes.byteLength, 0);
});

test('files: a message with files waits in the outbox with its files, and leaves with them after the undo window', async () => {
  const w = world();
  const fw = fileWorld(w);
  const { c, store, advance, runTimers } = make(w, { fetch: fw.f });
  await c.init();
  assert.equal(await c.send({ account: 'a@outlook.com', kind: 'new', to: ['x@y.no'], cc: [], subject: 'Kontrakt', body: 'Se vedlagt' }, [out('a.pdf', 1000)]), true);
  const it = c.getState().outbox[0];
  assert.deepEqual(it.files, [{ name: 'a.pdf', type: 'application/pdf', size: 1000 }]);
  const key = `a@outlook.com|outfile|${it.id}|0`;
  assert.equal(((await store.getMeta<Uint8Array>(key)) as Uint8Array).byteLength, 1000);
  assert.equal(w.sentMails.length, 0);
  advance(11_000); await runTimers();
  assert.deepEqual(w.sentMails.map((x) => [x.subject, (x.attachments ?? []).map((a: any) => a.name)]), [['Kontrakt', ['a.pdf']]]);
  assert.equal(await store.getMeta(key), undefined, 'the copy kept for sending is gone once it has gone');
  assert.equal(c.getState().outbox.length, 0);
});

test('files: Undo gives the message back with its files and sends nothing', async () => {
  const w = world();
  const fw = fileWorld(w);
  const { c, store, advance, runTimers } = make(w, { fetch: fw.f });
  await c.init();
  await c.send({ account: 'a@outlook.com', kind: 'new', to: ['x@y.no'], cc: [], subject: 'Kontrakt', body: 'Se vedlagt' }, [out('a.pdf', 1000), out('b.png', 20, 'image/png')]);
  const it = c.getState().outbox[0];
  await c.cancelSend(it.id);
  assert.equal(c.getState().outbox.length, 0);
  assert.equal(c.loadDraft()!.subject, 'Kontrakt');
  assert.deepEqual((await c.loadDraftFiles()).map((f) => [f.name, f.bytes.byteLength]), [['a.pdf', 1000], ['b.png', 20]]);
  assert.equal(await store.getMeta(`a@outlook.com|outfile|${it.id}|0`), undefined);
  assert.match(c.getState().toast!.text, /and its files are back in the editor/);
  advance(20_000); await runTimers();
  assert.equal(w.sentMails.length, 0);
});

test('files: Undo too late (the time has run out) does not take the message back', async () => {
  const w = world();
  const { c, advance } = make(w);
  await c.init();
  await c.send({ account: 'a@outlook.com', kind: 'new', to: ['x@y.no'], cc: [], subject: 'Hei', body: 'x' });
  const id = c.getState().outbox[0].id;
  advance(11_000);
  await c.cancelSend(id);
  assert.equal(c.getState().outbox.length, 1);
  assert.match(c.getState().toast!.text, /Too late/);
});

test('files: the draft keeps its files until it is sent or thrown away', async () => {
  const { c } = make();
  await c.init();
  assert.deepEqual(await c.loadDraftFiles(), []);
  assert.equal(await c.saveDraftFiles([out('a.pdf', 5)]), true);
  assert.deepEqual((await c.loadDraftFiles()).map((f) => f.name), ['a.pdf']);
  c.saveDraft({ account: 'a@outlook.com', to: 'x@y.no', cc: '', subject: 's', body: 'b', mode: 'new' });
  assert.deepEqual((await c.loadDraftFiles()).map((f) => f.name), ['a.pdf'], 'saving the text again does not touch the files');
  c.saveDraft(null);
  await settle();
  assert.deepEqual(await c.loadDraftFiles(), []);
});

test('files: several files go onto a draft one by one, and the draft is sent', async () => {
  const w = world();
  const fw = fileWorld(w);
  const { c, advance, runTimers } = make(w, { fetch: fw.f });
  await c.init();
  await c.send({ account: 'a@outlook.com', kind: 'new', to: ['x@y.no'], cc: [], subject: 'To filer', body: 'x' }, [out('a.pdf', 1_600_000), out('b.pdf', 1_600_000)]);
  advance(11_000); await runTimers();
  assert.deepEqual(w.log.filter((l) => /^graph (draft|attach|send|sendMail)/.test(l)), ['graph draft To filer', 'graph attach D1 a.pdf', 'graph attach D1 b.pdf', 'graph send D1']);
  assert.deepEqual(w.sentMails.map((x) => x.attachments.map((a) => a.name)), [['a.pdf', 'b.pdf']], 'sent once, with both files on it');
});

test('files: a big file goes up in slices, then the draft is sent', async () => {
  const w = world();
  const fw = fileWorld(w);
  const { c, advance, runTimers } = make(w, { fetch: fw.f });
  await c.init();
  await c.send({ account: 'a@outlook.com', kind: 'new', to: ['x@y.no'], cc: [], subject: 'Stor', body: 'x' }, [out('stor.pdf', 7_000_000)]);
  advance(11_000); await runTimers();
  assert.deepEqual(w.log.filter((l) => /^(graph (draft|session|send)|upload)/.test(l)), ['graph draft Stor', 'graph session D1 stor.pdf 7000000', 'upload bytes 0-3276799/7000000', 'upload bytes 3276800-6553599/7000000', 'upload bytes 6553600-6999999/7000000', 'graph send D1']);
  assert.equal(c.getState().outbox.length, 0);
});

test('files: a reply, a reply to all and a forward are made from the original (so the conversation is kept), with or without files', async () => {
  const w = world();
  const fw = fileWorld(w);
  const { c, advance, runTimers } = make(w, { fetch: fw.f });
  await c.init();
  await c.send({ account: 'a@outlook.com', kind: 'reply', to: ['x@y.no'], cc: [], subject: 'Re', body: 'Her', replyTo: 'm1' }, [out('a.pdf', 10)]);
  await c.send({ account: 'a@outlook.com', kind: 'replyAll', to: ['x@y.no'], cc: [], subject: 'Re', body: 'Her', replyTo: 'm2' }, [out('b.pdf', 10)]);
  await c.send({ account: 'a@outlook.com', kind: 'forward', to: ['z@y.no'], cc: [], subject: 'Fwd', body: 'Se', replyTo: 'm3' }, [out('c.pdf', 10)]);
  await c.send({ account: 'a@outlook.com', kind: 'reply', to: ['x@y.no'], cc: [], subject: 'Re', body: 'Uten', replyTo: 'm4' });
  advance(11_000); await runTimers();
  assert.deepEqual(w.log.filter((l) => /^graph (create|reply|forward|attach|send D)/.test(l)), [
    'graph createReply m1', 'graph attach D1 a.pdf', 'graph send D1',
    'graph createReplyAll m2', 'graph attach D2 b.pdf', 'graph send D2',
    'graph createForward m3', 'graph attach D3 c.pdf', 'graph send D3',
    'graph createReply m4', 'graph send D4',
  ]);
});

test('files: Outlook refusing the message for good hands it back, with its files, and says why', async () => {
  const w = world();
  const fw = fileWorld(w);
  w.flags.sendStatus = 413;
  const { c, store, advance } = make(w, { fetch: fw.f });
  await c.init();
  await c.send({ account: 'a@outlook.com', kind: 'new', to: ['x@y.no'], cc: [], subject: 'For stor', body: 'x' }, [out('a.pdf', 1_600_000), out('b.pdf', 1_600_000)]);
  const id = c.getState().outbox[0].id;
  advance(11_000); await c.flushOutbox();
  assert.deepEqual(await queued(store), []);
  assert.equal(c.loadDraft()!.subject, 'For stor');
  assert.deepEqual((await c.loadDraftFiles()).map((f) => f.name), ['a.pdf', 'b.pdf']);
  assert.match(c.getState().toast!.text, /Could not send: The message is too large\. Your message and its files are saved as a draft\./);
  assert.ok(w.log.includes('graph delete D1'), 'the half-made draft in Outlook was removed');
  assert.equal(await store.getMeta(`a@outlook.com|outfile|${id}|0`), undefined);
});

test('files: a message that keeps failing is tried three times, then handed back; time offline does not count', async () => {
  const w = world();
  const fw = fileWorld(w);
  w.flags.sendStatus = 500;
  const { c, store, advance } = make(w, { fetch: fw.f });
  await c.init();
  await c.send({ account: 'a@outlook.com', kind: 'new', to: ['x@y.no'], cc: [], subject: 'Treg', body: 'x' }, [out('a.pdf', 1_600_000), out('b.pdf', 1_600_000)]);
  const tries = async () => ((await store.getMeta<{ attempts?: number }[]>('outbox')) ?? [])[0]?.attempts;
  advance(11_000); await c.flushOutbox();
  assert.equal(await tries(), 1);
  assert.match(c.getState().toast!.text, /Not sent yet/);
  w.flags.offline = true;
  await c.sync();                          // offline: this is noticed, and the next tries do not count
  await c.flushOutbox();
  assert.equal(await tries(), 1);
  w.flags.offline = false;
  await c.flushOutbox();
  assert.equal(await tries(), 2);
  await c.flushOutbox();
  assert.deepEqual(await queued(store), []);
  assert.equal(c.loadDraft()!.subject, 'Treg');
  assert.deepEqual((await c.loadDraftFiles()).map((f) => f.name), ['a.pdf', 'b.pdf']);
  assert.match(c.getState().toast!.text, /Could not send: .*saved as a draft/);
});

test('files: a plain message that fails for a passing reason is still kept and tried again, as before', async () => {
  const w = world();
  const fw = fileWorld(w);
  w.flags.sendStatus = 500;
  const { c, store, advance } = make(w, { fetch: fw.f });
  await c.init();
  await c.send({ account: 'a@outlook.com', kind: 'new', to: ['x@y.no'], cc: [], subject: 'Vanlig', body: 'x' });
  advance(11_000);
  for (let i = 0; i < 6; i++) await c.flushOutbox();
  assert.deepEqual(await queued(store), ['Vanlig']);
  w.flags.sendStatus = 202;
  await c.flushOutbox();
  assert.deepEqual(await queued(store), []);
});

test('files: a file that has gone missing from the phone hands the rest back instead of sending a message without it', async () => {
  const w = world();
  const fw = fileWorld(w);
  const { c, store, advance } = make(w, { fetch: fw.f });
  await c.init();
  await c.send({ account: 'a@outlook.com', kind: 'new', to: ['x@y.no'], cc: [], subject: 'Mangler', body: 'x' }, [out('a.pdf', 100), out('b.pdf', 100)]);
  const id = c.getState().outbox[0].id;
  await store.setMeta(`a@outlook.com|outfile|${id}|0`, undefined);
  advance(11_000); await c.flushOutbox();
  assert.equal(w.sentMails.length, 0);
  assert.match(c.getState().toast!.text, /a\.pdf is no longer stored on this phone/);
  assert.deepEqual((await c.loadDraftFiles()).map((f) => f.name), ['b.pdf']);
  assert.deepEqual(await queued(store), []);
});

test('files: if the phone will not keep the files, nothing is queued and the message stays in the editor', async () => {
  const w = world();
  const inner = memoryStore();
  const store = { ...inner, async setMeta(k: string, v: unknown) { if (k.includes('|outfile|') && v !== undefined) throw new Error('QuotaExceededError'); return inner.setMeta(k, v); } };
  const { c } = make(w, { store });
  await c.init();
  assert.equal(await c.send({ account: 'a@outlook.com', kind: 'new', to: ['x@y.no'], cc: [], subject: 'Hei', body: 'x' }, [out('a.pdf', 100)]), false);
  assert.equal(c.getState().outbox.length, 0);
  assert.match(c.getState().toast!.text, /nothing was sent/);
});

test('files: two runs at once never send the same message twice', async () => {
  const w = world();
  const fw = fileWorld(w);
  let open!: () => void;
  w.flags.gate = new Promise<void>((r) => { open = r; });
  const { c, store, advance } = make(w, { fetch: fw.f });
  await c.init();
  await c.send({ account: 'a@outlook.com', kind: 'new', to: ['x@y.no'], cc: [], subject: 'En gang', body: 'x' }, [out('a.pdf', 100)]);
  advance(11_000);
  const a = c.flushOutbox();
  const b = c.flushOutbox();   // a sync, or the timer, arriving while the first is still sending
  await settle(20);
  open();
  await Promise.all([a, b]);
  assert.equal(w.sentMails.length, 1);
  assert.deepEqual(await queued(store), []);
});

test('files: Undo on one message while another is being sent is respected', async () => {
  const w = world();
  const fw = fileWorld(w);
  let open!: () => void;
  w.flags.gate = new Promise<void>((r) => { open = r; });
  const { c, store, advance } = make(w, { fetch: fw.f });
  await c.init();
  await c.send({ account: 'a@outlook.com', kind: 'new', to: ['x@y.no'], cc: [], subject: 'Først', body: 'x' });
  advance(11_000);
  await c.send({ account: 'a@outlook.com', kind: 'new', to: ['x@y.no'], cc: [], subject: 'Så', body: 'y' });
  const later = c.getState().outbox.find((x) => x.subject === 'Så')!;
  const running = c.flushOutbox();                // sends "Først" and waits at the gate
  await settle(20);
  await c.cancelSend(later.id);                   // the person taps Undo on the second one meanwhile
  open();
  await running;
  assert.deepEqual(w.sentMails.map((x) => x.subject), ['Først']);
  assert.deepEqual(await queued(store), [], 'the second one did not come back');
  assert.equal(c.loadDraft()!.subject, 'Så');
});

test('files: removing a mailbox also removes its waiting messages and their files', async () => {
  const w = world();
  const fw = fileWorld(w);
  const { c, store } = make(w, { fetch: fw.f });
  await c.init();
  await c.send({ account: 'a@outlook.com', kind: 'new', to: ['x@y.no'], cc: [], subject: 'Hei', body: 'x' }, [out('a.pdf', 100)]);
  const id = c.getState().outbox[0].id;
  await c.removeAccount('a@outlook.com');
  assert.deepEqual(await store.getMeta('outbox'), []);
  assert.equal(await store.getMeta(`a@outlook.com|outfile|${id}|0`), undefined);
});

// ---- conversations --------------------------------------------------------------------------------------------------------------------------

const T0 = Date.parse('2026-10-05T10:00:00Z');
const ME = 'a@outlook.com';
/** One conversation in the inbox of the fake mailbox: `n` messages, the first from the oldest. */
function chat(w: ReturnType<typeof world>, conv: string, ids: string[], o: Record<string, unknown> = {}) {
  ids.forEach((id, i) => w.add(id, { conversationId: conv, subject: 'Ferie', receivedDateTime: `2026-10-05T0${1 + i}:00:00Z`, ...o }));
}
/** A message of Outlook that is not in the inbox: it is in the conversation lookup only. */
const elsewhere = (id: string, o: Record<string, unknown> = {}) => ({ id, conversationId: 'C1', subject: 'Re: Ferie', receivedDateTime: '2026-10-05T05:30:00Z', from: { emailAddress: { name: 'Meg', address: ME } }, isRead: true, bodyPreview: 'svar', parentFolderId: 'F-sentitems', isDraft: false, ...o });

test('conversations: messages that answer each other are one row, in the tab of the newest, counted once', async () => {
  const w = world();
  chat(w, 'C1', ['1', '2', '3'], { isRead: true });
  w.add('2', { conversationId: 'C1', subject: 'Ferie', receivedDateTime: '2026-10-05T02:00:00Z', isRead: false });
  w.add('9', { conversationId: 'C9', subject: 'Middag?', receivedDateTime: '2026-10-05T04:00:00Z', isRead: false });
  const { c } = make(w);
  await c.init();
  const s = c.getState();
  const rows = visibleThreads(s, T0);
  assert.deepEqual(rows.map((t) => [t.latest.id, t.items.map((m) => m.id), t.unread]), [['9', ['9'], 1], ['3', ['3', '2', '1'], 1]]);
  const n = mailCounts(s, T0);
  assert.deepEqual([n.total, n.unread, n.byKind.person.total, n.byKind.person.unread], [2, 2, 2, 2]);
  assert.deepEqual(visibleThreads({ ...s, unreadOnly: true }, T0).map((t) => t.latest.id), ['9', '3'], 'a conversation with anything unread in it is unread');
  assert.deepEqual(visibleThreads({ ...s, settings: { ...s.settings, threads: false } }, T0).map((t) => t.latest.id), ['9', '3', '2', '1'], 'conversations off: a row for each message, as before');
  assert.equal(mailCounts({ ...s, settings: { ...s.settings, threads: false } }, T0).total, 4);
});

test('conversations: the tab filter, the mailbox filter and the snooze work on the whole conversation', async () => {
  const w = world();
  const shop = { emailAddress: { name: 'Butikk', address: 'tilbud@butikk.no' } };
  chat(w, 'C1', ['1', '2']);
  chat(w, 'C2', ['s1', 's2'], { from: shop, subject: 'Rabatt' });
  w.headers['s1'] = w.headers['s2'] = [{ name: 'List-Unsubscribe', value: '<https://u>' }];
  const { c } = make(w);
  await c.init();
  await c.sortInBackground();
  const s = c.getState();
  assert.deepEqual(visibleThreads({ ...s, view: 'promo' }, T0).map((t) => t.items.length), [2]);
  assert.deepEqual(visibleThreads({ ...s, view: 'person' }, T0).map((t) => t.items.length), [2]);
  assert.deepEqual(visibleThreads({ ...s, view: 'all', accountFilter: 'nobody@x.no' }, T0), []);
  // snoozed: the row goes while its newest message is snoozed
  await c.snooze(c.threadOf(s.mail.find((m) => m.id === '2')!), new Date('2026-10-06T08:00:00Z'), 'tomorrow');
  assert.equal(c.getState().toast!.text, 'Snoozed until tomorrow');
  assert.deepEqual(visibleThreads({ ...c.getState(), view: 'person' }, T0), []);
  assert.deepEqual(snoozedThreads(c.getState(), T0).map((t) => t.items.length), [2], 'one row in Later, not one for each message');
  assert.equal(visibleThreads({ ...c.getState(), view: 'person' }, Date.parse('2026-10-06T09:00:00Z')).length, 1, 'back at its time');
  // ... and one Undo brings back the lot
  c.getState().toast!.undo!();
  await settle();
  assert.equal(visibleThreads({ ...c.getState(), view: 'person' }, T0).length, 1);
  assert.deepEqual(snoozedThreads(c.getState(), T0), []);
});

test('conversations: a new answer brings a snoozed conversation back', async () => {
  const w = world();
  chat(w, 'C1', ['1', '2']);
  const { c } = make(w);
  await c.init();
  await c.snooze(c.getState().mail, new Date('2026-10-06T08:00:00Z'), 'tomorrow');
  assert.equal(visibleThreads(c.getState(), T0).length, 0);
  w.add('3', { conversationId: 'C1', subject: 'Re: Ferie', receivedDateTime: '2026-10-05T09:00:00Z' });
  await c.sync();
  const rows = visibleThreads(c.getState(), T0);
  assert.deepEqual(rows.map((t) => t.items.map((m) => m.id)), [['3', '2', '1']], 'the new message is not snoozed, so the conversation is back with all its messages');
});

test('conversations: archiving a conversation moves every message of it, with one toast and one Undo', async () => {
  const w = world();
  chat(w, 'C1', ['1', '2', '3']);
  w.add('9', { conversationId: 'C9', receivedDateTime: '2026-10-05T06:00:00Z' });
  const { c, advance, runTimers } = make(w);
  await c.init();
  const rows = visibleThreads(c.getState(), T0);
  await c.archive(rows[1].items, 1);
  assert.equal(c.getState().toast!.text, 'Archived', 'one row, so the toast does not say 3');
  assert.deepEqual(c.getState().mail.map((m) => m.id), ['9']);
  c.getState().toast!.undo!();
  await settle();
  assert.equal(c.getState().mail.length, 4);
  assert.equal(w.log.some((l) => l.startsWith('graph move')), false);
  await c.archive(visibleThreads(c.getState(), T0).flatMap((t) => t.items), 2);
  assert.equal(c.getState().toast!.text, 'Archived 2', 'two rows');
  advance(7000);
  await runTimers();
  assert.deepEqual(w.log.filter((l) => l.startsWith('graph move')).sort(), ['graph move 1 archive', 'graph move 2 archive', 'graph move 3 archive', 'graph move 9 archive']);
});

test('conversations: read, unread and flag act on the whole conversation, and never bring an archived message back', async () => {
  const w = world();
  chat(w, 'C1', ['1', '2', '3']);
  const { c } = make(w);
  await c.init();
  const all = () => c.getState().mail;
  assert.ok(all().every((m) => !m.isRead));
  const stale = [...all()];
  // 2 is archived (still in `stale`), then the conversation is marked read from the old list
  await c.archive([all().find((m) => m.id === '2')!]);
  await c.markRead(stale, { quiet: true });
  assert.deepEqual(all().map((m) => [m.id, m.isRead]).sort(), [['1', true], ['3', true]], 'the archived one is not brought back');
  assert.equal(c.getState().toast!.text, 'Archived', 'and a quiet mark says nothing');
  // all read: toggling makes the newest unread; anything unread: toggling reads the lot
  const rows = () => visibleThreads(c.getState(), T0)[0].items;
  await c.toggleRead(rows());
  assert.deepEqual(rows().map((m) => m.isRead), [false, true]);
  await c.toggleRead(rows());
  assert.deepEqual(rows().map((m) => m.isRead), [true, true]);
  // flag: the newest message is flagged; flagging again takes every flag off
  await c.toggleFlag(rows());
  assert.deepEqual(rows().map((m) => m.flagged), [true, false]);
  assert.deepEqual(replyLaterThreads(c.getState(), T0).map((t) => t.items.length), [2]);
  await settle(20); // the flag reaches Outlook before it is taken off (taken off within a moment, only the last choice would be sent)
  await c.toggleFlag(rows());
  assert.deepEqual(rows().map((m) => m.flagged), [false, false]);
  assert.deepEqual(replyLaterThreads(c.getState(), T0), []);
  await settle(20);
  assert.ok(w.log.some((l) => l.includes('graph patch 3 {"flag":{"flagStatus":"flagged"}}')));
  assert.ok(w.log.some((l) => l.includes('graph patch 3 {"flag":{"flagStatus":"notFlagged"}}')));
});

test('conversations: "answer later" flags the newest message and marks the conversation read, and keeps both', async () => {
  const w = world();
  chat(w, 'C1', ['1', '2']);
  const { c } = make(w);
  await c.init();
  await c.replyLater(visibleThreads(c.getState(), T0)[0].items);
  assert.deepEqual(c.getState().mail.map((m) => [m.id, m.isRead, m.flagged]).sort(), [['1', true, false], ['2', true, true]]);
});

test('read and flag started at the same moment both stick (neither overwrites the other)', async () => {
  const w = world(); w.add('1');
  const { c } = make(w);
  await c.init();
  const m = c.getState().mail[0];
  await Promise.all([c.setFlag(m, true), c.setRead(m, true), c.snooze(m, new Date('2026-10-06T08:00:00Z'), 'tomorrow')]);
  const x = c.getState().mail[0];
  assert.deepEqual([x.flagged, x.isRead, !!x.snoozedUntil], [true, true, true]);
});

test('read and flag leave a message that is not on the phone alone', async () => {
  const w = world(); w.add('1');
  const { c, store } = make(w);
  await c.init();
  const gone = { ...c.getState().mail[0], key: 'a@outlook.com|elsewhere', id: 'elsewhere' };
  await c.setRead(gone, true); await c.setFlag(gone, true); await c.snooze(gone, new Date('2026-10-06T08:00:00Z'), 'x');
  assert.equal(await store.getMail(gone.key), undefined);
  assert.equal(c.getState().mail.length, 1);
});

test('conversations: the rest of a conversation comes from Outlook: your replies and archived mail, never drafts, deleted or junk, and nothing already here', async () => {
  const w = world();
  chat(w, 'C1', ['1', '2']);
  w.convo.set('C1', [
    ...[...w.inbox.values()].filter((m) => m.conversationId === 'C1').map((m) => ({ ...m, parentFolderId: 'F-inbox' })),
    elsewhere('sent1'),
    elsewhere('arch1', { receivedDateTime: '2026-10-05T00:30:00Z', parentFolderId: 'F-archive', from: { emailAddress: { name: 'Anna', address: 'anna@x.no' } } }),
    elsewhere('draft1', { isDraft: true, parentFolderId: 'F-drafts' }),
    elsewhere('bin1', { parentFolderId: 'F-deleteditems' }),
    elsewhere('junk1', { parentFolderId: 'F-junkemail' }),
  ]);
  const { c, store } = make(w);
  await c.init();
  const here = c.getState().mail.find((m) => m.id === '2')!;
  const extra = await c.loadConversation(here);
  assert.deepEqual(extra.map((m) => m.id), ['sent1', 'arch1'], 'newest first');
  assert.ok(extra.every((m) => m.folder === 'archive' && m.conversationId === 'C1' && m.account === ME));
  assert.equal(extra[0].fromAddress, ME, 'your own reply says it is from you');
  // Seen, not kept: the phone's own mail is what it was
  assert.equal(c.getState().mail.length, 2);
  assert.equal((await store.allMail()).length, 2);
  assert.equal(c.remoteMail(ME, 'sent1')?.subject, 'Re: Ferie');
  assert.equal(c.remoteMail(ME, 'draft1'), undefined);
  assert.deepEqual(c.threadOf(here).map((m) => m.id), ['2', '1'], 'actions still reach only what is in the inbox on the phone');
});

test('conversations: asked once and kept for a minute and a half, again when forced, when a message went out, or when Post is opened anew', async () => {
  const w = world();
  chat(w, 'C1', ['1']);
  w.convo.set('C1', [elsewhere('sent1')]);
  const { c, advance, runTimers } = make(w);
  await c.init();
  const m = c.getState().mail[0];
  const asks = () => w.log.filter((l) => l === 'graph conversation C1').length;
  await c.loadConversation(m); await c.loadConversation(m);
  assert.equal(asks(), 1);
  assert.equal(w.log.filter((l) => l.startsWith('graph folder')).length, 3, 'the three folders are asked about in one go, once');
  advance(60_000); await c.loadConversation(m);
  assert.equal(asks(), 1);
  advance(40_000); await c.loadConversation(m);
  assert.equal(asks(), 2);
  await c.loadConversation(m, { force: true });
  assert.equal(asks(), 3);
  assert.equal(w.log.filter((l) => l.startsWith('graph folder')).length, 3, 'the folders were not asked about again');
  // a reply that leaves makes what was kept stale
  await c.send({ account: ME, kind: 'reply', to: ['anna@x.no'], cc: [], subject: 'Re: Ferie', body: 'ok', replyTo: '1' });
  advance(11_000); await runTimers();
  assert.ok(w.log.includes('graph createReply 1') && w.log.includes('graph send D1'));
  await c.loadConversation(m);
  assert.equal(asks(), 4);
});

test('conversations: a message that has no conversation, or a mailbox that is signed out, is told plainly', async () => {
  const w = world(); w.add('1'); chat(w, 'C1', ['2']);
  const { c } = make(w);
  await c.init();
  assert.deepEqual(await c.loadConversation(c.getState().mail.find((m) => m.id === '1')!), []);
  assert.equal(w.log.some((l) => l.startsWith('graph conversation')), false, 'nothing asked: there is no conversation to ask about');
  const m = c.getState().mail.find((m) => m.id === '2')!;
  w.flags.conversationFails = true;
  await assert.rejects(() => c.loadConversation(m));
  w.flags.conversationFails = false;
  w.convo.set('C1', [elsewhere('sent1')]);
  assert.deepEqual((await c.loadConversation(m)).map((x) => x.id), ['sent1'], 'a failure is not kept');
  await assert.rejects(() => c.loadConversation({ ...m, account: 'nobody@x.no' }), /Sign in again/);
});

test('conversations: what was archived or deleted here a moment ago, and Outlook has not been told yet, does not come back as part of the conversation', async () => {
  const w = world();
  chat(w, 'C1', ['1', '2']);
  w.convo.set('C1', [...[...w.inbox.values()].map((m) => ({ ...m, parentFolderId: 'F-inbox' }))]);
  const { c } = make(w);
  await c.init();
  const [newest, older] = [c.getState().mail.find((m) => m.id === '2')!, c.getState().mail.find((m) => m.id === '1')!];
  await c.archive([older]);
  assert.deepEqual((await c.loadConversation(newest)).map((m) => m.id), [], 'still in Outlook\'s inbox, but it was archived here');
  c.getState().toast!.undo!();
  await settle();
  assert.deepEqual((await c.loadConversation(newest, { force: true })).map((m) => m.id), [], 'and back on the phone, so it is not "the rest" either');
});

test('conversations: a conversation archived here and moved by Outlook shows all of its messages when opened again, even inside the minute and a half it was kept', async () => {
  const w = world();
  chat(w, 'C1', ['1', '2', '3']);
  w.convo.set('C1', [...[...w.inbox.values()].map((m) => ({ ...m, parentFolderId: 'F-inbox' }))]);
  const { c, advance, runTimers } = make(w);
  await c.init();
  const newest = c.getState().mail.find((m) => m.id === '3')!;
  assert.deepEqual(await c.loadConversation(newest), [], 'all three are in the inbox on the phone: nothing more to show');
  await c.archive(c.threadOf(newest), 1);
  assert.deepEqual(await c.loadConversation(newest), [], 'Outlook has not been told yet');
  advance(7000); await runTimers();
  assert.ok(w.log.includes('graph move 3 archive'), 'now it has');
  assert.deepEqual((await c.loadConversation(newest)).map((m) => m.id), ['3', '2', '1'], 'and the three of them are the conversation now (asked once: what was kept is reused)');
  assert.equal(w.log.filter((l) => l === 'graph conversation C1').length, 1);
});

test('conversations: a message deleted here is not part of its conversation afterwards, not even in what was kept a moment ago', async () => {
  const w = world();
  chat(w, 'C1', ['1', '2']);
  w.convo.set('C1', [...[...w.inbox.values()].map((m) => ({ ...m, parentFolderId: 'F-inbox' })), elsewhere('sent1')]);
  const { c, advance, runTimers } = make(w);
  await c.init();
  const [newest, older] = [c.getState().mail.find((m) => m.id === '2')!, c.getState().mail.find((m) => m.id === '1')!];
  assert.deepEqual((await c.loadConversation(newest)).map((m) => m.id), ['sent1']);
  await c.trash([older]);
  advance(7000); await runTimers();
  assert.ok(w.log.includes('graph move 1 deleteditems'));
  assert.deepEqual((await c.loadConversation(newest)).map((m) => m.id), ['sent1'], 'the deleted one is in the bin, not in the conversation');
});

test('conversations: the ids of the hidden folders are kept only when Outlook named all of them', async () => {
  const w = world();
  chat(w, 'C1', ['1']);
  w.convo.set('C1', [elsewhere('sent1'), elsewhere('junk1', { parentFolderId: 'F-junkemail' })]);
  w.flags.noFolder.add('junkemail'); // a busy moment: Outlook answers "slow down" for one of the three
  const { c, store } = make(w);
  await c.init();
  const m = c.getState().mail[0];
  assert.deepEqual((await c.loadConversation(m)).map((x) => x.id).sort(), ['junk1', 'sent1'], 'this once, junk is not known to be junk');
  assert.equal(await store.getMeta(`${ME}|folders`), undefined, 'and that is not kept');
  w.flags.noFolder.clear();
  assert.deepEqual((await c.loadConversation(m, { force: true })).map((x) => x.id), ['sent1'], 'asked again, and now it is left out');
  assert.ok(await store.getMeta(`${ME}|folders`));
  const asked = w.log.filter((l) => l.startsWith('graph folder')).length;
  await c.loadConversation(m, { force: true });
  assert.equal(w.log.filter((l) => l.startsWith('graph folder')).length, asked, 'complete: never asked again');
});

test('conversations: the text of a message that is only seen in Outlook is kept while Post is open, never on the phone', async () => {
  const w = world();
  chat(w, 'C1', ['1']);
  w.convo.set('C1', [elsewhere('sent1')]);
  const { c, store } = make(w);
  await c.init();
  const [extra] = await c.loadConversation(c.getState().mail[0]);
  const b = await c.openBody(extra);
  assert.equal(b.contentType, 'html');
  await c.openBody(extra);
  assert.equal(w.log.filter((l) => l === 'graph body').length, 1, 'asked once');
  assert.equal(await store.getBody(extra.key), undefined, 'not saved');
  // one that is on the phone is saved, as before
  await c.openBody(c.getState().mail[0]);
  assert.ok(await store.getBody(c.getState().mail[0].key));
});

test('conversations: the text of a message archived while it was being opened is not saved on the phone', async () => {
  const w = world(); w.add('1');
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const slow: typeof fetch = (async (url: string, init?: RequestInit) => { if (/\$select=body/.test(String(url))) await gate; return w.f(url, init); }) as typeof fetch;
  const { c, store } = make(w, { fetch: slow });
  await c.init();
  const m = c.getState().mail[0];
  const opening = c.openBody(m);
  await c.archive([m]);
  release();
  await opening;
  assert.equal(await store.getBody(m.key), undefined, 'it would stay behind for ever, with no message to belong to');
});

test('search in Outlook: what it finds can be opened, and acted on only as far as makes sense', async () => {
  const w = world(); w.add('1', { subject: 'Faktura oktober' });
  const { c } = make(w);
  await c.init();
  const [old] = await c.searchRemote('faktura');
  assert.equal(c.remoteMail(ME, old.id)?.subject, 'Gammel faktura');
  assert.equal(c.remoteMail(ME, 'nope'), undefined);
  assert.equal((await c.openBody(old)).contentType, 'html');
});

test('a conversation archived while its newest message is being flagged does not come back to the phone', async () => {
  const w = world();
  chat(w, 'C1', ['1', '2', '3']);
  const inner = memoryStore();
  let seen!: () => void;
  const taken = new Promise<void>((r) => { seen = r; });
  // The flag's copy of the message reaches the phone late (or the moment the archive has taken the messages away, if that comes first): the worst case.
  const store: Store = {
    ...inner,
    async deleteMail(keys) { await inner.deleteMail(keys); if (keys.length) seen(); },
    async putMail(items) { if (items.some((m) => m.flagged)) await Promise.race([taken, settle(40)]); return inner.putMail(items); },
  };
  const { c } = make(w, { store });
  await c.init();
  const items = c.getState().mail;
  assert.equal(items.length, 3);
  await Promise.all([c.toggleFlag(items), c.archive(items, 1)]);
  await settle(60);
  assert.deepEqual((await inner.allMail()).map((m) => m.id), [], 'the flag was written first, then everything was taken away: nothing came back');
  assert.deepEqual(c.getState().mail, []);
});

test('a message archived here stays out of the list until Outlook has been told, even if something wrote an older copy of it back', async () => {
  const w = world(); w.add('1'); w.add('2');
  const { c, store } = make(w);
  await c.init();
  const m = c.getState().mail.find((x) => x.id === '1')!;
  await c.archive([m]);
  await store.putMail([m]); // the sorting of the mail, finishing late with the copy it had
  await c.markRead([c.getState().mail[0]], { quiet: true }); // anything that looks at the phone again
  assert.deepEqual(c.getState().mail.map((x) => x.id), ['2']);
  c.getState().toast!.undo!();
  await settle();
  assert.deepEqual(c.getState().mail.map((x) => x.id).sort(), ['1', '2'], 'Undo still brings it back');
});

test('Clean up works on the rows of the Promotions tab: a conversation is one, and a promo inside another tab\'s conversation is left alone', async () => {
  const w = world();
  const shop = { emailAddress: { name: 'Butikk', address: 'tilbud@butikk.no' } };
  const at = (id: string, conv: string, when: string, o: Record<string, unknown> = {}) => w.add(id, { conversationId: conv, from: shop, subject: 'Rabatt', receivedDateTime: when, ...o });
  at('s1', 'S1', '2026-09-10T08:00:00Z'); at('s2', 'S1', '2026-09-12T08:00:00Z'); at('s3', 'S1', '2026-09-14T08:00:00Z');                               // an old newsletter thread of three
  at('f1', 'S2', '2026-09-10T08:00:00Z'); at('f2', 'S2', '2026-09-11T08:00:00Z', { flag: { flagStatus: 'flagged' } });                                 // one of them flagged: the row stays
  at('p1', 'S3', '2026-09-02T08:00:00Z', { subject: 'Middag?' });                                                                                     // an old promo ...
  w.add('p2', { conversationId: 'S3', subject: 'Re: Middag?', receivedDateTime: '2026-10-04T08:00:00Z' });                                              // ... in a conversation whose newest message is a person's
  at('n1', 'S4', '2026-09-01T08:00:00Z'); at('n2', 'S4', '2026-10-04T09:00:00Z');                                                                      // newest is fresh: the row is not old
  const { c, advance, runTimers } = make(w);
  await c.init();
  const s = c.getState();
  const t = Date.parse('2026-10-05T10:00:00Z');
  assert.deepEqual(cleanUpThreads(s, t, 7).map((r) => r.items.map((m) => m.id)), [['s3', 's2', 's1']], 'one row, old enough, nothing flagged');
  assert.deepEqual(cleanUpThreads(s, t, 0).map((r) => r.items.length).sort(), [2, 3], 'all of them: the thread of three and the fresh pair, never the flagged or the person\'s');
  assert.equal(cleanUpThreads(s, t, 0).length, visibleThreads({ ...s, view: 'promo' }, t).length - 1, 'the rows of the tab, but for the flagged one');
  assert.equal(cleanUpList(s, t, 7).length, 3);
  assert.equal(await c.cleanUp(7, t), 1);
  assert.equal(c.getState().toast!.text, 'Archived', 'one row, one word');
  assert.deepEqual(c.getState().mail.map((m) => m.id).sort(), ['f1', 'f2', 'n1', 'n2', 'p1', 'p2']);
  c.getState().toast!.undo!();
  await settle();
  assert.equal(c.getState().mail.length, 9);
  assert.equal(await c.cleanUp(7, t), 1);
  advance(7000); await runTimers();
  assert.deepEqual(w.log.filter((l) => l.startsWith('graph move')).sort(), ['graph move s1 archive', 'graph move s2 archive', 'graph move s3 archive']);
});

test('mark read: the toast counts rows of the list, not the messages in them', async () => {
  const w = world();
  chat(w, 'C1', ['1', '2', '3']);
  w.add('9', { conversationId: 'C9', receivedDateTime: '2026-10-05T06:00:00Z' });
  const { c } = make(w);
  await c.init();
  await c.markRead(c.threadOf(c.getState().mail.find((m) => m.id === '3')!));
  assert.equal(c.getState().toast!.text, 'Marked as read', 'one conversation, three messages');
  await c.setRead(c.getState().mail.find((m) => m.id === '3')!, false);
  await c.markRead(c.getState().mail);
  assert.equal(c.getState().toast!.text, 'Marked 2 as read', 'a conversation and a message');
});

test('Undo of a snooze puts back what each message was snoozed until before', async () => {
  const w = world();
  chat(w, 'C1', ['1', '2']);
  const { c, store } = make(w);
  await c.init();
  const [older, newest] = [c.getState().mail.find((m) => m.id === '1')!, c.getState().mail.find((m) => m.id === '2')!];
  await c.snooze(older, new Date('2026-10-09T08:00:00Z'), 'Fri');
  await c.snooze([newest, older], new Date('2026-10-06T08:00:00Z'), 'tomorrow');
  c.getState().toast!.undo!();
  await settle();
  assert.equal((await store.getMail(older.key))!.snoozedUntil, '2026-10-09T08:00:00.000Z', 'back to Friday, not to nothing');
  assert.equal((await store.getMail(newest.key))!.snoozedUntil ?? null, null);
});


// ---- reliability: what goes wrong on a phone, and what Post does about it ----------------------------------------------------------------------

const sendNew = (c: ReturnType<typeof make>['c'], subject = 'Hei', files: ReturnType<typeof out>[] = []) =>
  c.send({ account: ME, kind: 'new', to: ['x@y.no'], cc: [], subject, body: 'x' }, files);
const outboxOf = async (store: Store) => (await store.getMeta<any[]>('outbox')) ?? [];
/** The same phone opened again later: a new controller on what the old one saved. */
const reopen = (first: ReturnType<typeof make>, w: ReturnType<typeof world>, at = '2026-10-05T11:00:00Z') => createController({
  store: first.store, fetch: w.f, serverUrl: SERVER, now: () => Date.parse(at), sleep: async () => {}, setTimer: () => 0,
  kv: { get: (k) => first.kv.get(k) ?? null, set: (k, v) => void first.kv.set(k, v), del: (k) => void first.kv.delete(k) },
});

test('sending: when the answer to "send" is lost the message is not sent a second time', async () => {
  const w = world();
  const { c, store, advance } = make(w);
  await c.init();
  await sendNew(c, 'En gang');
  w.flags.loseAfter.push('send'); // Outlook sends it, and the answer never gets back
  advance(11_000); await c.flushOutbox();
  assert.equal(w.sentMails.length, 1, 'it did go');
  assert.deepEqual((await outboxOf(store)).map((x) => [x.subject, x.draft]), [['En gang', { id: 'D1', phase: 'sending' }]], 'Post cannot know that, so it keeps the message, and how far it got');
  await c.flushOutbox(); // the next try: the next sync, or the next time Post is opened
  assert.equal(w.sentMails.length, 1, 'it looked, and found that the message had gone');
  assert.deepEqual(await outboxOf(store), []);
  assert.equal(w.log.filter((l) => l.startsWith('graph draft')).length, 1);
  assert.equal(c.loadDraft(), null, 'and it was not handed back either');
});

test('sending: the app goes away before "send" arrived: the next start sends that same draft', async () => {
  const w = world();
  const first = make(w);
  await first.c.init();
  await sendNew(first.c, 'Halvveis');
  w.flags.loseBefore.push('send');
  first.advance(11_000); await first.c.flushOutbox();
  assert.equal(w.sentMails.length, 0);
  const second = reopen(first, w);
  await second.init();
  assert.deepEqual(w.sentMails.map((x) => x.subject), ['Halvveis']);
  assert.equal(w.log.filter((l) => l.startsWith('graph draft')).length, 1, 'no second draft was made');
});

test('sending: a lost answer to making the draft leaves one blank draft behind, and still only one message goes', async () => {
  const w = world();
  const { c, store, advance } = make(w);
  await c.init();
  await sendNew(c, 'Utkast');
  w.flags.loseAfter.push('draft');
  advance(11_000); await c.flushOutbox();
  assert.deepEqual(w.sentMails.map((x) => x.subject), ['Utkast']);
  assert.deepEqual(await outboxOf(store), []);
  assert.equal(w.drafts.size, 1, 'the first draft is an orphan: it is never sent');
});

test('sending: a file whose answer was lost is not on the message twice', async () => {
  const w = world();
  const { c, advance } = make(w);
  await c.init();
  await sendNew(c, 'Fil', [out('a.pdf', 1000), out('b.pdf', 2000)]);
  w.flags.loseAfter.push('attach'); // a.pdf reaches the draft, the answer does not reach Post
  advance(11_000); await c.flushOutbox();
  assert.deepEqual(w.sentMails.map((x) => x.attachments.map((a) => a.name)), [['a.pdf', 'b.pdf']]);
});

test('sending: files that were all on the draft are not needed from the phone any more, but still come back if the message is given up on', async () => {
  const w = world();
  const { c, store, advance } = make(w);
  await c.init();
  await sendNew(c, 'Tre', [out('a.pdf', 100), out('b.pdf', 100)]);
  w.flags.sendStatus = 500;
  advance(11_000); await c.flushOutbox();
  const it = (await outboxOf(store))[0];
  assert.equal(it.draft.phase, 'sending');
  await store.setMeta(`${ME}|outfile|${it.id}|0`, undefined); // a.pdf is lost from the phone: the draft has it already
  w.flags.sendStatus = 202;
  await c.flushOutbox();
  assert.deepEqual(w.sentMails.map((x) => x.attachments.map((a) => a.name)), [['a.pdf', 'b.pdf']], 'sent all the same');
});

test('sending: a message about to be handed back after three tries is not handed back when it had in fact gone', async () => {
  const w = world();
  const { c, store, advance } = make(w);
  await c.init();
  await sendNew(c, 'Gikk', [out('a.pdf', 100), out('b.pdf', 100)]);
  w.flags.sendStatus = 500;
  advance(11_000); await c.flushOutbox(); await c.flushOutbox(); // two failed tries
  w.flags.sendStatus = 202;
  w.flags.loseAfter.push('send');                                // the third goes through, and nobody hears
  await c.flushOutbox();
  assert.equal(w.sentMails.length, 1);
  assert.deepEqual(await outboxOf(store), []);
  assert.equal(c.loadDraft(), null, 'nothing is handed back for sending again');
  assert.doesNotMatch(c.getState().toast?.text ?? '', /Could not send/);
});

test('sending: a message that is given up on while Outlook still holds its draft is handed back, and the draft is thrown away', async () => {
  const w = world();
  const { c, advance } = make(w);
  await c.init();
  await sendNew(c, 'Tilbake', [out('a.pdf', 100), out('b.pdf', 100)]);
  w.flags.sendStatus = 500;
  advance(11_000); await c.flushOutbox(); await c.flushOutbox(); await c.flushOutbox();
  assert.equal(c.loadDraft()!.subject, 'Tilbake');
  assert.deepEqual((await c.loadDraftFiles()).map((f) => f.name), ['a.pdf', 'b.pdf'], 'with its files, though they were not read for the last tries');
  assert.ok(w.log.includes('graph delete D1'));
  assert.equal(w.sentMails.length, 0);
});

test('sending: a reply to a message that was archived while it waited still goes, from where the message is now', async () => {
  const w = world(); w.add('m1');
  const { c, store, advance, runTimers } = make(w);
  await c.init();
  await c.send({ account: ME, kind: 'reply', to: ['anna@x.no'], cc: [], subject: 'Re', body: 'Ja', replyTo: 'm1' });
  await c.archive([c.getState().mail[0]]);
  advance(7_000); await runTimers();            // the archive goes first: Outlook now calls the message something else
  assert.ok(w.log.includes('graph move m1 archive'));
  advance(5_000); await c.flushOutbox();        // the reply is due
  assert.deepEqual(w.log.filter((l) => l.startsWith('graph createReply')), ['graph createReply moved-m1']);
  assert.deepEqual(w.sentMails.map((x) => [x.kind, x.replyTo]), [['reply', 'moved-m1']]);
  assert.equal(c.loadDraft(), null);
  assert.deepEqual(await outboxOf(store), [], 'nothing left over');
});

test('sending: a reply that finds its message gone while the archive of it is still on its way waits, instead of being handed back', async () => {
  const w = world(); w.add('m1');
  const { c, store, advance } = make(w);
  await c.init();
  await c.send({ account: ME, kind: 'reply', to: ['anna@x.no'], cc: [], subject: 'Re', body: 'Ja', replyTo: 'm1' });
  await c.archive([c.getState().mail[0]]);
  w.flags.moved.add('m1');                      // Outlook has moved it already, and Post has not heard yet
  advance(11_000); await c.flushOutbox();
  assert.equal(c.loadDraft(), null, 'not handed back');
  assert.equal((await outboxOf(store)).length, 1, 'still waiting');
  assert.equal(w.sentMails.length, 0);
  await c.sync();                               // the archive goes through now (Post hears the new name), then the reply
  assert.deepEqual(w.sentMails.map((x) => x.replyTo), ['moved-m1']);
  assert.deepEqual(await outboxOf(store), []);
});

test('sending: a reply whose message is really gone (nobody is moving it) is handed back, as before', async () => {
  const w = world(); w.add('m1');
  const { c, store, advance } = make(w);
  await c.init();
  await c.send({ account: ME, kind: 'reply', to: ['anna@x.no'], cc: [], subject: 'Re', body: 'Ja', replyTo: 'm1' });
  w.flags.moved.add('m1');                      // deleted somewhere else
  advance(11_000); await c.flushOutbox();
  assert.equal(c.loadDraft()!.subject, 'Re');
  assert.deepEqual(await outboxOf(store), []);
  assert.match(c.getState().toast!.text, /Could not send/);
});

test('leaving: what waits for its undo time goes at once, and Undo then says it is too late', async () => {
  const w = world(); w.add('1'); w.add('2');
  const { c, store } = make(w);
  await c.init();
  await c.archive([c.getState().mail.find((m) => m.id === '1')!]);
  await sendNew(c, 'På vei');
  const id = c.getState().outbox[0].id;
  assert.equal(w.log.some((l) => l.startsWith('graph move')), false);
  await c.leaving();
  assert.ok(w.log.includes('graph move 1 archive'));
  assert.deepEqual(w.sentMails.map((x) => x.subject), ['På vei']);
  assert.deepEqual(await outboxOf(store), []);
  await c.cancelSend(id);
  assert.match(c.getState().toast!.text, /Too late/);
  assert.equal(c.loadDraft(), null);
});

test('leaving: with nothing waiting it does nothing at all', async () => {
  const w = world(); w.add('1');
  const { c } = make(w);
  await c.init();
  const before = w.log.length;
  await c.leaving();
  assert.equal(w.log.length, before);
});

test('leaving: a message that is already on its way cannot be taken back with Undo, even if it was not due yet', async () => {
  const w = world();
  let open!: () => void;
  w.flags.gate = new Promise<void>((r) => { open = r; });
  const { c, store } = make(w);
  await c.init();
  await sendNew(c, 'Underveis');
  const id = c.getState().outbox[0].id;
  const going = c.leaving();
  await settle(20);
  await c.cancelSend(id);                       // Undo tapped while it is being sent
  assert.match(c.getState().toast!.text, /Too late: it is already on its way/);
  open();
  await going;
  assert.deepEqual(w.sentMails.map((x) => x.subject), ['Underveis']);
  assert.deepEqual(await outboxOf(store), []);
  assert.equal(c.loadDraft(), null, 'not in the editor as well: that would send it twice');
});

test('leaving: asked for while an ordinary send is going, it still takes what was not due', async () => {
  const w = world();
  let open!: () => void;
  w.flags.gate = new Promise<void>((r) => { open = r; });
  const { c, advance } = make(w);
  await c.init();
  await sendNew(c, 'Først');
  advance(11_000);
  await sendNew(c, 'Senere');                   // not due for another ten seconds
  const running = c.flushOutbox();              // sends "Først" and waits at the gate
  await settle(20);
  const leaving = c.leaving();
  open();
  await Promise.all([running, leaving]);
  assert.deepEqual(w.sentMails.map((x) => x.subject).sort(), ['Først', 'Senere']);
});

test('sending: a message put in while another is being sent is kept, and the one being sent keeps its progress', async () => {
  const w = world();
  let open!: () => void;
  w.flags.gate = new Promise<void>((r) => { open = r; });
  const inner = memoryStore();
  // a phone that is slow to save the list: reading it, changing it and writing it back can then overlap unless they are kept apart
  const store: Store = { ...inner, async setMeta(k, v) { if (k === 'outbox') await settle(5); return inner.setMeta(k, v); } };
  const { c, advance } = make(w, { store });
  await c.init();
  await sendNew(c, 'A');
  advance(11_000);
  const running = c.flushOutbox();
  await Promise.all([sendNew(c, 'B'), sendNew(c, 'C')]);
  open();
  await running;
  assert.deepEqual(w.sentMails.map((x) => x.subject), ['A']);
  assert.deepEqual((await outboxOf(inner)).map((x) => x.subject).sort(), ['B', 'C']);
});

test('a sync that went quiet is left behind and a new one starts, but one that is still busy is not interrupted', async () => {
  const w = world(); w.add('1');
  const inner = memoryStore();
  let hang = false;
  const store: Store = { ...inner, allMail: () => (hang ? new Promise<never>(() => {}) : inner.allMail()) };
  const { c, advance } = make(w, { store });
  await c.init();
  hang = true;
  void c.sync();                                 // the phone stops it half way: it never finishes
  await settle(20);
  assert.equal(c.getState().sync.running, true);
  const asked = w.log.filter((l) => l === 'server status').length;
  advance(60_000);
  await c.sync();
  assert.equal(w.log.filter((l) => l === 'server status').length, asked, 'a minute of quiet is not stuck yet');
  hang = false;
  advance(100_000);
  await c.sync();
  assert.equal(c.getState().sync.running, false);
  assert.equal(c.getState().sync.at, Date.parse('2026-10-05T10:00:00Z') + 160_000);
  assert.ok(c.problems().some((p) => p.kind === 'sync' && /went quiet/.test(p.text)));
});

test('an archive that Outlook refuses for good comes back to the inbox, with a word about it', async () => {
  const w = world(); w.add('1'); w.add('2');
  w.flags.strictDelta = true;
  const { c, advance, runTimers } = make(w);
  await c.init();
  await c.archive([c.getState().mail.find((m) => m.id === '1')!]);
  w.flags.moveStatus = 403;
  advance(7_000);
  await c.sync(); await c.sync(); await c.sync(); // refused three times: that will not change
  assert.deepEqual(c.getState().mail.map((m) => m.id), ['2'], 'not back yet');
  assert.match(c.getState().toast!.text, /Outlook would not archive a message, so it comes back to your inbox/);
  await runTimers();                              // the mailbox is read again from Outlook's side
  await settle(20);
  assert.deepEqual(c.getState().mail.map((m) => m.id).sort(), ['1', '2']);
  assert.equal(c.getState().waiting, 0);
  assert.ok(c.problems().some((p) => p.kind === 'action'));
});

test('unsubscribing sends its one short message in one call, and says so', async () => {
  const w = world(); w.add('1');
  const { c } = make(w);
  await c.init();
  await c.unsubscribe(c.getState().mail[0], { to: 'stop@list.no', subject: 'unsubscribe', body: '' });
  assert.ok(w.log.includes('graph sendMail unsubscribe'));
  assert.equal(c.getState().toast!.text, 'Unsubscribe request sent');
});

test('what went wrong is written down for the Health page, without addresses', async () => {
  const { c } = make();
  await c.init();
  c.note('send', new Error('The recipient bob@firma.no is not valid'));
  c.note('send', new Error('The recipient bob@firma.no is not valid'));
  const list = c.problems();
  assert.equal(list.length, 1);
  assert.equal(list[0].count, 2);
  assert.doesNotMatch(list[0].text, /@/);
  assert.match(list[0].text, /\[address\]/);
});
