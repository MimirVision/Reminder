import assert from 'node:assert/strict';
import { test } from 'node:test';
import { neverOpened, rate, subscriptions } from './subscriptions.ts';
import type { Mail } from './types.ts';

const NOW = Date.UTC(2026, 9, 8, 12, 0);
let n = 0;
const mail = (from: string, daysAgo: number, o: Partial<Mail> = {}): Mail => ({
  key: `a|${++n}`, id: `id${n}`, account: 'a@x.no', folder: 'inbox', conversationId: `c${n}`, subject: `S${n}`, fromName: from.split('@')[0], fromAddress: from,
  received: new Date(NOW - daysAgo * 86400000).toISOString(), isRead: false, flagged: false, hasAttachments: false, preview: '', kind: 'person', ...o,
} as Mail);

const box = [
  mail('news@shop.no', 1, { sig: ['unsub', 'bulk'], kind: 'promo' }), mail('news@shop.no', 8, { sig: ['unsub'], kind: 'promo', isRead: true }), mail('news@shop.no', 15, { kind: 'promo' }),
  mail('deals@other.no', 2, { kind: 'promo' }), mail('deals@other.no', 3, { kind: 'promo' }),
  mail('friend@x.no', 1), mail('friend@x.no', 2), mail('friend@x.no', 3),
  mail('list@club.no', 4, { sig: ['list'], kind: 'update' }),
  mail('news@shop.no', 5, { folder: 'archive', sig: ['unsub'] }), mail('', 5, { kind: 'promo' }),
];

test('only senders of bulk mail, busiest first, counting the inbox only', () => {
  const s = subscriptions(box, [], NOW);
  assert.deepEqual(s.map((x) => x.address), ['news@shop.no', 'deals@other.no', 'list@club.no']);
  assert.deepEqual(s.map((x) => x.count), [3, 2, 1]);
  assert.equal(s[0].unread, 2);
  assert.equal(s[0].canUnsubscribe, true);
  assert.equal(s[1].canUnsubscribe, false);
});

test('the newest message and the weekly rate', () => {
  const s = subscriptions(box, [], NOW);
  assert.equal(s[0].newest.received, box[0].received);
  assert.equal(s[0].perWeek, 1.4, '3 mails over 15 days');
  assert.equal(s[2].perWeek, 1, 'a week is the shortest span');
});

test('a blocked sender is marked, and the same address in two mailboxes is two rows', () => {
  const two = [...box, mail('deals@other.no', 1, { account: 'b@x.no', kind: 'promo' })];
  const s = subscriptions(two, ['@other.no'], NOW);
  assert.equal(s.filter((x) => x.address === 'deals@other.no').length, 2);
  assert.ok(s.filter((x) => x.address === 'deals@other.no').every((x) => x.blocked));
  assert.equal(s.find((x) => x.address === 'news@shop.no')?.blocked, false);
});

test('senders you never opened', () => {
  const s = subscriptions(box, [], NOW);
  assert.deepEqual(neverOpened(s).map((x) => x.address), ['deals@other.no']);
});

test('how often, in words', () => {
  assert.equal(rate(0.4), 'less than one a week');
  assert.equal(rate(1), 'about 1 a week');
  assert.equal(rate(3.4), 'about 3 a week');
});
