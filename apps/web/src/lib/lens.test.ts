import test from 'node:test';
import assert from 'node:assert/strict';
import { isChromium, lensMapPixels } from './lens.ts';

test('the middle of the lens is neutral and the edge pulls inwards', () => {
  const w = 200, h = 80, px = lensMapPixels(w, h);
  const at = (x: number, y: number) => { const i = (y * w + x) * 4; return [px[i], px[i + 1]]; };
  assert.deepEqual(at(100, 40).map(Math.round), [128, 128]);
  assert.ok(at(1, 40)[0] > 128 + 60, 'left edge: content is pulled to the right');
  assert.ok(at(198, 40)[0] < 128 - 60, 'right edge: pulled to the left');
  assert.ok(at(100, 1)[1] > 128 + 40, 'top edge: pulled down');
  assert.ok(at(100, 78)[1] < 128 - 40, 'bottom edge: pulled up');
});

test('only Chromium-based browsers get the lens', () => {
  assert.equal(isChromium({ userAgentData: { brands: [{ brand: 'Not.A/Brand' }, { brand: 'Chromium' }, { brand: 'Google Chrome' }] } }), true);
  assert.equal(isChromium({ userAgentData: { brands: [{ brand: 'Microsoft Edge' }] } }), true);
  assert.equal(isChromium({}), false); // Safari and Firefox have no userAgentData
});
