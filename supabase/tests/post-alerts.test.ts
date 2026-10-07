import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AlertGraphError, alertBuild, alertCreateSubscription, alertDecide, alertDecrypt, alertEncrypt, alertExpiry, alertDeriveKey, alertEmails, alertNewVapid, alertResolveConfig, type AlertConfigStore, alertGetInboxId, alertGetMessage,
  alertKind, alertLocal, alertParseLifecycle, alertParseNotifications, alertPlanRenewals, alertRefresh, alertRenewSubscription, alertSameSecret,
  alertValidationToken, alertWithinWindow, alertProcess, alertSeen, alertCounts, alertSort, alertVerdict, alertKnownSender, alertCleanRules, alertParseTaught, alertTaughtPatch, alertTaughtDefault, alertRulesDigest, alertStatusRow, ALERT_SMART, ALERT_EXTRA_DEFAULT, type AlertTaught, type AlertExtra, alertSigninStart, alertSigninFinish, alertSigninPoll, alertSigninForget, alertFindBySession, alertMintToken, alertExchangeCode, ALERT_APP_SCOPE, alertRegister, alertSettingsPatch, alertUnregister, alertRenewAll, alertLifecycle, alertTest, type AlertAccount, type AlertDeps, type AlertDevice, type AlertStore, type AlertStored, type GraphMessage,
} from '../functions/post-alerts/logic.ts';
import { b64uToBytes, vapidAuthorization } from '../functions/notify-partner/logic.ts';
import { classify as serverClassify, signalsFromHeaders, type Kind } from '../functions/post-alerts/classify.ts';
import { classify as appClassify, rulesDigest as appRulesDigest } from '../../apps/web/src/post/core/classify.ts';

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
  assert.deepEqual(alertBuild(msg(), a, false), { title: 'Maja Berg', body: 'Re: Hytta i påska', url: '/post/#/m/a1/m1', tag: 'm1' });
  assert.equal(alertBuild(msg(), a, true).title, 'Maja Berg · Work');
  assert.equal(alertBuild(msg({ subject: '' }), a, false, 'nb').body, '(uten emne)');
  assert.equal(alertBuild(msg({ subject: 'x'.repeat(300) }), a, false).body.length, 110);
  assert.equal(alertBuild(msg({ from: undefined }), a, false).title, 'Unknown sender');
  assert.equal(alertBuild(msg({ id: 'a/b=' }), a, false).url, '/post/#/m/a1/a%2Fb%3D');
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

test('Graph: refresh asks for the same scopes as the sign-in (so the rotated refresh token keeps every permission) and returns it', async () => {
  const { f, calls } = fakeFetch(() => ({ body: { access_token: 'AT', refresh_token: 'RT2', expires_in: 3600 } }));
  const r = await alertRefresh(f, { clientId: 'CID', refreshToken: 'RT1' });
  assert.deepEqual(r, { accessToken: 'AT', refreshToken: 'RT2', expiresIn: 3600 });
  const body = new URLSearchParams(String(calls[0].init.body));
  assert.equal(body.get('grant_type'), 'refresh_token');
  assert.equal(body.get('refresh_token'), 'RT1');
  assert.equal(body.get('scope'), ALERT_APP_SCOPE);
  // Microsoft only redeems a refresh token for scopes that were in the original sign-in request: every scope asked later is in it
  for (const part of ['Mail.Read', 'Mail.ReadWrite', 'Mail.Send', 'User.Read', 'offline_access']) assert.ok(ALERT_APP_SCOPE.split(' ').some((x) => x.endsWith(part)), part);
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

test('expiry stays under the 4 230 minutes Microsoft allows personal accounts; renewal planning picks missing and soon-to-expire subscriptions', () => {
  const now = new Date('2026-10-05T08:00:00Z');
  const exp = new Date(alertExpiry(now)).getTime() - now.getTime();
  assert.ok(exp < 4_230 * 60_000 && exp > 2.5 * 86_400_000);
  const accounts = [
    { id: 'none', subscription_id: null, subscription_expires_at: null },
    { id: 'soon', subscription_id: 's', subscription_expires_at: '2026-10-06T08:00:00Z' },
    { id: 'fine', subscription_id: 's', subscription_expires_at: '2026-10-09T08:00:00Z' },
  ];
  assert.deepEqual(alertPlanRenewals(accounts, now).map((a) => a.id), ['none', 'soon']);
  // an account Microsoft refused a moment ago is left alone for half an hour, then tried again
  const refused = [{ id: 'refused', subscription_id: null, subscription_expires_at: null, sub_error_at: '2026-10-05T07:50:00Z' }];
  assert.deepEqual(alertPlanRenewals(refused, now), []);
  assert.deepEqual(alertPlanRenewals(refused, new Date('2026-10-05T08:30:00Z')).map((a) => a.id), ['refused']);
});

// ---- orchestration with an in-memory store and a fake Microsoft ----

const KEY = 'A'.repeat(43);
function setup(opts: { accounts?: Partial<AlertStored>[]; devices?: AlertDevice[]; msgs?: Record<string, GraphMessage>; pushStatus?: number; refreshFails?: string;
  /** What the phone taught the server, by account id (acc0, acc1 ...). */ taught?: Record<string, AlertTaught>;
  /** Addresses this mailbox has written to (Sent Items), or 'error' when Microsoft cannot answer. */ sent?: string[] | 'error' } = {}) {
  const accounts: AlertStored[] = (opts.accounts ?? []).map((a, i) => ({
    ...acct(), id: `acc${i}`, refresh_token_enc: 'unset', client_state: `cs${i}`, subscription_id: `sub${i}`, subscription_expires_at: '2026-10-09T08:00:00Z', ...a,
  }) as AlertStored);
  const devices: AlertDevice[] = opts.devices ?? [{ id: 'dev1', endpoint: 'https://push/1', p256dh: 'p', auth: 'a', lang: 'en' }];
  const seen = new Set<string>();
  const pushes: { sub: string; payload: any }[] = [];
  const graph: string[] = [];
  const signins = new Map<string, string>();
  const taught = new Map<string, AlertTaught>(Object.entries(opts.taught ?? {}));
  const store: AlertStore = {
    getTaught: async (id) => taught.get(id) ?? alertTaughtDefault(),
    setTaught: async (id, t) => { taught.set(id, t); },
    putSignin: async (h, e) => { signins.set(h, e); },
    takeSignin: async (h) => { const v = signins.get(h) ?? null; signins.delete(h); return v; },
    pruneSignins: async () => {},
    accountBySubscription: async (s) => accounts.find((a) => a.subscription_id === s) ?? null,
    allAccounts: async () => accounts,
    markSeen: async (a, m) => { const k = `${a}|${m}`; if (seen.has(k)) return false; seen.add(k); return true; },
    update: async (id, patch) => { Object.assign(accounts.find((a) => a.id === id)!, patch); },
    upsertAccount: async (row) => { const ex = accounts.find((x) => x.email === row.email); if (ex) { Object.assign(ex, row); return ex; } const a = { id: `acc${accounts.length}`, ...acct(), subscription_id: null, subscription_expires_at: null, ...row } as AlertStored; accounts.push(a); return a; },
    deleteAccount: async (id) => { accounts.splice(accounts.findIndex((a) => a.id === id), 1); },
    devices: async () => devices,
    removeDevices: async (ids) => { for (const id of ids) devices.splice(devices.findIndex((x) => x.id === id), 1); },
    setBadge: async (id, badge) => { const dev = devices.find((x) => x.id === id); if (dev) dev.badge = badge; },
    resetBadge: async (endpoint) => { const dev = devices.find((x) => x.endpoint === endpoint); if (dev) dev.badge = 0; return !!dev; },
  };
  const f = fakeFetch((url, init) => {
    graph.push(`${init.method ?? 'GET'} ${url.replace('https://graph.microsoft.com/v1.0', '')}`);
    if (url.includes('login.microsoftonline.com')) return opts.refreshFails ? { status: 400, body: { error: opts.refreshFails } } : { body: { access_token: 'AT', refresh_token: 'ROTATED' } };
    if (url.endsWith('/subscriptions') && init.method === 'POST') return { status: 201, body: { id: 'NEWSUB', expirationDateTime: '2026-10-09T08:00:00Z' } };
    if (url.includes('/subscriptions/')) return { body: { expirationDateTime: '2026-10-10T08:00:00Z' } };
    if (url.includes('/mailFolders/inbox')) return { body: { id: 'INBOX-ID' } };
    if (url.includes('/mailFolders/sentitems/messages')) {
      if (opts.sent === 'error' || opts.sent === undefined) return { status: 500, body: { error: { code: 'ErrorInternalServerError' } } };
      const who = /address eq '([^']+)'/.exec(decodeURIComponent(url))?.[1] ?? /"to:([^"]+)"/.exec(decodeURIComponent(url))?.[1] ?? '';
      return { body: { value: opts.sent.includes(who) ? [{ id: 'S1' }] : [] } };
    }
    const id = decodeURIComponent(url.split('/me/messages/')[1].split('?')[0]);
    return opts.msgs?.[id] ? { body: opts.msgs[id] } : { status: 404, body: { error: { code: 'ErrorItemNotFound' } } };
  });
  const deps: AlertDeps = {
    store, fetch: f.f, clientId: 'CID', encKey: KEY, notificationUrl: 'https://h/functions/v1/post-alerts', now: () => MON_10, allowedEmails: ['andreas@firma.no', 'andreas@outlook.com'],
    send: async (sub, payload) => { pushes.push({ sub: sub.endpoint, payload }); return opts.pushStatus ?? 201; },
  };
  return { deps, accounts, devices, pushes, graph, seen, signins, taught };
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
  assert.deepEqual(r.map((x) => x.outcome), ['alerted (a person)', 'duplicate', 'skipped: not in Primary (a promotion)', 'skipped: already read', 'unknown subscription']);
  assert.equal(s.pushes.length, 1);
});

test('every decision is written to the Logs with why, and with the sender\'s domain only (never a subject, a name or an address)', async () => {
  const lines: string[] = [];
  const news = msg({ id: 'm2', subject: 'Hemmelig tilbud', from: { emailAddress: { name: 'Ola Nordmann', address: 'Ola.Nordmann@Shop.no' } }, internetMessageHeaders: [{ name: 'List-Unsubscribe', value: '<x>' }] });
  const s = setup({ accounts: [await withToken({})], msgs: { m1: msg(), m2: news } });
  s.deps.log = (l) => lines.push(l);
  await alertProcess(s.deps, [note('m1'), note('m1'), note('m2'), note('m3'), note('m4', 'nope')]);
  assert.equal(lines.length, 5);
  assert.equal(lines[0], 'alerted (a person) · from example.no');
  assert.equal(lines[1], 'duplicate');
  assert.equal(lines[2], 'skipped: not in Primary (a promotion) · from shop.no');
  assert.match(lines[3], /^error: /, 'a mail Microsoft no longer has');
  assert.equal(lines[4], 'unknown subscription');
  assert.ok(!lines.join('\n').match(/Hemmelig|Ola|Maja|Berg|maja@/i), 'nothing but the domain of the sender');
  // a log that fails cannot stop an alert
  const t = setup({ accounts: [await withToken({})], msgs: { m1: msg() } });
  t.deps.log = () => { throw new Error('log is full'); };
  assert.deepEqual((await alertProcess(t.deps, [note('m1')])).map((x) => x.outcome), ['alerted (a person)']);
  assert.equal(t.pushes.length, 1);
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

test('icon number: counts alerts since the phone last opened Post, per phone, and goes back to zero when opened', async () => {
  const s = setup({ accounts: [await withToken({})], msgs: { m1: msg(), m2: msg({ id: 'm2' }), m3: msg({ id: 'm3' }) }, devices: [
    { id: 'd1', endpoint: 'https://push/1', p256dh: 'p', auth: 'a', lang: 'en', badge: 0 }, { id: 'd2', endpoint: 'https://push/2', p256dh: 'p', auth: 'a', lang: 'en', badge: 5 } ] });
  await alertProcess(s.deps, [note('m1')]);
  assert.deepEqual(s.pushes.map((p) => p.payload.badge), [1, 6]);
  await alertProcess(s.deps, [note('m2')]);
  assert.deepEqual(s.pushes.slice(2).map((p) => p.payload.badge), [2, 7]);
  assert.equal(await alertSeen(s.deps, 'https://push/1'), true);
  assert.equal(s.devices[0].badge, 0);
  assert.equal(s.devices[1].badge, 7);
  assert.equal(await alertSeen(s.deps, 'https://push/unknown'), false);
  await alertProcess(s.deps, [note('m3')]);
  assert.equal(s.pushes.at(-2)!.payload.badge, 1); // phone 1 starts again from 1
  // a phone whose push fails keeps its old number
  const f = setup({ accounts: [await withToken({})], msgs: { m1: msg() }, pushStatus: 500 });
  await alertProcess(f.deps, [note('m1')]);
  assert.equal(f.devices[0].badge ?? 0, 0);
});

function msFake(s: ReturnType<typeof setup>, mailbox = 'Andreas@Firma.no') {
  const calls: string[] = [];
  const base = s.deps.fetch;
  s.deps.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('login.microsoftonline.com') && new URLSearchParams(String(init?.body)).get('grant_type') === 'authorization_code') {
      calls.push(String(init?.body));
      return new Response(JSON.stringify({ access_token: 'FULL-AT', refresh_token: 'FULL-RT' }), { status: 200 });
    }
    if (u.includes('/me?$select=mail,userPrincipalName')) return new Response(JSON.stringify({ mail: mailbox }), { status: 200 });
    return base(url as string, init);
  }) as typeof fetch;
  return calls;
}

test('sign-in start: a Microsoft address with PKCE and a sealed state, a handle for the app, nothing stored', async () => {
  const s = setup();
  const r = await alertSigninStart(s.deps, { redirectUri: 'https://app.example/post/', hint: 'a@b.no' });
  const u = new URL(r.url);
  assert.equal(u.origin + u.pathname, 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
  assert.equal(u.searchParams.get('client_id'), 'CID');
  assert.equal(u.searchParams.get('redirect_uri'), 'https://app.example/post/');
  assert.equal(u.searchParams.get('scope'), ALERT_APP_SCOPE);
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(u.searchParams.get('login_hint'), 'a@b.no');
  const sealed = JSON.parse(await alertDecrypt(u.searchParams.get('state')!, KEY));
  assert.equal(sealed.h, r.handle);
  const expected = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sealed.v))))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.equal(u.searchParams.get('code_challenge'), expected);
  assert.ok(!r.url.includes(sealed.v), 'the PKCE secret is not readable in the address');
  assert.equal(s.accounts.length, 0);
  await assert.rejects(alertSigninStart(s.deps, { redirectUri: 'http://insecure' }), /bad request/);
});

test('sign-in finish: the code becomes a watched mailbox and a session; the result also waits for the app and is handed over once', async () => {
  const s = setup();
  const calls = msFake(s);
  const start = await alertSigninStart(s.deps, { redirectUri: 'https://app.example/post/' });
  const state = new URL(start.url).searchParams.get('state')!;
  const r = await alertSigninFinish(s.deps, { code: 'CODE', state });
  assert.equal(r.email, 'andreas@firma.no');
  assert.equal(s.accounts[0].label, 'Work');
  const sent = new URLSearchParams(calls[0]);
  assert.equal(sent.get('redirect_uri'), 'https://app.example/post/');
  assert.ok(sent.get('code_verifier')!.length >= 43);
  assert.ok(ALERT_APP_SCOPE.includes('Mail.ReadWrite') && ALERT_APP_SCOPE.includes('Mail.Send'));
  assert.ok(!JSON.stringify(s.accounts[0]).includes('FULL-RT') && !JSON.stringify(s.accounts[0]).includes(r.session.split('.')[1]));
  // the session proves the mailbox; the stored form is a hash
  assert.equal((await alertFindBySession(s.deps.store, r.session))!.email, 'andreas@firma.no');
  assert.equal(await alertFindBySession(s.deps.store, r.session + 'x'), null);
  assert.equal(await alertFindBySession(s.deps.store, null), null);
  assert.equal(await alertFindBySession(s.deps.store, `${r.id}.${'z'.repeat(43)}`), null);
  assert.equal(await alertFindBySession(s.deps.store, 'garbage'), null);
  // the app that started it (maybe a different window from the landing page) collects it once
  const polled = await alertSigninPoll(s.deps, start.handle);
  assert.equal(polled.status, 'done');
  assert.equal((polled as { session: string }).session, r.session);
  assert.deepEqual(await alertSigninPoll(s.deps, start.handle), { status: 'pending' });
  assert.deepEqual(await alertSigninPoll(s.deps, 'q'.repeat(30)), { status: 'pending' });
  await assert.rejects(alertSigninPoll(s.deps, 'short'), /bad request/);
  // landing window already has it: the app can tell the server to forget it
  const again = await alertSigninStart(s.deps, { redirectUri: 'https://app.example/post/' });
  await alertSigninFinish(s.deps, { code: 'CODE', state: new URL(again.url).searchParams.get('state')! });
  await alertSigninForget(s.deps, again.handle);
  assert.deepEqual(await alertSigninPoll(s.deps, again.handle), { status: 'pending' });
});

test('sign-in finish: a forged or expired state, and a mailbox that is not on the allowed list, store nothing', async () => {
  const s = setup();
  msFake(s);
  await assert.rejects(alertSigninFinish(s.deps, { code: 'c', state: 'v1.AAAA.BBBB' }), /did not start here/);
  await assert.rejects(alertSigninFinish(s.deps, { code: '', state: 'x' }), /bad request/);
  const start = await alertSigninStart(s.deps, { redirectUri: 'https://app.example/post/' });
  const state = new URL(start.url).searchParams.get('state')!;
  s.deps.now = () => new Date(MON_10.getTime() + 16 * 60_000);
  await assert.rejects(alertSigninFinish(s.deps, { code: 'c', state }), /took too long/);
  s.deps.now = () => MON_10;
  const stranger = setup();
  msFake(stranger, 'stranger@evil.example');
  const st = await alertSigninStart(stranger.deps, { redirectUri: 'https://app.example/post/' });
  await assert.rejects(alertSigninFinish(stranger.deps, { code: 'c', state: new URL(st.url).searchParams.get('state')! }), /stranger@evil.example is not on this server/);
  assert.equal(stranger.accounts.length, 0);
  const open = setup();
  open.deps.allowedEmails = [];
  msFake(open);
  const so = await alertSigninStart(open.deps, { redirectUri: 'https://app.example/post/' });
  await assert.rejects(alertSigninFinish(open.deps, { code: 'c', state: new URL(so.url).searchParams.get('state')! }), /select post_allow\('andreas@firma.no'\)/);
  assert.equal(open.accounts.length, 0);
});

test('sign-in finish: a code Microsoft refuses is an error and stores nothing', async () => {
  const s = setup({ refreshFails: 'invalid_grant' });
  const start = await alertSigninStart(s.deps, { redirectUri: 'https://app.example/post/' });
  await assert.rejects(alertSigninFinish(s.deps, { code: 'BAD', state: new URL(start.url).searchParams.get('state')! }), (e: unknown) => e instanceof AlertGraphError);
  assert.equal(s.accounts.length, 0);
  const r = await alertExchangeCode(fakeFetch(() => ({ body: { access_token: 'a', refresh_token: 'r' } })).f, { clientId: 'C', code: 'c', verifier: 'v', redirectUri: 'https://x' });
  assert.deepEqual(r, { accessToken: 'a', refreshToken: 'r' });
  await assert.rejects(alertExchangeCode(fakeFetch(() => ({ body: { access_token: 'a' } })).f, { clientId: 'C', code: 'c', verifier: 'v', redirectUri: 'https://x' }), /refresh token/);
});

test('a second computer signing in does not sign the first one out; only 8 sessions are kept', async () => {
  const s = setup();
  msFake(s);
  const sessions: string[] = [];
  for (let i = 0; i < 9; i++) {
    const st = await alertSigninStart(s.deps, { redirectUri: 'https://app.example/post/' });
    sessions.push((await alertSigninFinish(s.deps, { code: 'c', state: new URL(st.url).searchParams.get('state')! })).session);
  }
  assert.equal(s.accounts.length, 1, 'the same mailbox signing in again is still one mailbox');
  assert.equal((s.accounts[0].session_hashes ?? []).length, 8);
  assert.equal(await alertFindBySession(s.deps.store, sessions[0]), null, 'the oldest of nine is dropped');
  for (const x of sessions.slice(1)) assert.equal((await alertFindBySession(s.deps.store, x))!.email, 'andreas@firma.no');
});

test('mint token: a short-lived full-scope token for a known mailbox, the stored sign-in rotated, unknown mailboxes refused', async () => {
  const s = setup({ accounts: [await withToken({})] });
  const scopes: string[] = [];
  const base = s.deps.fetch;
  s.deps.fetch = (async (url: string | URL, init?: RequestInit) => {
    if (String(url).includes('login.microsoftonline.com')) scopes.push(new URLSearchParams(String(init?.body)).get('scope') ?? '');
    return base(url as string, init);
  }) as typeof fetch;
  const t = await alertMintToken(s.deps, ' Andreas@Outlook.com ');
  assert.deepEqual(t, { accessToken: 'AT', expiresIn: 3600, email: 'andreas@outlook.com' });
  assert.equal(scopes[0], ALERT_APP_SCOPE);
  assert.equal(await alertDecrypt(s.accounts[0].refresh_token_enc, KEY), 'ROTATED');
  await assert.rejects(alertMintToken(s.deps, 'nobody@x.no'), /unknown account/);
});

// ---- personal accounts: what Microsoft really does ----

test('a personal account: Microsoft caps the alert subscription at 4 230 minutes, so the request is retried shorter instead of failing the sign-in', async () => {
  const asked: { expires: string; lifecycle: boolean }[] = [];
  const f = fakeFetch((url, init) => {
    const b = JSON.parse(String(init.body));
    asked.push({ expires: b.expirationDateTime, lifecycle: 'lifecycleNotificationUrl' in b });
    const minutes = (new Date(b.expirationDateTime).getTime() - MON_10.getTime()) / 60_000;
    if (minutes > 4230) return { status: 400, body: { error: { code: 'ExtensionError', message: 'Subscription expiration can only be 4230 minutes in the future.' } } };
    return { status: 201, body: { id: 'SUB', expirationDateTime: b.expirationDateTime } };
  });
  const long = new Date(MON_10.getTime() + 5760 * 60_000).toISOString();
  const sub = await alertCreateSubscription(f.f, 'T', { notificationUrl: 'https://h/n', lifecycleUrl: 'https://h/n?lifecycle=1', clientState: 'cs', expires: long, now: () => MON_10 });
  assert.equal(sub.id, 'SUB');
  assert.equal(asked.length, 2);
  assert.ok((new Date(sub.expires).getTime() - MON_10.getTime()) / 60_000 <= 4230);
});

test('an account that does not take lifecycle notifications still gets its subscription (without them)', async () => {
  const f = fakeFetch((url, init) => {
    const b = JSON.parse(String(init.body));
    if ('lifecycleNotificationUrl' in b) return { status: 400, body: { error: { code: 'InvalidRequest', message: 'lifecycleNotificationUrl is not supported for this resource.' } } };
    return { status: 201, body: { id: 'SUB2', expirationDateTime: b.expirationDateTime } };
  });
  const sub = await alertCreateSubscription(f.f, 'T', { notificationUrl: 'https://h/n', lifecycleUrl: 'https://h/n?lifecycle=1', clientState: 'cs', expires: alertExpiry(MON_10) });
  assert.equal(sub.id, 'SUB2');
  // other 400s are real errors and are not retried forever
  const bad = fakeFetch(() => ({ status: 400, body: { error: { code: 'InvalidRequest', message: 'Nope.' } } }));
  await assert.rejects(alertCreateSubscription(bad.f, 'T', { notificationUrl: 'https://h/n', lifecycleUrl: 'x', clientState: 'cs', expires: alertExpiry(MON_10) }), /Nope/);
  assert.equal(bad.calls.length, 2, 'once with, once without lifecycle notifications');
});

test('renewing too far ahead is retried shorter too', async () => {
  let n = 0;
  const f = fakeFetch((url, init) => {
    n++;
    const b = JSON.parse(String(init.body));
    return (new Date(b.expirationDateTime).getTime() - MON_10.getTime()) / 60_000 > 4230
      ? { status: 400, body: { error: { code: 'ExtensionError', message: 'Subscription expiration can only be 4230 minutes in the future.' } } }
      : { body: { expirationDateTime: b.expirationDateTime } };
  });
  const out = await alertRenewSubscription(f.f, 'T', 'SUB1', new Date(MON_10.getTime() + 9000 * 60_000).toISOString(), () => MON_10);
  assert.equal(n, 2);
  assert.ok((new Date(out).getTime() - MON_10.getTime()) / 60_000 <= 4230);
});

test('register: if Microsoft refuses the alert subscription the sign-in is kept (mail works), the reason is stored, and the schedule retries later', async () => {
  const s = setup();
  const realFetch = s.deps.fetch;
  let refuse = true;
  s.deps.fetch = (async (url: string, init?: RequestInit) => (refuse && String(url).endsWith('/subscriptions') && init?.method === 'POST'
    ? new Response(JSON.stringify({ error: { code: 'InvalidRequest', message: 'Subscriptions are not available for this mailbox.' } }), { status: 403 })
    : realFetch(url, init))) as typeof fetch;
  const r = await alertRegister(s.deps, { email: 'andreas@outlook.com', label: 'Personal', refreshToken: 'RT-original' });
  assert.match(r.alertsError ?? '', /not available/);
  assert.equal(r.expires, '');
  const a = s.accounts[0];
  assert.equal(a.inbox_folder_id, 'INBOX-ID');
  assert.equal(a.subscription_id, null);
  assert.match(a.sub_error ?? '', /not available/);
  // just refused: opening the app does not try again at once
  assert.deepEqual(await alertRenewAll(s.deps), []);
  // later (and now allowed) the schedule creates it and the reason is gone
  refuse = false;
  s.deps.now = () => new Date(MON_10.getTime() + 31 * 60_000);
  assert.deepEqual((await alertRenewAll(s.deps)).map((x) => x.outcome), ['recreated']);
  assert.equal(a.subscription_id, 'NEWSUB');
  assert.equal(a.sub_error, null);
  // a sign-in that does not work at all (no inbox, bad token) still leaves nothing behind
  const bad = setup({ refreshFails: 'invalid_grant' });
  await assert.rejects(alertRegister(bad.deps, { email: 'a@b.no', refreshToken: 'x' }), (e: unknown) => e instanceof AlertGraphError);
  assert.equal(bad.accounts.length, 0);
});

// ---- setup without secrets ----

test('a sealing key derived from the service role key is stable, 32 bytes, different per secret, and works for sealing', async () => {
  const a = await alertDeriveKey('service-role-key-1');
  assert.equal(a, await alertDeriveKey('service-role-key-1'));
  assert.notEqual(a, await alertDeriveKey('service-role-key-2'));
  assert.equal(b64uToBytes(a).length, 32);
  assert.equal(await alertDecrypt(await alertEncrypt('RT', a), a), 'RT');
});

test('a made-up VAPID pair has the shape Web Push needs (65-byte public point, 32-byte private scalar) and signs', async () => {
  const v = await alertNewVapid();
  assert.equal(b64uToBytes(v.publicKey).length, 65);
  assert.equal(b64uToBytes(v.privateKey).length, 32);
  const header = await vapidAuthorization('https://push.example/x', 'mailto:a@b.no', b64uToBytes(v.publicKey), b64uToBytes(v.privateKey));
  assert.match(header, /^vapid t=.+\..+\..+, k=/);
});

test('address lists: commas, semicolons and spaces, any case', () => {
  assert.deepEqual(alertEmails(' Andreas@Outlook.com, andreas@firma.no;x@y.no  z@w.no '), ['andreas@outlook.com', 'andreas@firma.no', 'x@y.no', 'z@w.no']);
  assert.deepEqual(alertEmails(undefined), []);
});

function configStore(initial: Record<string, string> = {}, opts: { missing?: boolean } = {}) {
  const rows = { ...initial };
  const log: string[] = [];
  const store: AlertConfigStore = {
    load: async () => { if (opts.missing) throw new Error('relation "post_config" does not exist'); return { ...rows }; },
    putIfMissing: async (k, v) => { log.push(`putIfMissing ${k}`); if (!(k in rows)) rows[k] = v; },
    put: async (k, v) => { log.push(`put ${k}`); rows[k] = v; },
  };
  return { store, rows, log };
}
const URL_FN = 'https://proj.supabase.co/functions/v1/post-alerts';

test('config: nothing set up but the database row: client id and mailbox come from the table, the rest is made up once and kept', async () => {
  const c = configStore({ ms_client_id: '11111111-2222-3333-4444-555555555555', allowed_emails: 'andreas@outlook.com,andreas@firma.no' });
  const env = (k: string) => ({ SUPABASE_SERVICE_ROLE_KEY: 'srk' } as Record<string, string>)[k];
  const a = await alertResolveConfig(env, c.store, URL_FN);
  assert.equal(a.clientId, '11111111-2222-3333-4444-555555555555');
  assert.deepEqual(a.allowedEmails, ['andreas@outlook.com', 'andreas@firma.no']);
  assert.equal(a.encKey, await alertDeriveKey('srk'));
  assert.ok(a.vapid && b64uToBytes(a.vapid.publicKey).length === 65);
  assert.equal(a.adminKeys.length, 1);
  assert.equal(c.rows.function_url, URL_FN, 'the function tells the database where it lives, for the schedule');
  assert.equal(c.rows.cron_key, a.adminKeys[0]);
  // the second request reads the same things back and makes nothing new
  const before = c.log.length;
  const b = await alertResolveConfig(env, c.store, URL_FN);
  assert.deepEqual(b.vapid, a.vapid);
  assert.deepEqual(b.adminKeys, a.adminKeys);
  assert.equal(c.log.length, before);
});

test('config: Supabase secrets win over the table, and a VAPID pair from the environment is used as given (shared with Home Memory)', async () => {
  const c = configStore({ ms_client_id: 'from-table', allowed_emails: 'table@x.no' });
  const env = (k: string) => ({ MS_CLIENT_ID: 'from-env', POST_ALLOWED_EMAILS: 'Env@x.no', ALERTS_ENC_KEY: 'K'.repeat(43), VAPID_PUBLIC_KEY: 'PUB', VAPID_PRIVATE_KEY: 'PRIV', POST_ALERTS_KEY: 'secret-key', SUPABASE_SERVICE_ROLE_KEY: 'srk' } as Record<string, string>)[k];
  const a = await alertResolveConfig(env, c.store, URL_FN);
  assert.equal(a.clientId, 'from-env');
  assert.deepEqual(a.allowedEmails, ['env@x.no', 'table@x.no']);
  assert.equal(a.encKey, 'K'.repeat(43));
  assert.deepEqual(a.vapid, { publicKey: 'PUB', privateKey: 'PRIV' });
  assert.ok(a.adminKeys.includes('secret-key') && a.adminKeys.includes(c.rows.cron_key), 'the schedule key from the table keeps working');
  assert.equal('vapid' in c.rows, false, 'no pair is made when one is given');
});

test('config: before the post_config table exists the function still runs on secrets alone, and makes nothing up it cannot keep', async () => {
  const c = configStore({}, { missing: true });
  const a = await alertResolveConfig((k) => ({ MS_CLIENT_ID: 'cid', ALERTS_ENC_KEY: 'K'.repeat(43) } as Record<string, string>)[k], c.store, URL_FN);
  assert.equal(a.clientId, 'cid');
  assert.equal(a.vapid, null);
  assert.deepEqual(a.adminKeys, []);
  assert.deepEqual(c.log, []);
  const none = await alertResolveConfig(() => undefined, configStore().store, URL_FN);
  assert.equal(none.clientId, null);
  assert.equal(none.encKey, null, 'without the service role key (or ALERTS_ENC_KEY) nothing can be sealed');
});

// ---- smarter alerts: the icon number follows the Primary tab ----

const hdr = (...h: [string, string][]) => h.map(([name, value]) => ({ name, value }));
const UNSUB = hdr(['List-Unsubscribe', '<mailto:u@example.com>'], ['List-Id', '<news.example.com>']);
const IN_REPLY = hdr(['In-Reply-To', '<abc@mail.example.com>'], ['References', '<abc@mail.example.com>']);
const mail = (name: string, address: string, subject: string, bodyPreview = '', h: { name: string; value: string }[] = []): GraphMessage =>
  msg({ from: { emailAddress: { name, address } }, subject, bodyPreview, internetMessageHeaders: h });
/** A Microsoft that has never seen the person write to anyone. */
const nobodyWrittenTo = () => fakeFetch(() => ({ body: { value: [] } }));
const taughtOf = (rules: Record<string, Kind>, extra: AlertExtra): AlertStore => ({ getTaught: async () => ({ rules, extra }) } as unknown as AlertStore);

// The made-up mailbox of the picture the owner was shown (17 mails): who adds to the number today, and with each of the three choices.
const PLAN: { who: string; m: GraphMessage; rules?: Record<string, Kind>; today: boolean; primary: boolean; codes: boolean; transactions: boolean }[] = [
  { who: 'Anna', m: mail('Anna Berg', 'anna.berg@gmail.com', 'Middag på fredag?', 'Hei! Har du lyst til å komme på middag fredag? Vi tenkte kl 18.'), today: true, primary: true, codes: true, transactions: true },
  { who: 'Ola (a reply)', m: mail('Ola Hansen', 'ola@hansen-bygg.no', 'Re: Takterrassen – tegninger', 'Her er de oppdaterte tegningene, ta en titt.', IN_REPLY), today: true, primary: true, codes: true, transactions: true },
  { who: 'Mamma', m: mail('Mamma', 'kari.nordmann@online.no', 'Ring meg', 'Ring meg når du har tid, ikke viktig.'), today: true, primary: true, codes: true, transactions: true },
  { who: 'Kasper ("tilbud" from a person)', m: mail('Kasper Lie', 'kasper@startupx.com', 'Tilbud på bilen?', 'Jeg kan gi deg 85 000 for bilen. Passer det?'), today: true, primary: true, codes: true, transactions: true },
  { who: 'Posten', m: mail('Posten', 'varsling@posten.no', 'Pakken din er på vei', 'Pakken fra Komplett leveres i morgen mellom 12 og 16.'), today: true, primary: false, codes: false, transactions: true },
  { who: 'Telenor', m: mail('Telenor', 'faktura@telenor.no', 'Faktura for september', 'Du har en ny faktura på 899 kr som forfaller 15. oktober.'), today: true, primary: false, codes: false, transactions: true },
  { who: 'Elkjøp', m: mail('Elkjøp', 'kundeservice@elkjop.no', 'Din ordrebekreftelse #4471920', 'Takk for bestillingen! Vi pakker varene dine nå.'), today: true, primary: false, codes: false, transactions: true },
  { who: 'Nordlys', m: mail('Nordlys Interiør', 'post@nordlys-interior.no', 'Sommersalg: 30 % på alt', 'Bare denne uken: 30 % rabatt på alle møbler og lamper.'), today: true, primary: false, codes: false, transactions: false },
  { who: 'Legesenteret', m: mail('Legesenteret', 'post@legesenteret.no', 'Timeavtale mandag 10. oktober kl 09:30', 'Du har time hos dr. Solheim. Møt opp 10 minutter før.'), today: true, primary: false, codes: false, transactions: true },
  { who: 'Kjøkkenhuset (moved to Promotions)', m: mail('Bjørn fra Kjøkkenhuset', 'bjorn@kjokkenhuset.no', 'Nytt fra Kjøkkenhuset', 'Se hva som skjer i butikken denne høsten.'), rules: { '@kjokkenhuset.no': 'promo' }, today: true, primary: false, codes: false, transactions: false },
  { who: 'Google sign-in alert', m: mail('Google', 'no-reply@accounts.google.com', 'Security alert: new sign-in on Pixel 9', 'Your Google Account was just signed in to from a new Pixel 9 device.'), today: false, primary: false, codes: true, transactions: true },
  { who: 'GitHub code', m: mail('GitHub', 'noreply@github.com', 'Your verification code is 482913', 'Here is your GitHub verification code: 482913. It expires in 10 minutes.'), today: false, primary: false, codes: true, transactions: true },
  { who: 'Morgenbladet (moved to Primary)', m: mail('Morgenbladet', 'nyhetsbrev@morgenbladet.no', 'Ukens utgave er her', 'Dette står i ukens Morgenbladet.', UNSUB), rules: { 'nyhetsbrev@morgenbladet.no': 'person' }, today: false, primary: true, codes: true, transactions: true },
  { who: 'Microsoft code', m: mail('Microsoft account team', 'account-security-noreply@accountprotection.microsoft.com', 'Microsoft account security code', 'Use this security code: 284 091'), today: true, primary: false, codes: true, transactions: true },
  { who: 'REMA newsletter', m: mail('REMA 1000', 'nyhetsbrev@rema.no', 'Ukens tilbud: gratis frakt og 20 % på kaffe', 'Dette er ukens tilbud i butikk og nett.', UNSUB), today: false, primary: false, codes: false, transactions: false },
  { who: 'GitHub notification', m: mail('GitHub', 'notifications@github.com', '[reminder] Pull request #12 merged', 'Merged #12 into the default branch.'), today: false, primary: false, codes: false, transactions: false },
  { who: 'Vipps receipt', m: mail('Vipps', 'no-reply@vipps.no', 'Kvittering fra Vipps', 'Du betalte 129 kr til Kaffebrenneriet.'), today: false, primary: false, codes: false, transactions: true },
];

test('the plan the owner was shown: 17 made-up mails, today and with each of the three choices for what counts besides Primary', async () => {
  const total = { today: 0, primary: 0, codes: 0, transactions: 0 };
  for (const e of PLAN) {
    assert.equal(alertKind(e.m) === 'person', e.today, `${e.who}: today`);
    for (const [extra, key] of [['none', 'primary'], ['codes', 'codes'], ['transactions', 'transactions']] as const) {
      const v = await alertVerdict({ store: taughtOf(e.rules ?? {}, extra), fetch: nobodyWrittenTo().f, now: () => MON_10 }, 'T', e.m, acct());
      assert.equal(v.send, e[key], `${e.who}: ${extra} (${v.reason})`);
      if (v.send) total[key]++;
    }
    if (e.today) total.today++;
  }
  assert.deepEqual(total, { today: 11, primary: 5, codes: 8, transactions: 13 });
});

test('counting: a person always; a security code or a sign-in alert unless the choice is "Primary only"; the rest of Transactions only on request; everything else never', () => {
  const s = (kind: Kind, code = false, unsure = false) => ({ kind, why: [], code, unsure });
  assert.deepEqual(alertCounts(s('person'), 'none'), { count: true, reason: 'a person' });
  assert.equal(alertCounts(s('transaction', true), 'none').count, false);
  assert.equal(alertCounts(s('transaction', true), 'none').reason, 'not in Primary (a security code)');
  assert.deepEqual(alertCounts(s('transaction', true), 'codes'), { count: true, reason: 'a security code or sign-in alert' });
  assert.equal(alertCounts(s('transaction', false), 'codes').count, false);
  assert.equal(alertCounts(s('transaction', false), 'codes').reason, 'not in Primary (a receipt, delivery or booking)');
  assert.deepEqual(alertCounts(s('transaction'), 'transactions'), { count: true, reason: 'a receipt, delivery or booking' });
  for (const extra of ['none', 'codes', 'transactions'] as AlertExtra[]) {
    assert.equal(alertCounts(s('promo'), extra).count, false);
    assert.equal(alertCounts(s('update'), extra).count, false);
  }
  assert.equal(alertCounts(s('promo'), 'transactions').reason, 'not in Primary (a promotion)');
  assert.deepEqual(alertCounts(s('promo', false, true), 'none'), { count: true, reason: 'could not tell, so it counts' }); // unsure: a missed mail is worse than an extra one
});

test('what the person taught: a sender beats its company, a code from a sender moved to Transactions still counts, a VIP always gets through, other modes ignore it all', async () => {
  const d = (rules: Record<string, Kind>, extra: AlertExtra = 'codes') => ({ store: taughtOf(rules, extra), fetch: nobodyWrittenTo().f, now: () => MON_10 });
  const shop = mail('Bjørn fra Kjøkkenhuset', 'bjorn@kjokkenhuset.no', 'Nytt fra Kjøkkenhuset');
  assert.equal((await alertVerdict(d({}), 'T', shop, acct())).send, true, 'a plain mail from a person-like sender counts');
  assert.equal((await alertVerdict(d({ '@kjokkenhuset.no': 'promo' }), 'T', shop, acct())).send, false, 'the whole company moved');
  assert.equal((await alertVerdict(d({ '@kjokkenhuset.no': 'promo', 'bjorn@kjokkenhuset.no': 'person' }), 'T', shop, acct())).send, true, 'this sender beats the company');
  assert.equal((await alertVerdict(d({ '@kjokkenhuset.no': 'promo' }), 'T', shop, acct({ vips: ['Bjorn@Kjokkenhuset.no'] }))).reason, 'VIP', 'a VIP breaks through');
  // Codes: a sender the person put in Transactions still gets its codes through; one put in Promotions does not.
  const code = mail('DNB', 'varsel@dnb.no', 'Din engangskode er 394 118', 'Bruk koden 394 118 for å logge inn.');
  assert.equal((await alertVerdict(d({ 'varsel@dnb.no': 'transaction' }), 'T', code, acct())).reason, 'a security code or sign-in alert');
  assert.equal((await alertVerdict(d({ 'varsel@dnb.no': 'promo' }), 'T', code, acct())).send, false);
  assert.equal((await alertVerdict(d({ 'varsel@dnb.no': 'transaction' }, 'none'), 'T', code, acct())).send, false, '"Primary only"');
  // "All mail", "VIPs" and "Off" never look at the sorting (and never read the choices).
  let reads = 0;
  const counting = { getTaught: async () => { reads++; return alertTaughtDefault(); } } as unknown as AlertStore;
  const dd = { store: counting, fetch: nobodyWrittenTo().f, now: () => MON_10 };
  assert.equal((await alertVerdict(dd, 'T', shop, acct({ mode: 'all' }))).reason, 'all mail');
  assert.equal((await alertVerdict(dd, 'T', shop, acct({ mode: 'vips' }))).reason, 'not a VIP');
  assert.equal((await alertVerdict(dd, 'T', shop, acct({ mode: 'off' }))).send, false);
  assert.equal(reads, 0);
  // The schedule, read mail and other folders still come first.
  assert.match((await alertVerdict({ ...d({}), now: () => MON_20 }, 'T', shop, acct({ quiet: WORK }))).reason, /alert hours/);
  assert.equal((await alertVerdict(d({}), 'T', shop, acct({ quiet: WORK }))).send, true, 'inside the hours');
  assert.equal((await alertVerdict(d({}), 'T', { ...shop, isRead: true }, acct())).reason, 'already read');
});

test('written to this address: Sent Items is asked only when it could change the verdict, and a question Microsoft cannot answer means the mail counts', async () => {
  const invoice = mail('Ola Hansen', 'ola@hansen-bygg.no', 'Faktura 1042 – baderom', 'Her er fakturaen for baderommet.'); // a person you write to sends an invoice
  const ask = async (m: GraphMessage, sent: string[] | 'error') => {
    const s = setup({ accounts: [await withToken({})], msgs: { m1: m }, sent });
    const [r] = await alertProcess(s.deps, [note('m1')]);
    return { outcome: r.outcome, lookups: s.graph.filter((g) => g.includes('/mailFolders/sentitems/messages')) };
  };
  const yes = await ask(invoice, ['ola@hansen-bygg.no']);
  assert.equal(yes.outcome, 'alerted (a person)');
  assert.equal(yes.lookups.length, 1);
  assert.match(decodeURIComponent(yes.lookups[0]), /toRecipients\/any\(r:r\/emailAddress\/address eq 'ola@hansen-bygg\.no'\)/);
  const no = await ask(invoice, []);
  assert.equal(no.outcome, 'skipped: not in Primary (a receipt, delivery or booking)');
  assert.equal(no.lookups.length, 1);
  const unknown = await ask(invoice, 'error');
  assert.equal(unknown.outcome, 'alerted (could not tell, so it counts)');
  // Having written to a company's mailbox changes nothing for its invoices (the sorting says so), so Sent Items is not even asked. Nor for a person.
  assert.deepEqual(await ask(mail('Telenor', 'faktura@telenor.no', 'Faktura for september', 'Du har en ny faktura.'), ['faktura@telenor.no']), { outcome: 'skipped: not in Primary (a receipt, delivery or booking)', lookups: [] });
  assert.deepEqual(await ask(mail('Anna Berg', 'anna.berg@gmail.com', 'Middag?'), []), { outcome: 'alerted (a person)', lookups: [] });
});

test('Sent Items lookup: a filter on the recipient, a search when the filter is refused, nothing asked for a nonsense address, an error when Microsoft cannot answer', async () => {
  const a = fakeFetch(() => ({ body: { value: [{ id: 'S1' }] } }));
  assert.equal(await alertKnownSender(a.f, 'T', ' Ola@Hansen-Bygg.no '), true);
  assert.equal(a.calls.length, 1);
  assert.match(decodeURIComponent(a.calls[0].url), /\/me\/mailFolders\/sentitems\/messages\?\$filter=toRecipients\/any\(r:r\/emailAddress\/address eq 'ola@hansen-bygg\.no'\)&\$top=1&\$select=id$/);
  assert.equal((a.calls[0].init.headers as Record<string, string>).Authorization, 'Bearer T');
  assert.equal(await alertKnownSender(fakeFetch(() => ({ body: { value: [] } })).f, 'T', 'x@y.no'), false);
  const refused = fakeFetch((url) => (url.includes('%24filter') || url.includes('$filter') ? { status: 400, body: { error: { code: 'InefficientFilter' } } } : { body: { value: [{ id: 'S1' }] } }));
  assert.equal(await alertKnownSender(refused.f, 'T', 'x@y.no'), true);
  assert.equal(refused.calls.length, 2);
  assert.match(decodeURIComponent(refused.calls[1].url), /\$search="to:x@y\.no"/);
  const none = fakeFetch(() => ({ body: {} }));
  for (const bad of ['', 'not an address', "o'brien@x.no", 'a"b@x.no']) assert.equal(await alertKnownSender(none.f, 'T', bad), false, bad);
  assert.equal(none.calls.length, 0);
  await assert.rejects(alertKnownSender(fakeFetch(() => ({ status: 500, body: { error: { code: 'x' } } })).f, 'T', 'x@y.no'));
});

test('Primary mode through the whole chain: the choices stored for the mailbox are applied, and only mail that counts adds to the icon number', async () => {
  const s = setup({
    accounts: [await withToken({})], devices: [{ id: 'd1', endpoint: 'https://push/1', p256dh: 'p', auth: 'a', lang: 'en', badge: 0 }],
    taught: { acc0: { rules: { '@kjokkenhuset.no': 'promo', 'nyhetsbrev@morgenbladet.no': 'person' }, extra: 'codes' } },
    msgs: {
      person: mail('Anna Berg', 'anna.berg@gmail.com', 'Middag?'), parcel: { ...mail('Posten', 'varsling@posten.no', 'Pakken din er på vei', 'Leveres i morgen.'), id: 'parcel' },
      shop: { ...mail('Bjørn', 'bjorn@kjokkenhuset.no', 'Nytt fra Kjøkkenhuset'), id: 'shop' }, code: { ...mail('GitHub', 'noreply@github.com', 'Your verification code is 482913'), id: 'code' },
      news: { ...mail('Morgenbladet', 'nyhetsbrev@morgenbladet.no', 'Ukens utgave', '', UNSUB), id: 'news' },
    },
  });
  const r = await alertProcess(s.deps, ['person', 'parcel', 'shop', 'code', 'news'].map((id) => note(id)));
  assert.deepEqual(r.map((x) => x.outcome), [
    'alerted (a person)', 'skipped: not in Primary (a receipt, delivery or booking)', 'skipped: not in Primary (a promotion)', 'alerted (a security code or sign-in alert)', 'alerted (a person)',
  ]);
  assert.equal(s.devices[0].badge, 3, 'the number counts the three that were alerted');
  assert.deepEqual(s.pushes.map((p) => p.payload.badge), [1, 2, 3]);
});

test('what the phone sends is checked, merged key by key and read back defensively', () => {
  assert.deepEqual(alertCleanRules({ 'Anna@X.no ': 'person', '@Shop.no': 'promo' }), { 'anna@x.no': 'person', '@shop.no': 'promo' });
  for (const bad of [null, [], 'x', { 'anna@x.no': 'friend' }, { 'not an address': 'person' }, { '@': 'promo' }, { 'a@b@c': 'promo' }, { ['x'.repeat(130) + '@a.no']: 'promo' }]) assert.throws(() => alertCleanRules(bad), /bad rules/, JSON.stringify(bad));
  assert.throws(() => alertCleanRules(Object.fromEntries(Array.from({ length: 1001 }, (_, i) => [`u${i}@x.no`, 'promo']))), /too many rules/);
  assert.equal(Object.keys(alertCleanRules(Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`u${i}@x.no`, 'promo'])))).length, 1000);

  const base: AlertTaught = { rules: { 'a@x.no': 'promo' }, extra: 'codes' };
  assert.deepEqual(alertTaughtPatch(base, { extra: 'none' }), { rules: { 'a@x.no': 'promo' }, extra: 'none' }, 'only the key that was sent changes');
  assert.deepEqual(alertTaughtPatch(base, { rules: {} }), { rules: {}, extra: 'codes' }, 'an empty list forgets every rule');
  assert.deepEqual(alertTaughtPatch(base, {}), base);
  assert.throws(() => alertTaughtPatch(base, { extra: 'everything' }), /bad extra/);
  assert.deepEqual(base, { rules: { 'a@x.no': 'promo' }, extra: 'codes' }, 'what was stored is not changed in place');

  assert.deepEqual(alertParseTaught(null), { rules: {}, extra: ALERT_EXTRA_DEFAULT });
  assert.equal(ALERT_EXTRA_DEFAULT, 'codes');
  assert.deepEqual(alertParseTaught('not json'), alertTaughtDefault());
  assert.deepEqual(alertParseTaught(JSON.stringify({ rules: { 'a@x.no': 'promo', 'bad key': 'promo', 'b@x.no': 'nonsense' }, extra: 'weird' })), { rules: { 'a@x.no': 'promo' }, extra: 'codes' });
  assert.deepEqual(alertParseTaught(JSON.stringify({ rules: 'x', extra: 'none' })), { rules: {}, extra: 'none' });
});

test('the fingerprint of the choices is the one the app computes, whatever the order or case', () => {
  const rules: Record<string, Kind> = { 'b@x.no': 'promo', '@Shop.no': 'update', 'a@x.no': 'person' };
  assert.equal(alertRulesDigest({ rules, extra: 'codes' }), appRulesDigest(rules));
  assert.equal(alertRulesDigest({ rules: { 'a@x.no': 'person', '@shop.no': 'update', 'b@x.no': 'promo' }, extra: 'none' }), alertRulesDigest({ rules, extra: 'codes' }), 'order, case and the "extra" do not matter');
  assert.notEqual(alertRulesDigest({ rules: { ...rules, 'c@x.no': 'promo' }, extra: 'codes' }), alertRulesDigest({ rules, extra: 'codes' }));
  assert.notEqual(alertRulesDigest({ rules: { ...rules, 'b@x.no': 'update' }, extra: 'codes' }), alertRulesDigest({ rules, extra: 'codes' }));
  assert.match(alertRulesDigest(alertTaughtDefault()), /^0:/);
});

test('the status the app reads: the settings of the mailbox with what counts besides Primary and the fingerprint of the choices', () => {
  const a = { ...acct(), refresh_token_enc: 'x', client_state: 'c', subscription_id: 's', subscription_expires_at: '2026-10-09T08:00:00Z', last_alert_at: '2026-10-05T07:00:00Z' } as AlertStored;
  const row = alertStatusRow(a, { rules: { 'a@x.no': 'promo' }, extra: 'transactions' });
  assert.deepEqual(row, {
    id: 'a1', email: 'andreas@outlook.com', label: 'Personal', mode: 'people', quiet: null, vips: [], subscription_expires_at: '2026-10-09T08:00:00Z',
    last_alert_at: '2026-10-05T07:00:00Z', sub_error: null, extra: 'transactions', rules_digest: appRulesDigest({ 'a@x.no': 'promo' }),
  });
  assert.equal(ALERT_SMART, 1);
});

test('the server sorts with the app’s own rules: the copy it runs gives the same verdict as the app for every example', async () => {
  for (const e of PLAN) {
    const addr = e.m.from!.emailAddress!.address!;
    const input = { fromAddress: addr, fromName: e.m.from!.emailAddress!.name, subject: e.m.subject!, preview: e.m.bodyPreview, signals: signalsFromHeaders(e.m.internetMessageHeaders) };
    assert.deepEqual(appClassify(input, { overrides: e.rules }), serverClassify(input, { overrides: e.rules }), e.who);
    const s = alertSort(e.m, { rules: e.rules ?? {}, extra: 'codes' }, []);
    assert.deepEqual({ kind: s.kind, why: s.why }, appClassify(input, { overrides: e.rules }), `${e.who}: the verdict the server used`);
  }
});
