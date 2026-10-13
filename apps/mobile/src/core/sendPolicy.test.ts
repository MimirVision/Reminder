import test from 'node:test';
import assert from 'node:assert/strict';
import { basicsOnly, isNetworkMessage, refusalHint } from './sendPolicy.ts';

test('connection problems are told apart from refusals', () => {
  assert.equal(isNetworkMessage('TypeError: Network request failed'), true);
  assert.equal(isNetworkMessage('The Internet connection appears to be offline.'), true);
  assert.equal(isNetworkMessage("Could not find the 'tags' column of 'memories' in the schema cache"), false);
  assert.equal(isNetworkMessage('new row violates row-level security policy'), false);
});

test('a to-do can be reduced to its basics', () => {
  const item = { id: 'a', household_id: 'h', body: 'x', place_id: null, due_on: '2026-10-13', tags: ['a'], duration_min: 30, place_trigger: 'leave', priority: 2, notes: 'n' };
  assert.deepEqual(basicsOnly(item), { id: 'a', household_id: 'h', body: 'x', place_id: null, due_on: '2026-10-13' });
});

test('a missing column points at the upgrade', () => {
  assert.equal(refusalHint("Could not find the 'tags' column of 'memories' in the schema cache"), 'upgrade');
  assert.equal(refusalHint('permission denied'), 'other');
});
