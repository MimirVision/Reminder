import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanUpList, createController, mailCounts, visibleMail, type Deps } from './controller.ts';
import { memoryStore } from './store.ts';

const SERVER = 'https://s.example/fn';
const acct = (email: string, label: string) => ({ id: label === 'Work' ? '2' : '1', email, label, mode: 'people', quiet: null, vips: [] as string[], subscription_expires_at: null, last_alert_at: null });

// A tiny fake of both the alert server and Microsoft Graph, behind one fetch.
function world() {
  const log: string[] = [];
  const inbox = new Map<string, any>();
  let nextDelta = 1;
  const accounts = new Map([['a@outlook.com', acct('a@outlook.com', 'Personal')]]);
  const flags = { offline: false, tokenFail: new Set<string>(), polled: false, nextEmail: 'w@firma.no' };
  const headers: Record<string, { name: string; value: string }[]> = {}; // what the hidden headers of each message say
  const sent: string[] = []; // who the person has written to (Sent Items)
  const add = (id: string, o: any = {}) => inbox.set(id, { id, subject: `Subject ${id}`, receivedDateTime: '2026-10-05T08:00:00Z', from: { emailAddress: { name: 'Anna', address: 'anna@x.no' } }, isRead: false, bodyPreview: 'preview', ...o });
  const f = (async (url: string, init: RequestInit = {}) => {
    if (flags.offline) throw new Error('offline');
    const u = String(url);
    const body = init.body ? JSON.parse(String(init.body)) : {};
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
    if (/messages\/delta/.test(path) || u.includes('graph/delta')) { log.push('graph delta'); return new Response(JSON.stringify({ value: [...inbox.values()], '@odata.deltaLink': `https://graph/delta?d=${nextDelta++}` })); }
    if (path === '/$batch') return new Response(JSON.stringify({ responses: body.requests.map((r: any) => ({ id: r.id, status: 200, body: { internetMessageHeaders: headers[decodeURIComponent(/messages\/([^?]+)/.exec(r.url)![1])] ?? [] } })) }));
    if (path.startsWith('/me/mailFolders/sentitems/messages')) { log.push('graph sent'); return new Response(JSON.stringify({ value: sent.map((address) => ({ toRecipients: [{ emailAddress: { address } }], ccRecipients: [] })) })); }
    let m: RegExpExecArray | null;
    if ((m = /^\/me\/messages\/([^/]+)\/move$/.exec(path))) { log.push(`graph move ${decodeURIComponent(m[1])} ${body.destinationId}`); inbox.delete(decodeURIComponent(m[1])); return new Response(JSON.stringify({ id: 'new' }), { status: 201 }); }
    if ((m = /^\/me\/messages\/([^/?]+)$/.exec(path)) && init.method === 'PATCH') { log.push(`graph patch ${decodeURIComponent(m[1])} ${JSON.stringify(body)}`); return new Response('{}'); }
    if ((m = /^\/me\/messages\/([^/?]+)\?\$select=body/.exec(path))) { log.push('graph body'); return new Response(JSON.stringify({ body: { contentType: 'html', content: '<p>Hei</p>' }, toRecipients: [{ emailAddress: { name: 'Meg', address: 'a@outlook.com' } }], hasAttachments: false })); }
    if (path === '/me/sendMail') { log.push(`graph sendMail ${body.message.subject}`); return new Response(null, { status: 202 }); }
    if (/\/(reply|replyAll|forward)$/.test(path)) { log.push(`graph ${path.split('/').pop()}`); return new Response(null, { status: 202 }); }
    if (path.startsWith('/me/messages?$search')) { log.push('graph search'); return new Response(JSON.stringify({ value: [{ id: 'old1', subject: 'Gammel faktura', from: { emailAddress: { address: 'x@y.no' } }, receivedDateTime: '2025-01-01T00:00:00Z' }, ...[...inbox.values()].slice(0, 1)] })); }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
  return { f, log, add, inbox, flags, headers, sent, accounts: () => [...accounts.values()] };
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
  const c2 = createController({ store: first.store, fetch: w.f, serverUrl: SERVER, now: () => Date.parse('2026-10-05T11:00:00Z'), kv: { get: (k) => first.kv.get(k) ?? null, set: (k, v) => void first.kv.set(k, v), del: (k) => void first.kv.delete(k) }, setTimer: () => 0 });
  await c2.init();
  assert.ok(w.log.includes('graph reply'));
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
