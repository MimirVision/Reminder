import test from 'node:test';
import assert from 'node:assert/strict';
import { GraphError, type Graph, type RawMessage } from './graph.ts';
import { memoryStore } from './store.ts';
import { ensureClassifierVersion, enrichHeaders, loadKnown, reclassifyAll, refreshKnown, rememberKnown, syncAccount } from './sync.ts';
import { CLASSIFIER_VERSION } from './classify.ts';

type Page = { value: RawMessage[]; next?: string; delta?: string };
const raw = (id: string, o: Partial<RawMessage> = {}): RawMessage => ({ id, subject: `s${id}`, receivedDateTime: '2026-10-01T10:00:00Z', from: { emailAddress: { name: 'Anna', address: 'anna@x.no' } }, isRead: false, ...o });

type Answer = { status: number; body: any; retryAfter?: number };
function fakeGraph(pages: (Page | Error)[], headers: Record<string, { name: string; value: string }[]> = {}, o: { batch?: (calls: { url: string }[]) => Promise<Answer[]>; sent?: string[][] } = {}) {
  const asked: { link?: string; since?: string }[] = [];
  const batches: string[][] = [];
  const idOf = (c: { url: string }) => decodeURIComponent(/messages\/([^?]+)/.exec(c.url)![1]);
  const g = {
    async deltaPage(_f: string, link?: string, since?: string) { asked.push({ link, since }); const p = pages.shift(); if (!p) throw new Error('no page'); if (p instanceof Error) throw p; return p; },
    async batch(calls: { url: string }[]) {
      batches.push(calls.map(idOf));
      if (o.batch) return await o.batch(calls);
      return calls.map((c) => { const id = idOf(c); return { status: 200, body: { internetMessageHeaders: headers[id] ?? [] } }; });
    },
    async sentRecipients(pagesWanted: number) { batches.push([`sent:${pagesWanted}`]); return (o.sent ?? []).flat(); },
  } as unknown as Graph;
  return { g, asked, batches };
}
const UNSUB = [{ name: 'List-Unsubscribe', value: '<https://u>' }];
const shop = (id: string, o: Partial<RawMessage> = {}) => raw(id, { from: { emailAddress: { name: 'Butikk', address: 'tilbud@butikk.no' } }, ...o });

test('first sync reads all pages, stores them and remembers the delta link', async () => {
  const store = memoryStore();
  const { g, asked } = fakeGraph([{ value: [raw('1')], next: 'n2' }, { value: [raw('2')], delta: 'D1' }]);
  const r = await syncAccount({ graph: g, store, account: 'a@o.no', now: () => new Date('2026-10-05T00:00:00Z') });
  assert.equal(r.added, 2);
  assert.equal((await store.allMail()).length, 2);
  assert.equal(await store.getMeta('a@o.no|delta'), 'D1');
  assert.ok(asked[0].since && asked[0].since < '2026-09-25');
  assert.equal(asked[1].link, 'n2');
});

test('later syncs start from the saved delta link and apply updates and removals', async () => {
  const store = memoryStore();
  await syncAccount({ graph: fakeGraph([{ value: [raw('1'), raw('2')], delta: 'D1' }]).g, store, account: 'a' });
  const { g, asked } = fakeGraph([{ value: [raw('1', { isRead: true }), { id: '2', '@removed': { reason: 'deleted' } }, raw('3')], delta: 'D2' }]);
  const r = await syncAccount({ graph: g, store, account: 'a' });
  assert.equal(asked[0].link, 'D1');
  assert.deepEqual([r.added, r.changed, r.removed], [1, 1, 1]);
  const all = await store.allMail();
  assert.deepEqual(all.map((m) => m.id).sort(), ['1', '3']);
  assert.equal(all.find((m) => m.id === '1')!.isRead, true);
});

test('a half-finished sync (connection drops on page 2) changes nothing', async () => {
  const store = memoryStore();
  await syncAccount({ graph: fakeGraph([{ value: [raw('1')], delta: 'D1' }]).g, store, account: 'a' });
  const { g } = fakeGraph([{ value: [raw('9')], next: 'n' }, new GraphError(0, 'network', 'offline')]);
  await assert.rejects(() => syncAccount({ graph: g, store, account: 'a' }));
  assert.deepEqual((await store.allMail()).map((m) => m.id), ['1']);
  assert.equal(await store.getMeta('a|delta'), 'D1');
});

test('410 gone: starts over from scratch and says so', async () => {
  const store = memoryStore();
  await syncAccount({ graph: fakeGraph([{ value: [raw('1')], delta: 'D1' }]).g, store, account: 'a' });
  const { g, asked } = fakeGraph([new GraphError(410, 'SyncStateNotFound', 'gone'), { value: [raw('1'), raw('5')], delta: 'D9' }]);
  const r = await syncAccount({ graph: g, store, account: 'a' });
  assert.equal(r.resynced, true);
  assert.equal(asked[1].link, undefined);
  assert.equal(await store.getMeta('a|delta'), 'D9');
});

test('other errors are not swallowed', async () => {
  const { g } = fakeGraph([new GraphError(500, 'x', 'boom')]);
  await assert.rejects(() => syncAccount({ graph: g, store: memoryStore(), account: 'a' }), /boom/);
});

test('a message with a pending local action is not overwritten or resurrected by the server copy', async () => {
  const store = memoryStore();
  await syncAccount({ graph: fakeGraph([{ value: [raw('1'), raw('2')], delta: 'D1' }]).g, store, account: 'a' });
  await store.deleteMail(['a|1']); // archived locally, the server has not been told yet
  await store.putOp({ id: 'o', type: 'archive', account: 'a', messageId: '1', runAfter: 0, attempts: 0 });
  await syncAccount({ graph: fakeGraph([{ value: [raw('1'), raw('2', { isRead: true })], delta: 'D2' }]).g, store, account: 'a' });
  assert.deepEqual((await store.allMail()).map((m) => m.id), ['2']);
});

test('the first sort uses the sender and the words; the header marks sharpen it afterwards, once', async () => {
  const store = memoryStore();
  await syncAccount({ graph: fakeGraph([{ value: [shop('1', { subject: 'Nyheter fra oss' }), raw('2')], delta: 'D1' }]).g, store, account: 'a' });
  assert.deepEqual((await store.allMail()).map((m) => m.sig), [undefined, undefined]);
  const { g, batches } = fakeGraph([], { '1': UNSUB });
  const r = await enrichHeaders({ graph: g, store, account: 'a', ctx: () => ({}) });
  assert.deepEqual([r.checked, r.left, r.slow], [2, 0, false]);
  assert.equal(batches.length, 1);
  const one = (await store.getMail('a|1'))!;
  assert.deepEqual(one.sig, ['unsub']);
  assert.equal(one.kind, 'update'); // "Nyheter" says news
  assert.ok(one.why.includes('Has an unsubscribe link'));
  const two = (await store.getMail('a|2'))!;
  assert.deepEqual([two.sig, two.kind], [[], 'person']);
  // nothing is asked twice, and an update from Outlook keeps what was read
  assert.deepEqual(await enrichHeaders({ graph: fakeGraph([]).g, store, account: 'a', ctx: () => ({}) }), { checked: 0, left: 0, slow: false });
  await syncAccount({ graph: fakeGraph([{ value: [shop('1', { subject: 'Nyheter fra oss', isRead: true })], delta: 'D2' }]).g, store, account: 'a' });
  assert.deepEqual([(await store.getMail('a|1'))!.sig, (await store.getMail('a|1'))!.kind], [['unsub'], 'update']);
});

test('mail with unsubscribe marks and no other hint is a promotion, and the reason is shown', async () => {
  const store = memoryStore();
  await syncAccount({ graph: fakeGraph([{ value: [shop('1', { subject: 'Hei fra oss' })], delta: 'D1' }]).g, store, account: 'a' });
  await enrichHeaders({ graph: fakeGraph([], { '1': UNSUB }).g, store, account: 'a', ctx: () => ({}) });
  const m = (await store.getMail('a|1'))!;
  assert.equal(m.kind, 'promo');
  assert.ok(m.why.includes('Has an unsubscribe link'));
});

test('headers are read for the newest first, in groups of 20, and every message is checked', async () => {
  const store = memoryStore();
  const many = Array.from({ length: 45 }, (_, i) => raw(`m${String(i).padStart(2, '0')}`, { receivedDateTime: `2026-10-01T10:${String(i).padStart(2, '0')}:00Z` }));
  await syncAccount({ graph: fakeGraph([{ value: many, delta: 'D1' }]).g, store, account: 'a' });
  const seen: number[] = [];
  const { g, batches } = fakeGraph([]);
  const r = await enrichHeaders({ graph: g, store, account: 'a', ctx: () => ({}), onProgress: (left) => { seen.push(left); } });
  assert.deepEqual(batches.map((b) => b.length), [20, 20, 5]);
  assert.equal(batches[0][0], 'm44', 'the newest message goes first');
  assert.deepEqual(seen, [25, 5, 0]);
  assert.deepEqual([r.checked, r.left], [45, 0]);
  assert.ok((await store.allMail()).every((m) => m.sig !== undefined));
});

test('when Microsoft says slow down: smaller groups, a pause as long as it asked, and nothing is lost', async () => {
  const store = memoryStore();
  await syncAccount({ graph: fakeGraph([{ value: Array.from({ length: 30 }, (_, i) => raw(`m${i}`)), delta: 'D1' }]).g, store, account: 'a' });
  let n = 0;
  const { g, batches } = fakeGraph([], {}, { batch: async (calls) => (n++ === 0
    ? calls.map((_c, i) => (i < 8 ? { status: 200, body: { internetMessageHeaders: UNSUB } } : { status: 429, body: null, retryAfter: 6 }))
    : calls.map(() => ({ status: 200, body: { internetMessageHeaders: [] } }))) });
  const sleeps: number[] = [];
  const r = await enrichHeaders({ graph: g, store, account: 'a', ctx: () => ({}), sleep: async (ms) => { sleeps.push(ms); } });
  assert.deepEqual(sleeps, [6000]);
  assert.deepEqual(batches.map((b) => b.length), [20, 10, 12]); // 20, then half of 20, then growing again
  assert.deepEqual([r.checked, r.left, r.slow], [30, 0, true]);
});

test('header reading gives up when nothing gets through, and tries again next time', async () => {
  const store = memoryStore();
  await syncAccount({ graph: fakeGraph([{ value: Array.from({ length: 100 }, (_, i) => raw(`m${i}`)), delta: 'D1' }]).g, store, account: 'a' });
  const { g, batches } = fakeGraph([], {}, { batch: async (calls) => calls.map(() => ({ status: 403, body: null })) });
  const r = await enrichHeaders({ graph: g, store, account: 'a', ctx: () => ({}), sleep: async () => {} });
  assert.deepEqual([r.checked, r.left], [0, 100]);
  assert.ok(batches.length <= 3, `asked ${batches.length} times`);
  const alwaysSlow = fakeGraph([], {}, { batch: async (calls) => calls.map(() => ({ status: 429, body: null })) });
  const r2 = await enrichHeaders({ graph: alwaysSlow.g, store, account: 'a', ctx: () => ({}), sleep: async () => {} });
  assert.deepEqual([r2.checked, r2.left, r2.slow], [0, 100, true]);
  assert.ok(alwaysSlow.batches.length <= 3);
});

test('one message that cannot be read does not hold up the others, and a message that is gone is not asked about again', async () => {
  const store = memoryStore();
  await syncAccount({ graph: fakeGraph([{ value: [raw('bad', { receivedDateTime: '2026-10-02T00:00:00Z' }), raw('gone', { receivedDateTime: '2026-10-01T23:00:00Z' }), raw('ok')], delta: 'D1' }]).g, store, account: 'a' });
  const { g } = fakeGraph([], {}, { batch: async (calls) => calls.map((c) => (/bad/.test(c.url) ? { status: 500, body: null } : /gone/.test(c.url) ? { status: 404, body: null } : { status: 200, body: { internetMessageHeaders: UNSUB } })) });
  const r = await enrichHeaders({ graph: g, store, account: 'a', ctx: () => ({}) });
  assert.deepEqual([r.checked, r.left], [2, 1]);
  assert.equal((await store.getMail('a|bad'))!.sig, undefined);
  assert.deepEqual((await store.getMail('a|gone'))!.sig, []);
});

test('a choice made while headers are being read is used for the next group', async () => {
  const store = memoryStore();
  await syncAccount({ graph: fakeGraph([{ value: Array.from({ length: 25 }, (_, i) => shop(`m${i}`, { receivedDateTime: `2026-10-01T10:${String(i).padStart(2, '0')}:00Z` })), delta: 'D1' }]).g, store, account: 'a' });
  let ctx: { overrides?: Record<string, 'person'> } = {};
  const r = await enrichHeaders({ graph: fakeGraph([], { m24: UNSUB }).g, store, account: 'a', ctx: () => ctx, onProgress: () => { ctx = { overrides: { 'tilbud@butikk.no': 'person' } }; } });
  assert.equal(r.checked, 25);
  assert.equal((await store.getMail('a|m24'))!.kind, 'promo', 'the first group was sorted before the choice');
  assert.equal((await store.getMail('a|m0'))!.kind, 'person', 'the second group saw the new choice');
});

test('reading headers never overwrites what you did meanwhile (read, flag)', async () => {
  const store = memoryStore();
  await syncAccount({ graph: fakeGraph([{ value: [raw('1')], delta: 'D1' }]).g, store, account: 'a' });
  const { g } = fakeGraph([], {}, { batch: async (calls) => {
    const m = (await store.getMail('a|1'))!;
    await store.putMail([{ ...m, isRead: true, flagged: true }]); // the person acts while the answer is on its way
    return calls.map(() => ({ status: 200, body: { internetMessageHeaders: UNSUB } }));
  } });
  await enrichHeaders({ graph: g, store, account: 'a', ctx: () => ({}) });
  const m = (await store.getMail('a|1'))!;
  assert.deepEqual([m.isRead, m.flagged, m.sig], [true, true, ['unsub']]);
});

test('it can be stopped, and it never asks more than it was told to', async () => {
  const store = memoryStore();
  await syncAccount({ graph: fakeGraph([{ value: Array.from({ length: 50 }, (_, i) => raw(`m${i}`)), delta: 'D1' }]).g, store, account: 'a' });
  const capped = await enrichHeaders({ graph: fakeGraph([]).g, store, account: 'a', ctx: () => ({}), max: 25 });
  assert.deepEqual([capped.checked, capped.left], [25, 25]);
  const stopped = await enrichHeaders({ graph: fakeGraph([]).g, store, account: 'a', ctx: () => ({}), stop: () => true });
  assert.deepEqual([stopped.checked, stopped.left], [0, 25]);
});

test('a connection error while reading headers is thrown, with nothing half written', async () => {
  const store = memoryStore();
  await syncAccount({ graph: fakeGraph([{ value: [raw('1')], delta: 'D1' }]).g, store, account: 'a' });
  const { g } = fakeGraph([], {}, { batch: async () => { throw new GraphError(0, 'network', 'offline'); } });
  await assert.rejects(() => enrichHeaders({ graph: g, store, account: 'a', ctx: () => ({}) }), /offline/);
  assert.equal((await store.getMail('a|1'))!.sig, undefined);
});

test('header marks from an older version of the sorting are forgotten once, so every message is asked about again', async () => {
  const store = memoryStore();
  await syncAccount({ graph: fakeGraph([{ value: [shop('1')], delta: 'D1' }]).g, store, account: 'a' });
  await enrichHeaders({ graph: fakeGraph([], { '1': UNSUB }).g, store, account: 'a', ctx: () => ({}) });
  assert.equal(await store.getMeta('a|classifier'), CLASSIFIER_VERSION);
  assert.equal(await ensureClassifierVersion(store, 'a'), false);
  await store.setMeta('a|classifier', CLASSIFIER_VERSION - 1);
  assert.equal(await ensureClassifierVersion(store, 'a'), true);
  assert.equal((await store.getMail('a|1'))!.sig, undefined);
  assert.equal(await store.getMeta('a|classifier'), CLASSIFIER_VERSION);
});

test('Outlook\'s own Focused/Other guess is saved with the message', async () => {
  const store = memoryStore();
  await syncAccount({ graph: fakeGraph([{ value: [raw('1', { inferenceClassification: 'other' }), raw('2', { inferenceClassification: 'focused' }), raw('3')], delta: 'D1' }]).g, store, account: 'a' });
  assert.deepEqual((await store.allMail()).sort((x, y) => x.id.localeCompare(y.id)).map((m) => m.inf), ['other', 'focused', undefined]);
});

test('re-sorting applies a moved sender, a company, a VIP or a person you wrote to, and only touches what changed', async () => {
  const store = memoryStore();
  await syncAccount({ graph: fakeGraph([{ value: [raw('1'), shop('2')], delta: 'D1' }]).g, store, account: 'a' });
  assert.equal(await reclassifyAll(store, {}), 0);
  assert.equal(await reclassifyAll(store, { overrides: { 'anna@x.no': 'update' } }), 1);
  assert.equal((await store.getMail('a|1'))!.kind, 'update');
  assert.equal(await reclassifyAll(store, { overrides: { '@butikk.no': 'promo' } }), 2); // anna goes back, the shop is moved by company
  assert.deepEqual([(await store.getMail('a|1'))!.kind, (await store.getMail('a|2'))!.kind], ['person', 'promo']);
  assert.equal((await store.getMail('a|2'))!.why[0], 'You moved everything from butikk.no here');
  assert.equal(await reclassifyAll(store, { vips: new Set(['tilbud@butikk.no']) }), 1);
  assert.deepEqual((await store.getMail('a|2'))!.why, ['On your VIP list']);
});

test('re-sorting keeps what you did meanwhile', async () => {
  const store = memoryStore();
  await syncAccount({ graph: fakeGraph([{ value: [raw('1')], delta: 'D1' }]).g, store, account: 'a' });
  const real = store.getMail;
  let first = true;
  store.getMail = async (k) => { if (first) { first = false; const m = (await real(k))!; await store.putMail([{ ...m, isRead: true }]); } return await real(k); };
  await reclassifyAll(store, { overrides: { 'anna@x.no': 'promo' } });
  assert.deepEqual([(await real('a|1'))!.isRead, (await real('a|1'))!.kind], [true, 'promo']);
});

test('people you have written to: first a few hundred sent messages, then the newest hundred at most every six hours', async () => {
  const store = memoryStore();
  const t0 = Date.parse('2026-10-05T10:00:00Z');
  const first = fakeGraph([], {}, { sent: [['anna@x.no', 'per@x.no']] });
  assert.equal(await refreshKnown({ graph: first.g, store, account: 'a', now: () => t0 }), true);
  assert.deepEqual(first.batches, [['sent:3']]);
  const soon = fakeGraph([], {}, { sent: [['new@x.no']] });
  assert.equal(await refreshKnown({ graph: soon.g, store, account: 'a', now: () => t0 + 3_600_000 }), false);
  assert.deepEqual(soon.batches, []);
  const later = fakeGraph([], {}, { sent: [['new@x.no', 'anna@x.no']] });
  assert.equal(await refreshKnown({ graph: later.g, store, account: 'a', now: () => t0 + 7 * 3_600_000 }), true);
  assert.deepEqual(later.batches, [['sent:1']]);
  assert.deepEqual([...await loadKnown(store, ['a'])].sort(), ['anna@x.no', 'new@x.no', 'per@x.no']);
  assert.deepEqual([...await loadKnown(store, ['a', 'b'])].length, 3);
});

test('writing to someone makes them known at once, and the address is lower-cased', async () => {
  const store = memoryStore();
  assert.equal(await rememberKnown(store, 'a', ['Kari@X.no', 'not an address', 'kari@x.no']), true);
  assert.equal(await rememberKnown(store, 'a', ['kari@x.no']), false);
  assert.deepEqual([...await loadKnown(store, ['a'])], ['kari@x.no']);
  // Sent Items has still never been read, so the first look is the thorough one
  const look = fakeGraph([], {}, { sent: [['per@x.no']] });
  assert.equal(await refreshKnown({ graph: look.g, store, account: 'a', now: () => Date.parse('2026-10-05T10:00:00Z') }), true);
  assert.deepEqual(look.batches, [['sent:3']]);
  assert.deepEqual([...await loadKnown(store, ['a'])].sort(), ['kari@x.no', 'per@x.no']);
});

test('forgetting an account forgets who it wrote to, and what it learned about headers', async () => {
  const store = memoryStore();
  await rememberKnown(store, 'a', ['kari@x.no']);
  await ensureClassifierVersion(store, 'a');
  await store.clearAccount('a');
  assert.equal((await loadKnown(store, ['a'])).size, 0);
  assert.equal(await store.getMeta('a|classifier'), undefined);
});

test('after a start-over, mail that Outlook no longer lists is removed, but older mail outside the window stays', async () => {
  const store = memoryStore();
  const old = raw('old', { receivedDateTime: '2026-01-01T00:00:00Z' });
  await syncAccount({ graph: fakeGraph([{ value: [raw('1'), raw('2'), old], delta: 'D1' }]).g, store, account: 'a', now: () => new Date('2026-01-02T00:00:00Z') });
  const { g } = fakeGraph([new GraphError(410, 'SyncStateNotFound', 'gone'), { value: [raw('1')], delta: 'D9' }]);
  const r = await syncAccount({ graph: g, store, account: 'a', now: () => new Date('2026-10-05T00:00:00Z') });
  assert.equal(r.resynced, true);
  // '2' is gone (it left the inbox elsewhere); 'old' predates the 45-day window so it is simply not part of this answer.
  assert.deepEqual((await store.allMail()).map((m) => m.id).sort(), ['1', 'old']);
});

test('a first sync shows mail as pages arrive, and a drop halfway keeps what arrived without a delta link', async () => {
  const store = memoryStore();
  const { g } = fakeGraph([{ value: [raw('1')], next: 'n' }, new GraphError(0, 'network', 'offline')]);
  await assert.rejects(() => syncAccount({ graph: g, store, account: 'a' }));
  assert.deepEqual((await store.allMail()).map((m) => m.id), ['1']);
  assert.equal(await store.getMeta('a|delta'), undefined);
  const r = await syncAccount({ graph: fakeGraph([{ value: [raw('1'), raw('2')], delta: 'D1' }]).g, store, account: 'a' });
  assert.deepEqual([r.added, r.changed], [1, 1]);
});

test('the start-over does not remove mail with an action still waiting', async () => {
  const store = memoryStore();
  await syncAccount({ graph: fakeGraph([{ value: [raw('1'), raw('2')], delta: 'D1' }]).g, store, account: 'a' });
  await store.putOp({ id: 'o', type: 'read', account: 'a', messageId: '2', runAfter: 0, attempts: 0 });
  await syncAccount({ graph: fakeGraph([new GraphError(410, 'SyncStateNotFound', 'gone'), { value: [raw('1')], delta: 'D2' }]).g, store, account: 'a' });
  assert.deepEqual((await store.allMail()).map((m) => m.id).sort(), ['1', '2']);
});
