import test from 'node:test';
import assert from 'node:assert/strict';
import { connectionLost, resilientStore } from './resilient.ts';
import { memoryStore, type Store } from './store.ts';

const gone = () => Object.assign(new Error('Failed to execute \'transaction\' on \'IDBDatabase\': The database connection is closing.'), { name: 'InvalidStateError' });
const mail = (id: string) => ({ key: `a|${id}`, account: 'a', id } as any);

/** A store whose connection can be cut: while cut, every job fails like iOS says it does. */
function flaky() {
  const inner = memoryStore();
  let cut = false;
  const guard = <T,>(fn: () => Promise<T>): Promise<T> => (cut ? Promise.reject(gone()) : fn());
  const store: Store = {
    allMail: () => guard(() => inner.allMail()), getMail: (k) => guard(() => inner.getMail(k)), putMail: (m) => guard(() => inner.putMail(m)), deleteMail: (k) => guard(() => inner.deleteMail(k)),
    getBody: (k) => guard(() => inner.getBody(k)), putBody: (b) => guard(() => inner.putBody(b)), getMeta: (k) => guard(() => inner.getMeta(k)) as any, setMeta: (k, v) => guard(() => inner.setMeta(k, v)),
    allOps: () => guard(() => inner.allOps()), putOp: (o) => guard(() => inner.putOp(o)), deleteOp: (i) => guard(() => inner.deleteOp(i)), clearAccount: (a) => guard(() => inner.clearAccount(a)),
  };
  return { store, inner, cut: () => { cut = true; }, mend: () => { cut = false; } };
}

test('a lost connection to the phone\'s storage is recognised for what it says, and nothing else is', () => {
  assert.equal(connectionLost(gone()), true);
  assert.equal(connectionLost(Object.assign(new Error('Connection to Indexed Database server lost. Refresh the page to try again'), { name: 'UnknownError' })), true);
  assert.equal(connectionLost(Object.assign(new Error('x'), { name: 'TransactionInactiveError' })), true);
  assert.equal(connectionLost(Object.assign(new Error('Something else entirely'), { name: 'InvalidStateError' })), true, 'by its name alone: engines word it differently');
  assert.equal(connectionLost(Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError' })), false);
  assert.equal(connectionLost(Object.assign(new Error('boom'), { name: 'UnknownError' })), false);
  assert.equal(connectionLost('text'), false);
  assert.equal(connectionLost(null), false);
});

test('jobs go straight through while the connection is fine', async () => {
  const f = flaky();
  const s = await resilientStore(async () => f.store);
  await s.putMail([mail('1')]);
  assert.deepEqual((await s.allMail()).map((m) => m.id), ['1']);
  assert.deepEqual(s.status?.(), { kind: 'device', reopened: 0, lastError: null });
});

test('a connection lost while Post was away is opened again, and the job that failed is done, with nothing lost', async () => {
  const old = flaky();
  const fresh = flaky();
  await fresh.store.putMail([mail('kept')]); // what is on the phone, seen through the new connection
  const problems: string[] = [];
  let opens = 0;
  const s = await resilientStore(async () => (opens++ === 0 ? old.store : fresh.store), { onProblem: (k, e) => problems.push(`${k}: ${String(e)}`) });
  old.cut();                                  // the phone took the connection while the app slept
  assert.deepEqual((await s.allMail()).map((m) => m.id), ['kept'], 'asked again, through the new connection');
  assert.equal(s.status?.().reopened, 1);
  assert.equal(s.status?.().kind, 'device');
  assert.ok(problems.some((p) => /Reopened after/.test(p)));
  assert.equal(opens, 2);
  await s.putMail([mail('more')]);            // later jobs use the new connection straight away
  assert.equal(opens, 2);
});

test('other errors (a full disk) are not mistaken for a lost connection: they pass through, and nothing is reopened', async () => {
  const f = flaky();
  let opens = 0;
  const quota = Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError' });
  const broken: Store = { ...f.store, putBody: () => Promise.reject(quota) };
  const s = await resilientStore(async () => { opens++; return broken; });
  await assert.rejects(() => s.putBody({} as any), (e: Error) => e.name === 'QuotaExceededError');
  assert.equal(opens, 1);
  assert.equal(s.status?.().reopened, 0);
});

test('storage that will not come back is replaced by memory for the rest of the visit, the job still gets done, and it is said', async () => {
  const f = flaky();
  let opens = 0;
  const problems: string[] = [];
  const s = await resilientStore(async () => { if (opens++ > 0) throw new Error('cannot open'); return f.store; }, { onProblem: (k, e) => problems.push(`${k}: ${String(e)}`) });
  f.cut();
  await s.putMail([mail('2')]);                   // fails on the old connection, the new one cannot be opened: memory takes over
  assert.deepEqual((await s.allMail()).map((m) => m.id), ['2']);
  assert.equal(s.status?.().kind, 'memory');
  assert.match(s.status?.().lastError ?? '', /cannot open/);
  assert.ok(problems.some((p) => /Using memory only/.test(p)));
  assert.equal(opens, 2, 'not opened again for every job');
  await s.putMail([mail('3')]);
  assert.deepEqual((await s.allMail()).map((m) => m.id).sort(), ['2', '3']);
  assert.equal(opens, 2);
});

test('storage that cannot be opened at all from the start is memory from the start', async () => {
  const s = await resilientStore(async () => { throw new Error('blocked'); });
  await s.setMeta('k', 1);
  assert.equal(await s.getMeta('k'), 1);
  assert.equal(s.status?.().kind, 'memory');
  assert.match(s.status?.().lastError ?? '', /blocked/);
});

test('jobs that fail together reopen the connection once, and all of them are done', async () => {
  const first = flaky();
  const second = flaky();
  await second.store.putMail([mail('x')]);
  let opens = 0;
  const gate = (() => { let open!: () => void; const p = new Promise<void>((r) => { open = r; }); return { p, open }; })();
  const s = await resilientStore(async () => { opens++; if (opens === 1) return first.store; await gate.p; return second.store; });
  first.cut();
  const jobs = [s.allMail(), s.allMail(), s.getMail('a|x')];
  await new Promise((r) => setTimeout(r, 10));
  gate.open();
  const [a, b, c] = await Promise.all(jobs);
  assert.deepEqual([(a as any[]).length, (b as any[]).length, (c as any)?.id], [1, 1, 'x']);
  assert.equal(opens, 2, 'one new connection for all three');
  assert.equal(s.status?.().reopened, 1);
});
