import test from 'node:test';
import assert from 'node:assert/strict';
import { isHorizontal, swipeOffset, swipeResult } from './swipe.ts';

test('the row follows the finger, then resists', () => {
  assert.equal(swipeOffset(50), 50);
  assert.equal(swipeOffset(-50), -50);
  assert.ok(swipeOffset(200) < 200 && swipeOffset(200) > 96);
  assert.ok(Math.abs(swipeOffset(9999)) <= 96 * 1.6);
});

test('a long swipe or a quick flick acts; a scroll or a short drag does not', () => {
  assert.equal(swipeResult(120, 5, 600), 'done');
  assert.equal(swipeResult(-120, 5, 600), 'delete');
  assert.equal(swipeResult(60, 0, 600), null, 'short and slow');
  assert.equal(swipeResult(60, 0, 150), 'done', 'short but a flick');
  assert.equal(swipeResult(30, 0, 100), null, 'too small even for a flick');
  assert.equal(swipeResult(130, 120, 300), null, 'mostly vertical is a scroll');
});

test('horizontal detection', () => {
  assert.equal(isHorizontal(20, 4), true);
  assert.equal(isHorizontal(8, 0), false);
  assert.equal(isHorizontal(20, 20), false);
});
