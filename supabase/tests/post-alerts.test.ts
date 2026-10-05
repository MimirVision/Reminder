import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALERT_SCOPE, AlertGraphError, alertBuild, alertCreateSubscription, alertDecide, alertDecrypt, alertEncrypt, alertExpiry, alertGetInboxId, alertGetMessage,
  alertKind, alertLocal, alertParseLifecycle, alertParseNotifications, alertPlanRenewals, alertRefresh, alertRenewSubscription, alertSameSecret,
  alertValidationToken, alertWithinWindow, alertProcess, alertRegister, alertSettingsPatch, alertUnregister, alertRenewAll, alertLifecycle, alertTest, type AlertAccount, type AlertDeps, type AlertDevice, type AlertStore, type AlertStored, type GraphMessage,
} from '../functions/post-alerts/logic.ts';

const acct = (over: Partial<AlertAccount> = {}): AlertAccount => ({ id: 'a1', email: 'andreas@outlook.com', label: 'Personal', mode: 'people', vips: [], quiet: null, tz: 'Europe/Oslo', inbox_folder_id: 'INBOX-ID', ...over });
const msg = (over: Partial<GraphMessage> = {}): GraphMessage => ({
  id: 'm1', subject: 'Re: Hytta i påska', isRead: false, parentFolderId: 'INBOX-ID', from: { emailAddress: { name: 'Maja Berg', address: 'maja@example.no' } }, internetMessageHeaders: [], ...over,
});
// Monday 5 Oct 2026 at 10:00 and 20:00 in Oslo (UTC+2).
const MON_10 = new Date('2026-10-05T08:00:00Z');
const MON_20 = new Date('2026-10-05T18:00:00Z');
const SAT_10 = new Date('2026-10-10T08:00:00Z');
const WORK = { days: [1, 2, 3, 4, 5], from: '07:30', to: '17:00' };

test('validation: echoes the token Microsoft sends, nothing otherwise', () => {
  assert.equal(alertValidationToken('https://x.supabase.co/functions/v1/post-alerts?validationToken=Validation%3A+abc'), 'Validation: abc');
  assert.equal(alertValidationToken('https://x.supabase.co/functions/v1/post-alerts'), null);
  assert.equal(alertValidationToken('https://x.supabase.co/functions/v1/post-alerts?validationToken='), null);
});

test('notifications: only ones carrying our clientState count; the message id comes from resourceData or the resource path', () => {
  const states = new Map([['sub1', 'secret1']]);
  const body = {
    value: [
      { subscriptionId: 'sub1', clientState: 'secret1', changeType: 'created', resourceData: { id: 'AAA=' }, resource: "Users/u/Messages/AAA=" },
      { subscriptionId: 'sub1', clientState: 'WRONG', changeType: 'created', resourceData: { id: 'BBB=' } },
      { subscriptionId: 'other', clientState: 'secret1', changeType: 'created', resourceData: { id: 'CCC=' } },
      { subscriptionId: 'sub1', clientState: 'secret1', changeType: 'created', resource: "me/mailFolders('inbox')/messages/DDD%3D" },
      { subscriptionId: 'sub1', clientState: 'secret1', lifecycleEvent: 'missed' },
    ],
  };
  assert.deepEqual(alertParseNotifications(body, states).map((n) => n.messageId), ['AAA=', 'DDD=']);
  assert.deepEqual(alertParseNotifications(null, states), []);
  assert.deepEqual(alertParseNotifications({ value: 'nope' }, states), []);
});

test('lifecycle events: reauthorization and removal are recognised, forged ones are not', () => {
  const states = new Map([['sub1', 'secret1']]);
  const out = alertParseLifecycle({ value: [
    { subscriptionId: 'sub1', clientState: 'secret1', lifecycleEvent: 'reauthorizationRequired' },
    { subscriptionId: 'sub1', clientState: 'bad', lifecycleEvent: 'subscriptionRemoved' },
    { subscriptionId: 'sub1', clientState: 'secret1', changeType: 'created' },
  ] }, states);
  assert.deepEqual(out, [{ subscriptionId: 'sub1', event: 'reauthorizationRequired' }]);
});

test('person or bulk: unsubscribe links, precedence, auto-submitted and robot senders are bulk', () => {
  const h = (name: string, value: string) => ({ internetMessageHeaders: [{ name, value }] });
  assert.equal(alertKind(msg()), 'person');
  assert.equal(alertKind(msg(h('List-Unsubscribe', '<https://x>'))), 'bulk');
  assert.equal(alertKind(msg(h('List-Id', '<news.example>'))), 'bulk');
  assert.equal(alertKind(msg(h('Precedence', 'bulk'))), 'bulk');
  assert.equal(alertKind(msg(h('Auto-Submitted', 'auto-generated'))), 'bulk');
  assert.equal(alertKind(msg(h('Auto-Submitted', 'no'))), 'person');
  assert.equal(alertKind(msg({ from: { emailAddress: { name: 'Shop', address: 'no-reply@shop.example' } } })), 'bulk');
  assert.equal(alertKind(msg({ from: { emailAddress: { name: 'Kari', address: 'kari.noreply@example.no' } } })), 'person');
  // Outlook's own "Other" is not used to stay quiet: when unsure we alert.
  assert.equal(alertKind(msg({ inferenceClassification: 'other' })), 'person');
});

test('schedule: weekday and time window in the account time zone, including the edges', () => {
  assert.deepEqual(alertLocal(MON_10, 'Europe/Oslo'), { day: 1, minutes: 600 });
  assert.equal(alertWithinWindow(WORK, MON_10, 'Europe/Oslo'), true);
  assert.equal(alertWithinWindow(WORK, MON_20, 'Europe/Oslo'), false);
  assert.equal(alertWithinWindow(WORK, SAT_10, 'Europe/Oslo'), false);
  assert.equal(alertWithinWindow(WORK, new Date('2026-10-05T15:00:00Z'), 'Europe/Oslo'), false); // 17:00 sharp is outside
  assert.equal(alertWithinWindow(WORK, new Date('2026-10-05T14:59:00Z'), 'Europe/Oslo'), true);
  assert.equal(alertWithinWindow(null, SAT_10, 'Europe/Oslo'), true);
});

test('decision: mode, read state, folder, VIPs and the schedule together', () => {
  assert.equal(alertDecide(msg(), acct(), MON_10).send, true);
  assert.equal(alertDecide(msg(), acct({ mode: 'off' }), MON_10).send, false);
  assert.equal(alertDecide(msg({ isRead: true }), acct(), MON_10).reason, 'already read');
  assert.equal(alertDecide(msg({ parentFolderId: 'JUNK-ID' }), acct(), MON_10).reason, 'not in the inbox');
  const news = msg({ internetMessageHeaders: [{ name: 'List-Unsubscribe', value: '<x>' }] });
  assert.equal(alertDecide(news, acct(), MON_10).send, false);
  assert.equal(alertDecide(news, acct({ mode: 'all' }), MON_10).send, true);
  assert.equal(alertDecide(msg(), acct({ mode: 'vips' }), MON_10).send, false);
  assert.equal(alertDecide(msg(), acct({ mode: 'vips', vips: ['MAJA@example.no'] }), MON_10).send, true);
  // work account: quiet after 17:00, but a VIP still gets through
  const work = acct({ label: 'Work', quiet: WORK });
  assert.equal(alertDecide(msg(), work, MON_20).send, false);
  assert.match(alertDecide(msg(), work, MON_20).reason, /alert hours/);
  assert.equal(alertDecide(msg(), { ...work, vips: ['maja@example.no'] }, MON_20).send, true);
  assert.equal(alertDecide(msg(), work, MON_10).send, true);
  // a mail from an unknown folder id is allowed while the inbox id is not known yet
  assert.equal(alertDecide(msg({ parentFolderId: 'X' }), acct({ inbox_folder_id: null }), MON_10).send, true);
});

test('alert text: sender as title, subject as body, account shown only with several accounts, long text clipped', () => {
  const a = { id: 'a1', label: 'Work' };
  assert.deepEqual(alertBuild(msg(), a, false), { title: 'Maja Berg', body: 'Re: Hytta i påska', url: '/post-alerts/?open=m1&acct=a1', tag: 'm1' });
  assert.equal(alertBuild(msg(), a, true).title, 'Maja Berg · Work');
  assert.equal(alertBuild(msg({ subject: '' }), a, false, 'nb').body, '(uten emne)');
  assert.equal(alertBuild(msg({ subject: 'x'.repeat(300) }), a, false).body.length, 110);
  assert.equal(alertBuild(msg({ from: undefined }), a, false).title, 'Unknown sender');
  assert.equal(alertBuild(msg({ id: 'a/b=' }), a, false).url, '/post-alerts/?open=a%2Fb%3D&acct=a1');
});

test('secrets: encrypt/decrypt round-trips, a wrong key or tampering fails, equality is exact', async () => {
  const key = 'A'.repeat(43); // 32 zero-ish bytes in base64url
  const other = 'B'.repeat(43);
  const stored = await alertEncrypt('0.AAAA-refresh-token', key);
  assert.match(stored, /^v1\./);
  assert.ok(!stored.includes('refresh'));
  assert.equal(await alertDecrypt(stored, key), '0.AAAA-refresh-token');
  await assert.rejects(alertDecrypt(stored, other));
  const parts = stored.split('.');
  await assert.rejects(alertDecrypt(`${parts[0]}.${parts[1]}.${parts[2].slice(0, -2)}AA`, key));
  assert.notEqual(await alertEncrypt('same', key), await alertEncrypt('same', key)); // fresh IV every time
  assert.equal(alertSameSecret('abc', 'abc'), true);
  assert.equal(alertSameSecret('abd', 'abc'), false);
  assert.equal(alertSameSecret('ab', 'abc'), false);
  assert.equal(alertSameSecret(null, 'abc'), false);
});

function fakeFetch(handler: (url: string, init: RequestInit) => { status?: number; body?: unknown }) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const r = handler(String(url), init);
    return new Response(r.body === undefined ? '' : JSON.stringify(r.body), { status: r.status ?? 200 });
  }) as typeof fetch;
  return { f, calls };
}

test('Graph: refresh asks for read-only mail access and returns the rotated refresh token', async () => {
  const { f, calls } = fakeFetch(() => ({ body: { access_token: 'AT', refresh_token: 'RT2', expires_in: 3600 } }));
  const r = await alertRefresh(f, { clientId: 'CID', refreshToken: 'RT1' });
  assert.deepEqual(r, { accessToken: 'AT', refreshToken: 'RT2' });
  const body = new URLSearchParams(String(calls[0].init.body));
  assert.equal(body.get('grant_type'), 'refresh_token');
  assert.equal(body.get('refresh_token'), 'RT1');
  assert.equal(body.get('scope'), ALERT_SCOPE);
  assert.ok(!ALERT_SCOPE.includes('Send') && !ALERT_SCOPE.includes('ReadWrite'));
});

test('Graph: a revoked sign-in is reported with its code, not swallowed', async () => {
  const { f } = fakeFetch(() => ({ status: 400, body: { error: 'invalid_grant', error_description: 'AADSTS70008: expired' } }));
  await assert.rejects(alertRefresh(f, { clientId: 'C', refreshToken: 'R' }), (e: unknown) => e instanceof AlertGraphError && e.status === 400 && e.code === 'invalid_grant');
});

test('Graph: message, inbox id, create and renew subscription use the right calls', async () => {
  const { f, calls } = fakeFetch((url, init) => {
    if (url.includes('/subscriptions') && init.method === 'POST') return { status: 201, body: { id: 'SUB1', expirationDateTime: '2026-10-09T08:00:00Z' } };
    if (url.includes('/subscriptions/') && init.method === 'PATCH') return { body: { expirationDateTime: '2026-10-10T08:00:00Z' } };
    if (url.includes('/mailFolders/inbox')) return { body: { id: 'INBOX-ID' } };
    return { body: { id: 'm1', subject: 'Hei' } };
  });
  assert.equal((await alertGetMessage(f, 'T', 'AA/BB=')).subject, 'Hei');
  assert.match(calls[0].url, /\/me\/messages\/AA%2FBB%3D\?\$select=.*internetMessageHeaders/);
  assert.equal(await alertGetInboxId(f, 'T'), 'INBOX-ID');
  const sub = await alertCreateSubscription(f, 'T', { notificationUrl: 'https://h/n', lifecycleUrl: 'https://h/n?lifecycle=1', clientState: 'cs', expires: '2026-10-09T08:00:00Z' });
  assert.deepEqual(sub, { id: 'SUB1', expires: '2026-10-09T08:00:00Z' });
  const sent = JSON.parse(String(calls[2].init.body));
  assert.equal(sent.resource, "me/mailFolders('inbox')/messages");
  assert.equal(sent.changeType, 'created');
  assert.equal(sent.clientState, 'cs');
  assert.equal(sent.lifecycleNotificationUrl, 'https://h/n?lifecycle=1');
  assert.equal(await alertRenewSubscription(f, 'T', 'SUB1', '2026-10-10T08:00:00Z'), '2026-10-10T08:00:00Z');
  assert.equal(calls[3].init.method, 'PATCH');
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, 'Bearer T');
});

test('expiry stays under Microsoft\'s 7-day limit; renewal planning picks missing and soon-to-expire subscriptions', () => {
  const now = new Date('2026-10-05T08:00:00Z');
  const exp = new Date(alertExpiry(now)).getTime() - now.getTime();
  assert.ok(exp < 10_080 * 60_000 && exp > 3 * 86_400_000);
  const accounts = [
    { id: 'none', subscription_id: null, subscription_expires_at: null },
    { id: 'soon', subscription_id: 's', subscription_expires_at: '2026-10-06T08:00:00Z' },
    { id: 'fine', subscription_id: 's', subscription_expires_at: '2026-10-09T08:00:00Z' },
  ];
  assert.deepEqual(alertPlanRenewals(accounts, now).map((a) => a.id), ['none', 'soon']);
});

// ---- orchestration with an in-memory store and a fake Microsoft ----

const KEY = 'A'.repeat(43);
function setup(opts: { accounts?: Partial<AlertStored>[]; devices?: AlertDevice[]; msgs?: Record<string, GraphMessage>; pushStatus?: number; refreshFails?: string } = {}) {
  const accounts: AlertStored[] = (opts.accounts ?? []).map((a, i) => ({
    ...acct(), id: `acc${i}`, refresh_token_enc: 'unset', client_state: `cs${i}`, subscription_id: `sub${i}`, subscription_expires_at: '2026-10-09T08:00:00Z', ...a,
  }) as AlertStored);
  const devices: AlertDevice[] = opts.devices ?? [{ id: 'dev1', endpoint: 'https://push/1', p256dh: 'p', auth: 'a', lang: 'en' }];
  const seen = new Set<string>();
  const pushes: { sub: string; payload: any }[] = [];
  const graph: string[] = [];
  const store: AlertStore = {
    accountBySubscription: async (s) => accounts.find((a) => a.subscription_id === s) ?? null,
    allAccounts: async () => accounts,
    markSeen: async (a, m) => { const k = `${a}|${m}`; if (seen.has(k)) return false; seen.add(k); return true; },
    update: async (id, patch) => { Object.assign(accounts.find((a) => a.id === id)!, patch); },
    upsertAccount: async (row) => { const a = { id: `acc${accounts.length}`, ...acct(), subscription_id: null, subscription_expires_at: null, ...row } as AlertStored; accounts.push(a); return a; },
    deleteAccount: async (id) => { accounts.splice(accounts.findIndex((a) => a.id === id), 1); },
    devices: async () => devices,
    removeDevices: async (ids) => { for (const id of ids) devices.splice(devices.findIndex((x) => x.id === id), 1); },
  };
  const f = fakeFetch((url, init) => {
    graph.push(`${init.method ?? 'GET'} ${url.replace('https://graph.microsoft.com/v1.0', '')}`);
    if (url.includes('login.microsoftonline.com')) return opts.refreshFails ? { status: 400, body: { error: opts.refreshFails } } : { body: { access_token: 'AT', refresh_token: 'ROTATED' } };
    if (url.endsWith('/subscriptions') && init.method === 'POST') return { status: 201, body: { id: 'NEWSUB', expirationDateTime: '2026-10-09T08:00:00Z' } };
    if (url.includes('/subscriptions/')) return { body: { expirationDateTime: '2026-10-10T08:00:00Z' } };
    if (url.includes('/mailFolders/inbox')) return { body: { id: 'INBOX-ID' } };
    const id = decodeURIComponent(url.split('/me/messages/')[1].split('?')[0]);
    return opts.msgs?.[id] ? { body: opts.msgs[id] } : { status: 404, body: { error: { code: 'ErrorItemNotFound' } } };
  });
  const deps: AlertDeps = {
    store, fetch: f.f, clientId: 'CID', encKey: KEY, notificationUrl: 'https://h/functions/v1/post-alerts', now: () => MON_10,
    send: async (sub, payload) => { pushes.push({ sub: sub.endpoint, payload }); return opts.pushStatus ?? 201; },
  };
  return { deps, accounts, devices, pushes, graph, seen };
}
const withToken = async (a: Partial<AlertStored>) => ({ ...a, refresh_token_enc: await alertEncrypt('RT-original', KEY) });
const note = (id: string, sub = 'sub0') => ({ subscriptionId: sub, messageId: id, changeType: 'created' });

test('new mail from a person: looked up, decided and pushed to every phone, stored token rotated', async () => {
  const s = setup({ accounts: [await withToken({})], msgs: { m1: msg() }, devices: [
    { id: 'd1', endpoint: 'https://push/1', p256dh: 'p', auth: 'a', lang: 'en' }, { id: 'd2', endpoint: 'https://push/2', p256dh: 'p', auth: 'a', lang: 'nb' } ] });
  const r = await alertProcess(s.deps, [note('m1')]);
  assert.deepEqual(r, [{ id: 'm1', outcome: 'alerted (a person)' }]);
  assert.equal(s.pushes.length, 2);
  assert.equal(s.pushes[0].payload.title, 'Maja Berg');
  assert.ok(s.accounts[0].last_alert_at);
  assert.notEqual(s.accounts[0].refresh_token_enc, 'unset');
  assert.equal(await alertDecrypt(s.accounts[0].refresh_token_enc, KEY), 'ROTATED');
});

test('the same notification twice alerts once; newsletters and read mail stay quiet; unknown subscriptions are ignored', async () => {
  const news = msg({ id: 'm2', internetMessageHeaders: [{ name: 'List-Unsubscribe', value: '<x>' }] });
  const s = setup({ accounts: [await withToken({})], msgs: { m1: msg(), m2: news, m3: msg({ id: 'm3', isRead: true }) } });
  const r = await alertProcess(s.deps, [note('m1'), note('m1'), note('m2'), note('m3'), note('m4', 'nope')]);
  assert.deepEqual(r.map((x) => x.outcome), ['alerted (a person)', 'duplicate', 'skipped: bulk mail', 'skipped: already read', 'unknown subscription']);
  assert.equal(s.pushes.length, 1);
});

test('two accounts: the alert says which one; a work account is quiet after hours', async () => {
  const s = setup({ accounts: [await withToken({ label: 'Personal' }), await withToken({ label: 'Work', quiet: WORK, email: 'andreas@firma.no' })], msgs: { m1: msg() } });
  s.deps.now = () => MON_20;
  const personal = await alertProcess(s.deps, [note('m1', 'sub0')]);
  assert.equal(personal[0].outcome, 'alerted (a person)');
  assert.equal(s.pushes[0].payload.title, 'Maja Berg · Personal');
  const work = await alertProcess(s.deps, [note('m1', 'sub1')]);
  assert.match(work[0].outcome, /alert hours/);
});

test('a phone that Apple says is gone is forgotten; a failing push does not stop the rest', async () => {
  const s = setup({ accounts: [await withToken({})], msgs: { m1: msg() }, pushStatus: 410 });
  await alertProcess(s.deps, [note('m1')]);
  assert.equal(s.devices.length, 0);
  const t = setup({ accounts: [await withToken({})], msgs: { m1: msg() } });
  t.deps.send = async () => { throw new Error('network'); };
  assert.equal((await alertProcess(t.deps, [note('m1')]))[0].outcome, 'no device to alert');
});

test('a message Microsoft cannot find is reported, not thrown', async () => {
  const s = setup({ accounts: [await withToken({})], msgs: {} });
  assert.match((await alertProcess(s.deps, [note('gone')]))[0].outcome, /^error:/);
});

test('register: stores the sign-in encrypted, finds the inbox, creates the subscription; a bad sign-in leaves nothing behind', async () => {
  const s = setup();
  const r = await alertRegister(s.deps, { email: ' Andreas@Outlook.com ', label: 'Personal', refreshToken: 'RT-original', vips: ['Maja@Example.no'], quiet: { days: [5, 1, 1], from: '07:30', to: '17:00' } });
  assert.equal(r.email, 'andreas@outlook.com');
  const a = s.accounts[0];
  assert.equal(a.inbox_folder_id, 'INBOX-ID');
  assert.equal(a.subscription_id, 'NEWSUB');
  assert.deepEqual(a.vips, ['maja@example.no']);
  assert.deepEqual(a.quiet, { days: [1, 5], from: '07:30', to: '17:00' });
  assert.ok(!JSON.stringify(a).includes('RT-original'));
  assert.ok(s.graph.some((g) => g.startsWith('POST /subscriptions')));

  const bad = setup({ refreshFails: 'invalid_grant' });
  await assert.rejects(alertRegister(bad.deps, { email: 'a@b.no', refreshToken: 'x' }), (e: unknown) => e instanceof AlertGraphError);
  assert.equal(bad.accounts.length, 0);
  await assert.rejects(alertRegister(s.deps, { email: 'nope', refreshToken: 'x' }), /bad email/);
  await assert.rejects(alertRegister(s.deps, { email: 'a@b.no', refreshToken: 'x', mode: 'weird' as never }), /bad mode/);
  await assert.rejects(alertRegister(s.deps, { email: 'a@b.no', refreshToken: 'x', quiet: { days: [9], from: '07:30', to: '17:00' } }), /bad schedule/);
});

test('renewal: soon-to-expire subscriptions are extended, missing ones recreated, a revoked sign-in sends one "sign in again" alert', async () => {
  const s = setup({ accounts: [await withToken({ subscription_expires_at: '2026-10-05T20:00:00Z' }), await withToken({ subscription_id: null, subscription_expires_at: null, email: 'w@firma.no' }), await withToken({ email: 'fine@x.no' })] });
  const r = await alertRenewAll(s.deps);
  assert.deepEqual(r.map((x) => x.outcome), ['renewed', 'recreated']);
  assert.equal(s.accounts[0].subscription_expires_at, '2026-10-10T08:00:00Z');
  assert.equal(s.accounts[1].subscription_id, 'NEWSUB');

  const dead = setup({ accounts: [await withToken({ subscription_expires_at: null, label: 'Work' })], refreshFails: 'invalid_grant' });
  const d = await alertRenewAll(dead.deps);
  assert.equal(d[0].outcome, 'needs sign-in');
  assert.match(dead.pushes[0].payload.title, /sign in/i);
});

test('lifecycle: reauthorizationRequired renews, subscriptionRemoved recreates', async () => {
  const s = setup({ accounts: [await withToken({})] });
  assert.deepEqual(await alertLifecycle(s.deps, [{ subscriptionId: 'sub0', event: 'reauthorizationRequired' }]), ['renewed']);
  assert.deepEqual(await alertLifecycle(s.deps, [{ subscriptionId: 'sub0', event: 'subscriptionRemoved' }]), ['recreated']);
  assert.deepEqual(await alertLifecycle(s.deps, [{ subscriptionId: 'unknown', event: 'subscriptionRemoved' }]), []);
});

test('test alert reaches every phone', async () => {
  const s = setup();
  assert.equal(await alertTest(s.deps), 1);
  assert.equal(s.pushes[0].payload.title, 'Post alerts work');
});

test('settings: only the keys sent are changed, and bad values are refused', () => {
  assert.deepEqual(alertSettingsPatch({ mode: 'vips', vips: ['A@B.no'] }), { mode: 'vips', vips: ['a@b.no'] });
  assert.deepEqual(alertSettingsPatch({ quiet: null }), { quiet: null });
  assert.deepEqual(alertSettingsPatch({ quiet: { days: [3, 1], from: '08:00', to: '16:00' }, tz: 'Europe/Oslo', label: 'Work' }), { quiet: { days: [1, 3], from: '08:00', to: '16:00' }, tz: 'Europe/Oslo', label: 'Work' });
  assert.deepEqual(alertSettingsPatch({}), {});
  assert.throws(() => alertSettingsPatch({ mode: 'sometimes' }), /bad mode/);
  assert.throws(() => alertSettingsPatch({ vips: 'x' }), /bad vips/);
  assert.throws(() => alertSettingsPatch({ tz: '../etc' }), /bad time zone/);
  assert.throws(() => alertSettingsPatch({ quiet: { days: [], from: '8:00', to: '16:00' } }), /bad schedule/);
});

test('unregister: tells Microsoft to stop and forgets the account; an unknown address is a no-op', async () => {
  const s = setup({ accounts: [await withToken({})] });
  assert.equal(await alertUnregister(s.deps, 'nobody@x.no'), false);
  assert.equal(await alertUnregister(s.deps, ' Andreas@Outlook.com '), true);
  assert.equal(s.accounts.length, 0);
  assert.ok(s.graph.some((g) => g.startsWith('DELETE /subscriptions/sub0')));
});
