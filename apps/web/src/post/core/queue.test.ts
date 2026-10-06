import test from 'node:test';
import assert from 'node:assert/strict';
import { GraphError, type Graph } from './graph.ts';
import { createQueue } from './queue.ts';
import { memoryStore, type Store } from './store.ts';

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

test('a moved message tells where it went, so something waiting for it can follow', async () => {
  const store = memoryStore();
  const moved: string[] = [];
  const q = createQueue(store, { now: () => 1_000_000, id: () => 'op', onMoved: (a, o, n) => { moved.push(`${a}:${o}>${n}`); } });
  const g = { async move(id: string) { return `${id}-in-archive`; } } as unknown as Graph;
  await q.enqueue('archive', 'a', 'm1', 0);
  await q.flush(() => g);
  assert.deepEqual(moved, ['a:m1>m1-in-archive']);
  // a move that keeps the id, or a notice that fails, changes nothing for the action itself
  const same = { async move(id: string) { return id; } } as unknown as Graph;
  await q.enqueue('archive', 'a', 'm2', 0);
  await q.flush(() => same);
  assert.equal(moved.length, 1);
  const broken = createQueue(store, { now: () => 1_000_000, id: () => 'op3', onMoved: () => { throw new Error('disk'); } });
  await broken.enqueue('delete', 'a', 'm3', 0);
  assert.deepEqual(await broken.flush(() => g), { sent: 1, waiting: 0, dropped: 0 });
});

test('an action Outlook refuses for good is given up on, and said so (a message that is gone is not)', async () => {
  const store = memoryStore();
  const refused: string[] = [];
  const q = createQueue(store, { now: () => 1_000_000, id: (() => { let n = 0; return () => `op${++n}`; })(), onRefused: (op, e) => { refused.push(`${op.type} ${op.messageId} ${e.status}`); } });
  let failWith: Error = new GraphError(403, 'ErrorAccessDenied', 'no');
  const g = { async move() { throw failWith; } } as unknown as Graph;
  await q.enqueue('archive', 'a', 'm1', 0);
  await q.flush(() => g); await q.flush(() => g);
  assert.deepEqual(refused, [], 'not at once: a passing refusal is tried again');
  await q.flush(() => g);
  assert.deepEqual(refused, ['archive m1 403']);
  failWith = new GraphError(404, 'ErrorItemNotFound', 'gone');
  await q.enqueue('archive', 'a', 'm2', 0);
  await q.flush(() => g);
  assert.deepEqual(refused, ['archive m1 403'], 'gone is not a refusal');
});

test('two runs at once carry each action out once, and the second still picks up what was added meanwhile', async () => {
  const store = memoryStore();
  const q = createQueue(store, { now: () => 1_000_000, id: (() => { let n = 0; return () => `op${++n}`; })() });
  const calls: string[] = [];
  let open!: () => void;
  const gate = new Promise<void>((r) => { open = r; });
  const g = { async setRead(id: string) { calls.push(`read ${id}`); await gate; } } as unknown as Graph;
  await q.enqueue('read', 'a', 'm1', 0);
  const first = q.flush(() => g);
  const second = q.flush(() => g);
  await new Promise((r) => setTimeout(r, 10));
  await q.enqueue('read', 'a', 'm2', 0);
  open();
  const [a, b] = await Promise.all([first, second]);
  assert.deepEqual(calls, ['read m1', 'read m2']);
  assert.deepEqual(a, b);
  assert.equal(a.sent, 2);
});

test('a run asked for in the very moment another is finishing is not lost', async () => {
  const inner = memoryStore();
  const calls: string[] = [];
  const g = { async setRead(id: string) { calls.push(`read ${id}`); } } as unknown as Graph;
  let q!: ReturnType<typeof createQueue>;
  let sentOne = false, fired = false;
  const store: Store = {
    ...inner,
    async deleteOp(id) { await inner.deleteOp(id); sentOne = true; },
    async allOps() {
      const list = await inner.allOps();
      // The run has just sent the last action it knew of and is looking at the list once more, to say how many still wait: this is when the next tap comes.
      if (sentOne && !fired) { fired = true; await q.enqueue('read', 'a', 'm2', 0); void q.flush(() => g); }
      return list;
    },
  };
  q = createQueue(store, { now: () => 1_000_000, id: (() => { let n = 0; return () => `op${++n}`; })() });
  await q.enqueue('read', 'a', 'm1', 0);
  const r = await q.flush(() => g);
  assert.deepEqual(calls, ['read m1', 'read m2'], 'the second one was not left for the next time someone looks');
  assert.deepEqual(r, { sent: 2, waiting: 0, dropped: 0 });
});

test('a run that fails altogether (the phone would not open its storage) does not stop the next one', async () => {
  const inner = memoryStore();
  let broken = false;
  const store: Store = { ...inner, async allOps() { if (broken) throw new Error('the phone would not open its storage'); return inner.allOps(); } };
  const calls: string[] = [];
  const g = { async setRead(id: string) { calls.push(`read ${id}`); } } as unknown as Graph;
  const q = createQueue(store, { now: () => 1_000_000, id: () => 'op1' });
  await q.enqueue('read', 'a', 'm1', 0);
  broken = true;
  await assert.rejects(q.flush(() => g), /would not open/);
  broken = false;
  assert.deepEqual(await q.flush(() => g), { sent: 1, waiting: 0, dropped: 0 });
  assert.deepEqual(calls, ['read m1']);
});

test('a run for everything asked for in that same moment is not turned into an ordinary one', async () => {
  const inner = memoryStore();
  const calls: string[] = [];
  const g = { async setRead(id: string) { calls.push(`read ${id}`); }, async move(id: string) { calls.push(`move ${id}`); return id; } } as unknown as Graph;
  let q!: ReturnType<typeof createQueue>;
  let sentOne = false, fired = false;
  const store: Store = {
    ...inner,
    async deleteOp(id) { await inner.deleteOp(id); sentOne = true; },
    async allOps() {
      const list = await inner.allOps();
      if (sentOne && !fired) { fired = true; await q.enqueue('archive', 'a', 'm2'); void q.flush(() => g, true); } // inside its undo window, and the app is leaving
      return list;
    },
  };
  q = createQueue(store, { now: () => 1_000_000, id: (() => { let n = 0; return () => `op${++n}`; })() });
  await q.enqueue('read', 'a', 'm1', 0);
  await q.flush(() => g);
  assert.deepEqual(calls, ['read m1', 'move m2']);
  // and the wish to take everything is used up by that run: the next ordinary one leaves what is still inside its window alone
  await q.enqueue('archive', 'a', 'm3');
  assert.deepEqual(await q.flush(() => g), { sent: 0, waiting: 1, dropped: 0 });
});

test('the wish to take everything is used up by the go it was asked for, not by every go after it', async () => {
  const store = memoryStore();
  const q = createQueue(store, { now: () => 1_000_000, id: (() => { let n = 0; return () => `op${++n}`; })() });
  const calls: string[] = [];
  const gates: Array<() => void> = [];
  const hold = () => new Promise<void>((r) => { gates.push(r); });
  const g = { async setRead(id: string) { calls.push(`read ${id}`); await hold(); }, async move(id: string) { calls.push(`move ${id}`); await hold(); return id; } } as unknown as Graph;
  await q.enqueue('read', 'a', 'm1', 0);
  const first = q.flush(() => g);                         // go 1: an ordinary one, held up at m1
  await new Promise((r) => setTimeout(r, 10));
  await q.enqueue('archive', 'a', 'm2');                  // inside its undo window
  void q.flush(() => g, true);                            // the app is leaving: go 2 takes everything
  gates.shift()!();
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(calls, ['read m1', 'move m2'], 'go 2 is held up at m2');
  await q.enqueue('archive', 'a', 'm3');                  // inside its undo window, added while go 2 is going
  void q.flush(() => g);                                  // an ordinary run is asked for: go 3
  gates.shift()!();
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(calls, ['read m1', 'move m2'], 'go 3 leaves m3 alone: it is not the one that was asked to take everything');
  assert.deepEqual(await first, { sent: 2, waiting: 1, dropped: 0 });
});

test('a run for everything (the app is leaving) also takes what is still inside its undo window', async () => {
  const { q, g, calls } = setup();
  await q.enqueue('archive', 'a', 'm1');
  assert.deepEqual(await q.flush(() => g), { sent: 0, waiting: 1, dropped: 0 });
  assert.deepEqual(await q.flush(() => g, true), { sent: 1, waiting: 0, dropped: 0 });
  assert.deepEqual(calls, ['move m1 archive']);
});

test('a run for everything asked for while an ordinary run is going is carried out after it', async () => {
  const store = memoryStore();
  const q = createQueue(store, { now: () => 1_000_000, id: (() => { let n = 0; return () => `op${++n}`; })() });
  const calls: string[] = [];
  let open!: () => void;
  const gate = new Promise<void>((r) => { open = r; });
  const g = { async setRead(id: string) { calls.push(`read ${id}`); await gate; }, async move(id: string) { calls.push(`move ${id}`); return id; } } as unknown as Graph;
  await q.enqueue('read', 'a', 'm1', 0);
  const first = q.flush(() => g);
  await new Promise((r) => setTimeout(r, 10));
  await q.enqueue('archive', 'a', 'm2'); // inside its undo window
  const second = q.flush(() => g, true);
  open();
  await Promise.all([first, second]);
  assert.deepEqual(calls, ['read m1', 'move m2']);
});
