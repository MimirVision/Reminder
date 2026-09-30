import test from 'node:test';
import assert from 'node:assert/strict';
import { snapAfterDrag, snapHeights } from './sheetSnap.ts';

const h = snapHeights(800);

test('heights are ordered and fit the screen', () => {
  assert.ok(h.peek < h.half && h.half < h.full && h.full < 800);
  const small = snapHeights(480);
  assert.ok(small.peek < small.half && small.half < small.full);
});

test('a slow drag settles on the nearest height', () => {
  assert.equal(snapAfterDrag(h.peek + 10, 0, h), 'peek');
  assert.equal(snapAfterDrag(h.half - 20, 0, h), 'half');
  assert.equal(snapAfterDrag(h.full - 10, 0, h), 'full');
});

test('a flick carries to the next height', () => {
  assert.equal(snapAfterDrag(h.peek + 20, 1.2, h), 'half');
  assert.equal(snapAfterDrag(h.half, -1.5, h), 'peek');
  assert.equal(snapAfterDrag(h.half + 20, 1.5, h), 'full');
});
