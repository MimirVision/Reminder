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

test('the tabs: only a hard, quick flick to the left jumps to the last one (All); everything else is the row scrolling', () => {
  assert.equal(tabSwipe(-260, 10, 150, 0, 5), 4, 'a hard flick to the left lands on the last tab');
  assert.equal(tabSwipe(-260, 10, 150, 3, 5), 4, 'from any tab');
  assert.equal(tabSwipe(-260, 10, 150, 4, 5), null, 'already on the last one');
  assert.equal(tabSwipe(260, 10, 150, 2, 5), null, 'to the right is only scrolling back');
  assert.equal(tabSwipe(-260, 10, 450, 0, 5), null, 'long but slow is scrolling');
  assert.equal(tabSwipe(-120, 0, 60, 0, 5), null, 'quick but short is scrolling');
  assert.equal(tabSwipe(-80, 0, 300, 0, 5), null, 'a drag to see the other tabs');
  assert.equal(tabSwipe(-260, 140, 150, 0, 5), null, 'mostly vertical is a scroll');
  assert.equal(tabSwipe(-260, 0, 150, 0, 1), null, 'one tab has nowhere to go');
  assert.equal(tabSwipe(-260, 0, 0, 0, 5), null, 'no time at all is not a flick');
});
