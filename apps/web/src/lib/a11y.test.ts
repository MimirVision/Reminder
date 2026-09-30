import test from 'node:test';
import assert from 'node:assert/strict';
import { parseContrast, parseTextSize } from './a11y.ts';

test('unknown stored values fall back to the defaults', () => {
  assert.equal(parseTextSize('xl'), 'xl');
  assert.equal(parseTextSize('large'), 'large');
  assert.equal(parseTextSize('huge'), 'normal');
  assert.equal(parseTextSize(null), 'normal');
  assert.equal(parseContrast('high'), 'high');
  assert.equal(parseContrast('x'), 'normal');
});
