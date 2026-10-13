import assert from 'node:assert/strict';
import { test } from 'node:test';
import { digestThreads } from './digest.ts';
import { groupThreads } from './threads.ts';
import type { Mail } from './types.ts';

let n = 0;
const mail = (from: string, subject: string, minutesAgo: number, o: Partial<Mail> = {}): Mail => ({
  key: `a|${++n}`, id: `id${n}`, account: 'a@x.no', folder: 'inbox', conversationId: `conv${n}`, subject, fromName: from.split('@')[0], fromAddress: from,
  received: new Date(Date.UTC(2026, 9, 8, 10, 0) - minutesAgo * 60000).toISOString(), isRead: false, flagged: false, hasAttachments: false, preview: '', kind: 'promo', ...o,
} as Mail);

test('a sender with several conversations becomes one row that holds all their mail; a lone sender stays as it is', () => {
  const rows = groupThreads([mail('shop@z.no', 'Sale', 5), mail('friend@x.no', 'Hi', 10), mail('shop@z.no', 'More sale', 20), mail('shop@z.no', 'Last chance', 30)]);
  const out = digestThreads(rows, 'promo');
  assert.equal(out.length, 2);
  assert.equal(out[0].members?.length, 3);
  assert.deepEqual(out[0].items.map((m) => m.subject), ['Sale', 'More sale', 'Last chance']);
  assert.equal(out[0].unread, 3);
  assert.equal(out[0].latest.subject, 'Sale');
  assert.equal(out[1].members, undefined);
  assert.equal(out[1].latest.subject, 'Hi');
});

test('the row stands where its newest conversation was, and the order of the others is kept', () => {
  const rows = groupThreads([mail('a@z.no', 'A1', 1), mail('b@z.no', 'B1', 2), mail('a@z.no', 'A2', 3), mail('c@z.no', 'C1', 4), mail('b@z.no', 'B2', 5)]);
  const out = digestThreads(rows, 'update');
  assert.deepEqual(out.map((t) => t.latest.fromAddress), ['a@z.no', 'b@z.no', 'c@z.no']);
  assert.deepEqual(out.map((t) => !!t.members), [true, true, false]);
});

test('Primary and All are never grouped', () => {
  const rows = groupThreads([mail('a@z.no', 'A1', 1), mail('a@z.no', 'A2', 2)]);
  assert.equal(digestThreads(rows, 'person').length, 2);
  assert.equal(digestThreads(rows, 'all').length, 2);
});

test('flagged conversations stay on their own row, and the rest of the sender still groups', () => {
  const rows = groupThreads([mail('a@z.no', 'A1', 1), mail('a@z.no', 'Keep', 2, { flagged: true }), mail('a@z.no', 'A3', 3)]);
  const out = digestThreads(rows, 'promo');
  assert.equal(out.length, 2);
  assert.equal(out[0].members?.length, 2);
  assert.equal(out[1].latest.subject, 'Keep');
});

test('two mailboxes are two rows, and the same address in different case is one sender', () => {
  const rows = groupThreads([mail('Shop@Z.no', 'S1', 1), mail('shop@z.no', 'S2', 2), mail('shop@z.no', 'S3', 3, { account: 'b@x.no', key: 'b|9' })]);
  const out = digestThreads(rows, 'promo');
  assert.equal(out.length, 2);
  assert.equal(out[0].members?.length, 2);
});

test('a conversation of several messages counts all of them in the row', () => {
  const rows = groupThreads([mail('a@z.no', 'Re: Order', 1, { conversationId: 'same' }), mail('a@z.no', 'Order', 2, { conversationId: 'same' }), mail('a@z.no', 'Other', 3)]);
  const out = digestThreads(rows, 'transaction');
  assert.equal(out.length, 1);
  assert.equal(out[0].items.length, 3);
  assert.equal(out[0].members?.length, 2);
});
