import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sweepCompany, sweepPlan, sweepable } from './sweep.ts';
import type { Mail } from './types.ts';

const NOW = Date.UTC(2026, 9, 8, 12, 0);
let n = 0;
const mail = (from: string, daysAgo: number, o: Partial<Mail> = {}): Mail => ({
  key: `a|${++n}`, id: `id${n}`, account: 'a@x.no', folder: 'inbox', conversationId: `c${n}`, subject: `S${n}`, fromName: '', fromAddress: from,
  received: new Date(NOW - daysAgo * 86400000).toISOString(), isRead: true, flagged: false, hasAttachments: false, preview: '', kind: 'promo', ...o,
} as Mail);

const box = [mail('news@shop.no', 1), mail('news@shop.no', 5), mail('news@shop.no', 12), mail('news@shop.no', 30), mail('deals@shop.no', 2), mail('x@y.no', 3), mail('news@shop.no', 8, { flagged: true }), mail('news@shop.no', 9, { folder: 'archive' })];

test('only the inbox, only this address, never flagged mail, newest first', () => {
  const l = sweepable(box, 'News@shop.no', 'sender');
  assert.equal(l.length, 4);
  assert.deepEqual(l.map((m) => m.subject), box.slice(0, 4).map((m) => m.subject));
});

test('the whole company reaches every address of it, not other companies', () => {
  assert.equal(sweepable(box, 'news@shop.no', 'company').length, 5);
  assert.equal(sweepCompany('a@mail.shop.no'), 'shop.no');
  assert.equal(sweepCompany('someone@gmail.com'), null);
  assert.equal(sweepable(box, 'someone@gmail.com', 'company').length, 0);
});

test('the four choices', () => {
  assert.equal(sweepPlan(box, 'news@shop.no', 'sender', 'archive', NOW, true).items.length, 4);
  assert.equal(sweepPlan(box, 'news@shop.no', 'sender', 'delete', NOW, true).items.length, 4);
  const k = sweepPlan(box, 'news@shop.no', 'sender', 'keepNewest', NOW, true);
  assert.equal(k.items.length, 3);
  assert.ok(!k.items.some((m) => m.subject === box[0].subject), 'the newest stays');
  const o = sweepPlan(box, 'news@shop.no', 'sender', 'older', NOW, true);
  assert.deepEqual(o.items.map((m) => m.subject), [box[2].subject, box[3].subject], 'older than ten days');
});

test('rows count a conversation once, unless conversations are off', () => {
  const two = [mail('a@s.no', 1, { conversationId: 'same' }), mail('a@s.no', 2, { conversationId: 'same' }), mail('a@s.no', 3)];
  assert.equal(sweepPlan(two, 'a@s.no', 'sender', 'archive', NOW, true).rows, 2);
  assert.equal(sweepPlan(two, 'a@s.no', 'sender', 'archive', NOW, false).rows, 3);
});

test('keep the newest with only one message sweeps nothing', () => {
  assert.equal(sweepPlan([mail('a@s.no', 1)], 'a@s.no', 'sender', 'keepNewest', NOW, true).items.length, 0);
});
