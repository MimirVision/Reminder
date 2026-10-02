import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateMatrix, mergeDurations } from './routing.ts';

const a = { lat: 59.9139, lon: 10.7522 }, b = { lat: 59.9239, lon: 10.7522 }; // about 1.1 km apart

test('the estimate is symmetric, zero on the diagonal and plausible for a city', () => {
  const m = estimateMatrix([a, b]);
  assert.equal(m[0][0], 0);
  assert.equal(Math.round(m[0][1]), Math.round(m[1][0]));
  assert.ok(m[0][1] > 100 && m[0][1] < 200, `1.1 km at 40 km/h x1.3 is about two minutes: ${m[0][1]}`);
});

test('holes in the routing answer are filled from the estimate', () => {
  const m = mergeDurations([[0, null], [90, 0]], [a, b]);
  assert.equal(m[1][0], 90);
  assert.ok(m[0][1] > 100);
});
