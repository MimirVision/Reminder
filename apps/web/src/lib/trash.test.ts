import test from 'node:test';
import assert from 'node:assert/strict';
import { daysSince, newestFirst } from './trash.ts';

test('days since deletion', () => {
  const now = new Date('2026-10-24T12:00:00Z');
  assert.equal(daysSince('2026-10-24T08:00:00Z', now), 0);
  assert.equal(daysSince('2026-10-22T08:00:00Z', now), 2);
  assert.equal(daysSince(undefined, now), 0);
  assert.equal(daysSince('2026-11-01T00:00:00Z', now), 0, 'never negative');
});

test('newest deleted first, falling back to created', () => {
  const list = [{ id: 'a', created_at: '2026-01-01', updated_at: '2026-10-01' }, { id: 'b', created_at: '2026-02-01', updated_at: '2026-10-20' }, { id: 'c', created_at: '2026-10-22' }];
  assert.deepEqual(newestFirst(list).map((x) => x.id), ['c', 'b', 'a']);
});
