import test from 'node:test';
import assert from 'node:assert/strict';
import { createController, filterCounts, visibleMail, type Deps } from './controller.ts';
import { memoryStore } from './store.ts';
import { makeSetupCode } from './setup.ts';

const CFG = { url: 'https://s.example/fn', key: 'secret-key-1234', clientId: '11111111-2222-3333-4444-555555555555' };

// A tiny fake of both the alert server and Microsoft Graph, behind one fetch.
function world() {
  const log: string[] = [];
  const inbox = new Map<string, any>();
  let nextDelta = 1;
  let accounts = [{ email: 'a@outlook.com', label: 'Personal', mode: 'people', quiet: null, vips: 0, subscription_expires_at: null, last_alert_at: null }];
  const flags: Record<string, boolean> = { offline: false, tokenError: '' };
  const add = (id: string, o: any = {}) => inbox.set(id, { id, subject: `Subject ${id}`, receivedDateTime: '2026-10-05T08:00:00Z', from: { emailAddress: { name: 'Anna', address: 'anna@x.no' } }, isRead: false, bodyPreview: 'preview', ...o });
  const f = (async (url: string, init: RequestInit = {}) => {
    if (flags.offline) throw new Error('offline');
    const u = String(url);
    const body = init.body ? JSON.parse(String(init.body)) : {};
    if (u === CFG.url) {
      log.push(`server ${body.op}`);
      if (body.op === 'status') return new Response(JSON.stringify({ devices: 1, accounts }));
      if (body.op === 'token') return flags.tokenError ? new Response(JSON.stringify({ error: flags.tokenError }), { status: 400 }) : new Response(JSON.stringify({ accessToken: 'T', expiresIn: 3600, email: body.email }));
      if (body.op === 'connect') { accounts = [...accounts, { email: 'w@firma.no', label: 'Work', mode: 'people', quiet: null, vips: 0, subscription_expires_at: null, last_alert_at: null }]; return new Response(JSON.stringify({ id: '2', email: 'w@firma.no', expires: 'x' })); }
      if (body.op === 'update') return new Response(JSON.stringify({ ok: true }));
      if (body.op === 'unregister') { accounts = accounts.filter((a) => a.email !== body.email); return new Response(JSON.stringify({ removed: true })); }
      return new Response(JSON.stringify({ ok: true }));
    }
    const path = u.replace('https://graph.microsoft.com/v1.0', '');
    if (/messages\/delta/.test(path) || u.includes('graph/delta')) { log.push('graph delta'); return new Response(JSON.stringify({ value: [...inbox.values()], '@odata.deltaLink': `https://graph/delta?d=${nextDelta++}` })); }
    if (path === '/$batch') return new Response(JSON.stringify({ responses: body.requests.map((r: any) => ({ id: r.id, status: 200, body: { internetMessageHeaders: [] } })) }));
    let m: RegExpExecArray | null;
    if ((m = /^\/me\/messages\/([^/]+)\/move$/.exec(path))) { log.push(`graph move ${decodeURIComponent(m[1])} ${body.destinationId}`); inbox.delete(decodeURIComponent(m[1])); return new Response(JSON.stringify({ id: 'new' }), { status: 201 }); }
    if ((m = /^\/me\/messages\/([^/?]+)$/.exec(path)) && init.method === 'PATCH') { log.push(`graph patch ${decodeURIComponent(m[1])} ${JSON.stringify(body)}`); return new Response('{}'); }
    if ((m = /^\/me\/messages\/([^/?]+)\?\$select=body/.exec(path))) { log.push('graph body'); return new Response(JSON.stringify({ body: { contentType: 'html', content: '<p>Hei</p>' }, toRecipients: [{ emailAddress: { name: 'Meg', address: 'a@outlook.com' } }], hasAttachments: false })); }
    if (path === '/me/sendMail') { log.push(`graph sendMail ${body.message.subject}`); return new Response(null, { status: 202 }); }
    if (/\/(reply|replyAll|forward)$/.test(path)) { log.push(`graph ${path.split('/').pop()}`); return new Response(null, { status: 202 }); }
    if (path.startsWith('/me/messages?$search')) { log.push('graph search'); return new Response(JSON.stringify({ value: [{ id: 'old1', subject: 'Gammel faktura', from: { emailAddress: { address: 'x@y.no' } }, receivedDateTime: '2025-01-01T00:00:00Z' }, ...[...inbox.values()].slice(0, 1)] })); }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
  return { f, log, add, inbox, flags, accounts: () => accounts };
}

function make(w = world(), extra: Partial<Deps> = {}) {
  const store = memoryStore();
  const kv = new Map<string, string>([['post.config', JSON.stringify(CFG)]]);
  const timers: { fn: () => void; ms: number }[] = [];
  let t = Date.parse('2026-10-05T10:00:00Z');
  const c = createController({
    store, fetch: w.f, now: () => t, sleep: async () => {}, setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
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
  w.flags.tokenError = 'AADSTS700082: The refresh token has expired due to inactivity.';
  await c.sync();
  assert.equal(c.getState().accounts[0].needsSignIn, true);
});

test('connecting a second account registers it and reads its mail', async () => {
  const w = world();
  const { c } = make(w);
  await c.init();
  const r = await c.connect({ code: 'c', verifier: 'v', redirectUri: 'https://x/post/' });
  assert.equal(r.email, 'w@firma.no');
  assert.deepEqual(c.getState().accounts.map((a) => a.email), ['a@outlook.com', 'w@firma.no']);
});

test('removing an account clears its mail from this phone', async () => {
  const w = world(); w.add('1');
  const { c } = make(w);
  await c.init();
  await c.removeAccount('a@outlook.com');
  assert.equal(c.getState().mail.length, 0);
  assert.equal(c.getState().accounts.length, 0);
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
  assert.equal(w.log.some((l) => l.startsWith('graph sendMail')), false);
  const id = c.getState().outbox[0].id;
  await c.cancelSend(id);
  assert.equal(c.getState().outbox.length, 0);
  assert.equal(c.loadDraft()!.subject, 'Hei');
  await c.send({ account: 'a@outlook.com', kind: 'new', to: ['x@y.no'], cc: [], subject: 'Hei 2', body: 'Tekst' });
  advance(11_000);
  await runTimers();
  assert.ok(w.log.includes('graph sendMail Hei 2'));
  assert.equal(c.getState().outbox.length, 0);
});

test('a queued mail survives closing the app: the next start sends it', async () => {
  const w = world();
  const first = make(w);
  await first.c.init();
  await first.c.send({ account: 'a@outlook.com', kind: 'reply', to: ['x@y.no'], cc: [], subject: 'Re', body: 'Ja', replyTo: 'm9' });
  // new controller on the same store, later
  const c2 = createController({ store: first.store, fetch: w.f, now: () => Date.parse('2026-10-05T11:00:00Z'), kv: { get: (k) => first.kv.get(k) ?? null, set: (k, v) => void first.kv.set(k, v), del: (k) => void first.kv.delete(k) }, setTimer: () => 0 });
  await c2.init();
  assert.ok(w.log.includes('graph reply'));
});

test('moving a sender re-sorts all their mail', async () => {
  const w = world(); w.add('1'); w.add('2');
  const { c } = make(w);
  await c.init();
  await c.moveSender('anna@x.no', 'newsletter');
  assert.ok(c.getState().mail.every((m) => m.kind === 'newsletter'));
  assert.equal(filterCounts(c.getState(), Date.parse('2026-10-05T10:00:00Z')).newsletter, 2);
  await c.moveSender('anna@x.no', null);
  assert.ok(c.getState().mail.every((m) => m.kind === 'person'));
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

test('a bad saved config or settings never stop the app opening', async () => {
  const w = world();
  const { c, kv } = make(w);
  kv.set('post.config', '{nonsense'); kv.set('post.settings', 'null');
  await c.init();
  assert.equal(c.getState().config, null);
  assert.equal(c.getState().ready, true);
  void makeSetupCode;
});
