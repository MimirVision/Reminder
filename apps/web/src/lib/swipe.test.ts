import test from 'node:test';
import assert from 'node:assert/strict';
import { isHorizontal, swipeOffset, swipeResult, tabSwipe } from './swipe.ts';

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

test('swiping the tabs: one step, or all the way with a long flick; a scroll or a small drag changes nothing', () => {
  assert.equal(tabSwipe(-80, 4, 500, 0, 5), 1, 'left goes on');
  assert.equal(tabSwipe(80, 4, 500, 2, 5), 1, 'right goes back');
  assert.equal(tabSwipe(-80, 4, 500, 4, 5), null, 'already on the last one');
  assert.equal(tabSwipe(80, 4, 500, 0, 5), null, 'already on the first one');
  assert.equal(tabSwipe(-220, 10, 200, 0, 5), 4, 'a long flick to the left lands on the last tab (All)');
  assert.equal(tabSwipe(220, 10, 200, 3, 5), 0, 'and to the right on the first');
  assert.equal(tabSwipe(-220, 10, 800, 0, 5), 1, 'long but slow is still one step');
  assert.equal(tabSwipe(-40, 0, 500, 0, 5), null, 'short and slow');
  assert.equal(tabSwipe(-40, 0, 150, 0, 5), 1, 'short but a flick');
  assert.equal(tabSwipe(-20, 0, 100, 0, 5), null, 'too small even for a flick');
  assert.equal(tabSwipe(-100, 90, 300, 0, 5), null, 'mostly vertical is a scroll');
  assert.equal(tabSwipe(-100, 0, 300, 0, 1), null, 'one tab has nowhere to go');
});
