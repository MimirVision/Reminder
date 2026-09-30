import test from 'node:test';
import assert from 'node:assert/strict';
import { enqueue, flushQueue, isNetworkError, loadQueue, pendingFor, type QueuedTodo } from './outbox.ts';

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };
const todo = (id: string, o: Partial<QueuedTodo> = {}): QueuedTodo => ({ id, household_id: 'h', body: id, place_id: null, due_on: null, due_time: null, repeat_rule: null, author_id: 'u', created_at: '2026-09-30T10:00:00Z', ...o });

test('items are queued once and survive a reload', () => {
  const kv = mem();
  enqueue(kv, todo('a')); enqueue(kv, todo('a')); enqueue(kv, todo('b', { household_id: 'other' }));
  assert.deepEqual(loadQueue(kv).map((x) => x.id), ['a', 'b']);
  assert.deepEqual(pendingFor(kv, 'h').map((x) => x.id), ['a']);
});

test('corrupt storage is treated as empty', () => {
  const kv = mem(); kv.setItem('hm.outbox', '{oops');
  assert.deepEqual(loadQueue(kv), []);
  kv.setItem('hm.outbox', '[1,{"id":"x"},{"id":"y","household_id":"h"}]');
  assert.deepEqual(loadQueue(kv).map((x) => x.id), ['y']);
});

test('flush sends in order and empties the queue', async () => {
  const kv = mem(); enqueue(kv, todo('a')); enqueue(kv, todo('b'));
  const seen: string[] = [];
  const r = await flushQueue(kv, async (q) => { seen.push(q.id); });
  assert.deepEqual(seen, ['a', 'b']);
  assert.deepEqual(r, { sent: ['a', 'b'], dropped: [], left: 0 });
  assert.deepEqual(loadQueue(kv), []);
});

test('a connection problem stops the flush and keeps the rest; a refusal drops just that item', async () => {
  const kv = mem(); enqueue(kv, todo('a')); enqueue(kv, todo('b')); enqueue(kv, todo('c'));
  let n = 0;
  const r = await flushQueue(kv, async () => { n++; if (n === 1) throw new Error('row-level security violation'); if (n === 2) throw new TypeError('Failed to fetch'); });
  assert.deepEqual(r, { sent: [], dropped: ['a'], left: 2 });
  assert.deepEqual(loadQueue(kv).map((x) => x.id), ['b', 'c'], 'b and c wait for the connection');
  const again = await flushQueue(kv, async () => {});
  assert.deepEqual(again.sent, ['b', 'c']);
});

test('offline means every failure is a connection problem', async () => {
  const kv = mem(); enqueue(kv, todo('a'));
  const r = await flushQueue(kv, async () => { throw new Error('anything'); }, false);
  assert.equal(r.left, 1);
  assert.equal(isNetworkError(new Error('anything'), false), true);
  assert.equal(isNetworkError(new TypeError('Load failed')), true);
  assert.equal(isNetworkError({ message: 'TypeError: NetworkError when attempting to fetch resource.' }), true);
  assert.equal(isNetworkError(new Error('permission denied')), false);
});
