import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUnsubscribe } from './unsubscribe.ts';

test('no header, no unsubscribe', () => assert.equal(parseUnsubscribe([]), null));

test('https link and one-click flag', () => {
  const u = parseUnsubscribe([{ name: 'List-Unsubscribe', value: '<https://x.no/u?id=1>, <mailto:u@x.no?subject=remove>' }, { name: 'List-Unsubscribe-Post', value: 'List-Unsubscribe=One-Click' }]);
  assert.equal(u?.https, 'https://x.no/u?id=1');
  assert.deepEqual(u?.mailto, { to: 'u@x.no', subject: 'remove', body: 'unsubscribe' });
  assert.equal(u?.oneClick, true);
});

test('mailto only', () => {
  const u = parseUnsubscribe([{ name: 'list-unsubscribe', value: '<mailto:leave@x.no>' }]);
  assert.equal(u?.https, null);
  assert.equal(u?.mailto?.to, 'leave@x.no');
});

test('http (not https) and garbage are refused', () => {
  assert.equal(parseUnsubscribe([{ name: 'List-Unsubscribe', value: '<http://x.no/u>' }]), null);
  assert.equal(parseUnsubscribe([{ name: 'List-Unsubscribe', value: '<mailto:not an address>' }]), null);
  assert.equal(parseUnsubscribe([{ name: 'List-Unsubscribe', value: '<javascript:alert(1)>' }]), null);
});
