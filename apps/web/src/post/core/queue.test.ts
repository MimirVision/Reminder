import test from 'node:test';
import assert from 'node:assert/strict';
import { GraphError, type Graph } from './graph.ts';
import { createQueue } from './queue.ts';
import { memoryStore } from './store.ts';

function setup() {
  const store = memoryStore();
  let t = 1_000_000; let n = 0;
  const q = createQueue(store, { now: () => t, id: () => `op${++n}` });
  const calls: string[] = [];
  let failWith: Error | null = null;
  const g = {
    async move(id: string, f: string) { if (failWith) throw failWith; calls.push(`move ${id} ${f}`); return id; },
    async setRead(id: string, v: boolean) { if (failWith) throw failWith; calls.push(`read ${id} ${v}`); },
    async setFlag(id: string, v: boolean) { if (failWith) throw failWith; calls.push(`flag ${id} ${v}`); },
  } as unknown as Graph;
  return { store, q, g, calls, advance: (ms: number) => { t += ms; }, fail: (e: Error | null) => { failWith = e; } };
}

test('nothing is sent during the undo window', async () => {
  const { q, g, calls, advance } = setup();
  await q.enqueue('archive', 'a', 'm1');
  assert.deepEqual(await q.flush(() => g), { sent: 0, waiting: 1, dropped: 0 });
  advance(6001);
  assert.deepEqual(await q.flush(() => g), { sent: 1, waiting: 0, dropped: 0 });
  assert.deepEqual(calls, ['move m1 archive']);
});

test('undo cancels the call, so nothing ever reaches the server', async () => {
  const { q, g, calls, advance } = setup();
  const op = await q.enqueue('delete', 'a', 'm1');
  assert.equal(await q.cancel(op.id), true);
  advance(10_000);
  await q.flush(() => g);
  assert.deepEqual(calls, []);
});

test('undo after the call went through says "too late"', async () => {
  const { q, g, advance } = setup();
  const op = await q.enqueue('archive', 'a', 'm1');
  advance(7000);
  await q.flush(() => g);
  assert.equal(await q.cancel(op.id), false);
});

test('a newer choice replaces an older one for the same message', async () => {
  const { q, g, calls } = setup();
  await q.enqueue('read', 'a', 'm1', 0);
  await q.enqueue('unread', 'a', 'm1', 0);
  await q.flush(() => g);
  assert.deepEqual(calls, ['read m1 false']);
});

test('archive and flag on one message are independent', async () => {
  const { q, g, calls } = setup();
  await q.enqueue('flag', 'a', 'm1', 0);
  await q.enqueue('archive', 'a', 'm1', 0);
  await q.flush(() => g);
  assert.deepEqual(calls.sort(), ['flag m1 true', 'move m1 archive']);
});

test('offline: the action stays queued, counts attempts and goes through later', async () => {
  const { q, g, calls, store, fail } = setup();
  await q.enqueue('archive', 'a', 'm1', 0);
  fail(new GraphError(0, 'network', 'offline'));
  assert.deepEqual(await q.flush(() => g), { sent: 0, waiting: 1, dropped: 0 });
  assert.equal((await store.allOps())[0].attempts, 1);
  fail(null);
  assert.deepEqual(await q.flush(() => g), { sent: 1, waiting: 0, dropped: 0 });
  assert.deepEqual(calls, ['move m1 archive']);
});

test('a message that no longer exists is dropped, not retried forever', async () => {
  const { q, g, fail } = setup();
  await q.enqueue('archive', 'a', 'm1', 0);
  fail(new GraphError(404, 'ErrorItemNotFound', 'gone'));
  assert.deepEqual(await q.flush(() => g), { sent: 0, waiting: 0, dropped: 1 });
});

test('an account that is not signed in keeps its actions waiting', async () => {
  const { q } = setup();
  await q.enqueue('archive', 'a', 'm1', 0);
  assert.deepEqual(await q.flush(() => null), { sent: 0, waiting: 1, dropped: 0 });
});

test('a stubborn 400 is dropped after three tries, a 429 never is', async () => {
  const { q, g, fail } = setup();
  await q.enqueue('archive', 'a', 'm1', 0);
  fail(new GraphError(400, 'bad', 'bad'));
  await q.flush(() => g); await q.flush(() => g);
  assert.equal((await q.flush(() => g)).dropped, 1);
  await q.enqueue('archive', 'a', 'm2', 0);
  fail(new GraphError(429, 'tooMany', 'slow'));
  for (let i = 0; i < 5; i++) await q.flush(() => g);
  assert.equal((await q.pending()).length, 1);
});
