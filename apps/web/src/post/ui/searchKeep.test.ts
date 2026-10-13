import { test } from 'node:test';
import assert from 'node:assert/strict';

const mem = new Map<string, string>();
(globalThis as unknown as { localStorage: unknown }).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
const { keepSearch, searchKept, dropSearch, touchSearch, SEARCH_KEEP_MINUTES } = await import('./searchKeep.ts');

test('search is kept until cleared', () => {
  keepSearch('from:anna', null);
  assert.equal(searchKept()?.q, 'from:anna');
  keepSearch('  ', null);
  assert.equal(searchKept(), null);
  assert.equal(mem.has('post.search'), false);
});

test('search is forgotten after being away for a while, counted from when Search was left', () => {
  const real = Date.now;
  let t = real();
  Date.now = () => t;
  try {
    keepSearch('invoice', null);
    t += (SEARCH_KEEP_MINUTES - 1) * 60_000;
    assert.equal(searchKept()?.q, 'invoice');
    touchSearch();
    t += (SEARCH_KEEP_MINUTES - 1) * 60_000;
    assert.equal(searchKept()?.q, 'invoice');
    t += 2 * 60_000;
    assert.equal(searchKept(), null);
  } finally { Date.now = real; dropSearch(); }
});
