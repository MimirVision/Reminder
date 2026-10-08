import test from 'node:test';
import assert from 'node:assert/strict';
import { addLeft, diffInbox, LEFT_BULK, LEFT_MAX, leftCounts, leftLine, loadLeft, type LeftEntry, type LeftWhy } from './leftlog.ts';
import type { Mail } from './types.ts';

const mail = (id: string, o: Partial<Mail> = {}): Mail => ({
  key: `a@o.no|${id}`, account: 'a@o.no', id, conversationId: '', received: '2026-10-04T10:00:00Z', subject: `Emne ${id}`, fromName: 'Anna', fromAddress: 'anna@x.no',
  preview: '', isRead: false, flagged: false, hasAttachments: false, folder: 'inbox', kind: 'person', why: [], ...o,
});
const none = new Map<string, LeftWhy>();

test('a message that is gone with no reason given was moved or deleted at Outlook', () => {
  const e = diffInbox([mail('1'), mail('2')], [mail('2')], none, 5);
  assert.deepEqual(e.map((x) => [x.key, x.why, x.subject, x.who]), [['a@o.no|1', 'outlook', 'Emne 1', 'Anna']]);
});

test('a reason given by what took it away is used', () => {
  const e = diffInbox([mail('1'), mail('2')], [], new Map<string, LeftWhy>([['a@o.no|1', 'blocked'], ['a@o.no|2', 'archive']]), 5);
  assert.deepEqual(e.map((x) => x.why), ['blocked', 'archive']);
});

test('a message that changed tab is logged with both tabs, and says whether you caused it', () => {
  const e = diffInbox([mail('1')], [mail('1', { kind: 'promo' })], none, 5);
  assert.deepEqual([e[0].why, e[0].from, e[0].to], ['tab', 'person', 'promo']);
  assert.match(leftLine(e[0]), /^From Primary to Promotions once Post had read its hidden marks\. Still in All\.$/);
  const y = diffInbox([mail('1')], [mail('1', { kind: 'update' })], none, 5, 'tabYou');
  assert.match(leftLine(y[0]), /because of a choice you made/);
});

test('new mail, unchanged mail and an empty first list say nothing', () => {
  assert.deepEqual(diffInbox([mail('1')], [mail('1'), mail('2')], none, 5), []);
  assert.deepEqual(diffInbox([], [mail('1')], none, 5), []);
  assert.deepEqual(diffInbox([mail('1')], [mail('1', { isRead: true })], none, 5), []);
});

test('many leaving at once is one summary, not a list of messages', () => {
  const many = Array.from({ length: LEFT_BULK }, (_, i) => mail(String(i)));
  const e = diffInbox(many, [], none, 5);
  assert.equal(e.length, 1);
  assert.deepEqual([e[0].why, e[0].count], ['bulk', LEFT_BULK]);
});

test('the list keeps the newest, and counts and saved data are safe to read', () => {
  const old = Array.from({ length: LEFT_MAX }, (_, i): LeftEntry => ({ at: i, key: 'k', subject: 's', who: 'w', why: 'outlook' }));
  const next = addLeft(old, [{ at: 999, key: 'n', subject: 's', who: 'w', why: 'archive' }]);
  assert.equal(next.length, LEFT_MAX); assert.equal(next[0].at, 999);
  assert.equal(leftCounts([...old.slice(0, 2), next[0]]), 'outlook 2, archive 1');
  assert.deepEqual(loadLeft('x'), []);
  assert.equal(loadLeft([{ at: 1, key: 'k', subject: 's', who: 'w', why: 'outlook' }, { at: 'x' }, null, { at: 1, key: 'k', subject: 's', who: 'w', why: 'nonsense' }]).length, 1);
});
