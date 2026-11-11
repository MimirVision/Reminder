import test from 'node:test';
import assert from 'node:assert/strict';
import { unsubscribedAgain } from './unsubscribed.ts';
import type { Mail } from './types.ts';

const D = 86_400_000;
const at = Date.parse('2026-11-01T00:00:00Z');
const mk = (received: string, o: Partial<Mail> = {}) => ({ fromAddress: 'News@X.no', received, flagged: false, ...o }) as Mail;

test('blocks only for mail after the grace period', () => {
  assert.equal(unsubscribedAgain([mk('2026-11-02T00:00:00Z')], { 'news@x.no': at }, at + 10 * D), null);
  assert.equal(unsubscribedAgain([mk('2026-11-06T00:00:00Z')], { 'news@x.no': at }, at + 10 * D), 'news@x.no');
  assert.equal(unsubscribedAgain([mk('2026-11-06T00:00:00Z')], { 'news@x.no': at }, at + 2 * D), null);
  assert.equal(unsubscribedAgain([mk('2026-11-06T00:00:00Z', { flagged: true })], { 'news@x.no': at }, at + 10 * D), null);
});
