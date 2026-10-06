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

// ---- files: seeing and sending ------------------------------------------------------------------------------------------------------------

const out = (name: string, size: number, type = 'application/pdf') => ({ name, type, bytes: new Uint8Array(size).fill(66) });
const settle = (ms = 10) => new Promise<void>((r) => setTimeout(r, ms));
/** What is waiting in the outbox right now, by subject (the screen's copy is refreshed by the caller of a run). */
const queued = async (store: ReturnType<typeof memoryStore>) => ((await store.getMeta<{ subject: string }[]>('outbox')) ?? []).map((x) => x.subject);

/** Drafts, attachments and upload addresses, in front of the ordinary world. */
function fileWorld(w: ReturnType<typeof world>) {
  const flags = { listFails: false, valueFails: false, jsonFails: false, sendStatus: 202, attachStatus: 201, uploadFails: false, gate: null as Promise<void> | null };
  const listings = new Map<string, any[]>();                                  // message id -> what the attachment list says
  const content = new Map<string, { bytes: Uint8Array; type: string }>();     // `${message}/${attachment}` -> the file
  const bodies = new Map<string, { html: string; hasAttachments: boolean }>();
  const sentMails: any[] = [];
  const calls: string[] = [];
  let drafts = 0;
  const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });
  const f = (async (url: string, init: RequestInit = {}) => {
    if (w.flags.offline) throw new Error('offline');
    const u = String(url);
    const method = init.method ?? 'GET';
    const path = u.replace('https://graph.microsoft.com/v1.0', '');
    const body = typeof init.body === 'string' && init.body ? JSON.parse(init.body) : {};
    let m: RegExpExecArray | null;
    if (u.startsWith('https://upload.example/')) {
      if (flags.uploadFails) throw new TypeError('Failed to fetch');
      w.log.push(`upload ${(init.headers as Record<string, string>)['Content-Range']}`);
      return json({});
    }
    if (method === 'POST' && path === '/me/messages') { w.log.push(`graph draft ${body.subject}`); return json({ id: `D${++drafts}` }, 201); }
    if (method === 'POST' && (m = /^\/me\/messages\/([^/]+)\/(createReply|createReplyAll|createForward)$/.exec(path))) { w.log.push(`graph ${m[2]} ${decodeURIComponent(m[1])}`); return json({ id: `D${++drafts}` }, 201); }
    if (method === 'POST' && (m = /^\/me\/messages\/([^/]+)\/attachments\/createUploadSession$/.exec(path))) { w.log.push(`graph session ${m[1]} ${body.AttachmentItem.name} ${body.AttachmentItem.size}`); return json({ uploadUrl: 'https://upload.example/s?authtoken=T' }); }
    if (method === 'POST' && (m = /^\/me\/messages\/([^/]+)\/attachments$/.exec(path))) { w.log.push(`graph attach ${m[1]} ${body.name}`); return json({}, flags.attachStatus); }
    if (method === 'POST' && (m = /^\/me\/messages\/([^/]+)\/send$/.exec(path))) {
      w.log.push(`graph send ${m[1]}`);
      return flags.sendStatus === 202 ? new Response(null, { status: 202 }) : json({ error: { code: 'ErrorMessageSizeExceeded', message: 'The message is too large' } }, flags.sendStatus);
    }
    if (method === 'DELETE' && (m = /^\/me\/messages\/([^/]+)$/.exec(path))) { w.log.push(`graph delete ${m[1]}`); return new Response(null, { status: 204 }); }
    if (path === '/me/sendMail') {
      if (flags.gate) await flags.gate;
      sentMails.push(body.message);
      if (flags.sendStatus !== 202) return json({ error: { code: 'ErrorMessageSizeExceeded', message: 'The message is too large' } }, flags.sendStatus);
    }
    if (method === 'GET' && (m = /^\/me\/messages\/([^/?]+)\?\$select=body/.exec(path))) {
      const b = bodies.get(decodeURIComponent(m[1]));
      if (b) { w.log.push('graph body'); return json({ body: { contentType: 'html', content: b.html }, toRecipients: [], hasAttachments: b.hasAttachments }); }
    }
    if (method === 'GET' && (m = /^\/me\/messages\/([^/]+)\/attachments\?/.exec(path))) {
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
  return { f, flags, listings, content, bodies, sentMails, calls };
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
  assert.equal(fw.sentMails.length, 0);
  advance(11_000); await runTimers();
  assert.deepEqual(fw.sentMails.map((x) => [x.subject, (x.attachments ?? []).map((a: any) => a.name)]), [['Kontrakt', ['a.pdf']]]);
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
  assert.equal(fw.sentMails.length, 0);
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

test('files: several files that are too many to travel inside the message go through a draft', async () => {
  const w = world();
  const fw = fileWorld(w);
  const { c, advance, runTimers } = make(w, { fetch: fw.f });
  await c.init();
  await c.send({ account: 'a@outlook.com', kind: 'new', to: ['x@y.no'], cc: [], subject: 'To filer', body: 'x' }, [out('a.pdf', 1_600_000), out('b.pdf', 1_600_000)]);
  advance(11_000); await runTimers();
  assert.deepEqual(w.log.filter((l) => /^graph (draft|attach|send|sendMail)/.test(l)), ['graph draft To filer', 'graph attach D1 a.pdf', 'graph attach D1 b.pdf', 'graph send D1']);
  assert.equal(fw.sentMails.length, 0, 'not also sent the plain way');
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

test('files: a reply, a reply to all and a forward with files keep the conversation, and without files stay the plain calls', async () => {
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
    'graph reply',
  ]);
});

test('files: Outlook refusing the message for good hands it back, with its files, and says why', async () => {
  const w = world();
  const fw = fileWorld(w);
  fw.flags.sendStatus = 413;
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
  fw.flags.sendStatus = 500;
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
  fw.flags.sendStatus = 500;
  const { c, store, advance } = make(w, { fetch: fw.f });
  await c.init();
  await c.send({ account: 'a@outlook.com', kind: 'new', to: ['x@y.no'], cc: [], subject: 'Vanlig', body: 'x' });
  advance(11_000);
  for (let i = 0; i < 6; i++) await c.flushOutbox();
  assert.deepEqual(await queued(store), ['Vanlig']);
  fw.flags.sendStatus = 202;
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
  assert.equal(fw.sentMails.length, 0);
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
  fw.flags.gate = new Promise<void>((r) => { open = r; });
  const { c, store, advance } = make(w, { fetch: fw.f });
  await c.init();
  await c.send({ account: 'a@outlook.com', kind: 'new', to: ['x@y.no'], cc: [], subject: 'En gang', body: 'x' }, [out('a.pdf', 100)]);
  advance(11_000);
  const a = c.flushOutbox();
  const b = c.flushOutbox();   // a sync, or the timer, arriving while the first is still sending
  await settle(20);
  open();
  await Promise.all([a, b]);
  assert.equal(fw.sentMails.length, 1);
  assert.deepEqual(await queued(store), []);
});

test('files: Undo on one message while another is being sent is respected', async () => {
  const w = world();
  const fw = fileWorld(w);
  let open!: () => void;
  fw.flags.gate = new Promise<void>((r) => { open = r; });
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
  assert.deepEqual(fw.sentMails.map((x) => x.subject), ['Først']);
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
