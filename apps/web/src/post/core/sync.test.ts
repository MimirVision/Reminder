import test from 'node:test';
import assert from 'node:assert/strict';
import { GraphError, type Graph, type RawMessage } from './graph.ts';
import { memoryStore } from './store.ts';
import { reclassifyAll, syncAccount } from './sync.ts';

type Page = { value: RawMessage[]; next?: string; delta?: string };
const raw = (id: string, o: Partial<RawMessage> = {}): RawMessage => ({ id, subject: `s${id}`, receivedDateTime: '2026-10-01T10:00:00Z', from: { emailAddress: { name: 'Anna', address: 'anna@x.no' } }, isRead: false, ...o });

function fakeGraph(pages: (Page | Error)[], headers: Record<string, { name: string; value: string }[]> = {}) {
  const asked: { link?: string; since?: string }[] = [];
  const g = {
    async deltaPage(_f: string, link?: string, since?: string) { asked.push({ link, since }); const p = pages.shift(); if (!p) throw new Error('no page'); if (p instanceof Error) throw p; return p; },
    async batch(calls: { url: string }[]) { return calls.map((c) => { const id = decodeURIComponent(/messages\/([^?]+)/.exec(c.url)![1]); return headers[id] ? { status: 200, body: { internetMessageHeaders: headers[id] } } : { status: 200, body: { internetMessageHeaders: [] } }; }); },
  } as unknown as Graph;
  return { g, asked };
}

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

test('snooze survives an update from the server', async () => {
  const store = memoryStore();
  await syncAccount({ graph: fakeGraph([{ value: [raw('1')], delta: 'D1' }]).g, store, account: 'a' });
  const m = (await store.getMail('a|1'))!;
  await store.putMail([{ ...m, snoozedUntil: '2026-10-06T08:00:00Z' }]);
  await syncAccount({ graph: fakeGraph([{ value: [raw('1', { isRead: true })], delta: 'D2' }]).g, store, account: 'a' });
  assert.equal((await store.getMail('a|1'))!.snoozedUntil, '2026-10-06T08:00:00Z');
});

test('headers sharpen the sorting once, and are not asked for again', async () => {
  const store = memoryStore();
  const news = raw('1', { from: { emailAddress: { name: 'Butikk', address: 'tilbud@butikk.no' } } });
  const r = await syncAccount({ graph: fakeGraph([{ value: [news, raw('2')], delta: 'D1' }], { '1': [{ name: 'List-Unsubscribe', value: '<https://u>' }] }).g, store, account: 'a' });
  assert.equal(r.enriched, 2);
  assert.equal((await store.getMail('a|1'))!.kind, 'newsletter');
  assert.equal((await store.getMail('a|2'))!.kind, 'person');
  const again = await syncAccount({ graph: fakeGraph([{ value: [], delta: 'D2' }]).g, store, account: 'a' });
  assert.equal(again.enriched, 0);
  // an update from the server keeps the sharper verdict
  await syncAccount({ graph: fakeGraph([{ value: [{ ...news, isRead: true }], delta: 'D3' }]).g, store, account: 'a' });
  assert.equal((await store.getMail('a|1'))!.kind, 'newsletter');
});

test('moving a sender overrides, and un-moving it restores the automatic verdict', async () => {
  const store = memoryStore();
  await syncAccount({ graph: fakeGraph([{ value: [raw('1')], delta: 'D1' }]).g, store, account: 'a' });
  await reclassifyAll(store, { 'anna@x.no': 'newsletter' });
  assert.equal((await store.getMail('a|1'))!.kind, 'newsletter');
  await reclassifyAll(store, {});
  assert.equal((await store.getMail('a|1'))!.kind, 'person');
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
