import test from 'node:test';
import assert from 'node:assert/strict';
import { hasShare, shareToText } from './share.ts';

test('title, text and link become a short note without repeating', () => {
  assert.equal(shareToText('?share=1&title=Bookcase&text=Nice%20white%20one&url=https%3A%2F%2Fikea.no%2Fp%2F1'), 'Bookcase\nNice white one\nhttps://ikea.no/p/1');
  assert.equal(shareToText('?share=1&text=Look%20https%3A%2F%2Fa.no%2Fx&url=https%3A%2F%2Fa.no%2Fx'), 'Look https://a.no/x');
  assert.equal(shareToText('?share=1&title=Only%20a%20title'), 'Only a title');
  assert.equal(shareToText('?share=1&title=Same&text=Same%20thing'), 'Same thing');
});

test('nothing without the share flag or content', () => {
  assert.equal(shareToText('?other=x'), '');
  assert.equal(shareToText('?title=Just%20this'), 'Just this', 'the browser may drop the share flag');
  assert.equal(shareToText('?share=1'), '');
  assert.equal(hasShare('?share=1'), true);
  assert.equal(hasShare(''), false);
  assert.equal(shareToText(`?share=1&text=${'x'.repeat(3000)}`).length, 1000);
});
