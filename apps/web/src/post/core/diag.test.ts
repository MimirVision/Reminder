import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiag, plain, worth } from './diag.ts';

test('an error is written down as one short line, with every address taken out', () => {
  assert.equal(plain(new Error('The recipient bob@firma.no is not valid')), 'Error: The recipient [address] is not valid');
  assert.equal(plain('Sent to <anna@x.no>, bob@y.com;'), 'Sent to <[address]>, [address];');
  assert.ok(plain('x'.repeat(1000)).length <= 240);
  assert.equal(plain(undefined), 'undefined');
  const loop: Record<string, unknown> = {}; loop.me = loop;
  assert.equal(typeof plain(loop), 'string', 'something that cannot be written as text does not break the list');
});

test('the same problem again straight away is counted, not listed twice, and the list keeps only the latest', () => {
  let t = 1000;
  const d = createDiag({ now: () => t, max: 3 });
  d.note('sync', 'boom'); t += 10; d.note('sync', 'boom'); t += 10; d.note('sync', 'boom');
  assert.deepEqual(d.list(), [{ at: 1020, kind: 'sync', text: 'boom', count: 3 }]);
  d.note('send', 'a'); d.note('sync', 'boom'); d.note('send', 'b');
  assert.deepEqual(d.list().map((p) => p.text), ['a', 'boom', 'b'], 'the oldest fell off');
  const copy = d.list(); copy[0].text = 'changed';
  assert.equal(d.list()[0].text, 'a', 'what is handed out is a copy');
  d.clear();
  assert.deepEqual(d.list(), []);
});

test('what the browser says about itself is noise, no connection is its own thing, anything else is a real problem', () => {
  assert.equal(worth('ResizeObserver loop completed with undelivered notifications.'), 'noise');
  assert.equal(worth('Script error.'), 'noise');
  assert.equal(worth(new DOMException('The operation was aborted.', 'AbortError')), 'noise');
  assert.equal(worth(new TypeError('Load failed')), 'network');
  assert.equal(worth(new TypeError('Failed to fetch')), 'network');
  assert.equal(worth({ message: 'The Internet connection appears to be offline.' }), 'network');
  assert.equal(worth(new TypeError("Cannot read properties of undefined (reading 'subject')")), null);
  assert.equal(worth('something odd'), null);
  assert.equal(worth(undefined), null);
});
