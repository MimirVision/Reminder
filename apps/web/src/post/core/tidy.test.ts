import test from 'node:test';
import assert from 'node:assert/strict';
import { blockedMail, isBlocked, keepMore, keptKey, KEPT_MAX } from './tidy.ts';
import type { Mail } from './types.ts';

const mail = (o: Partial<Mail> & { id: string }): Mail => ({
  key: `a@o.no|${o.id}`, account: 'a@o.no', conversationId: '', received: '2026-10-04T10:00:00Z', subject: 'Tilbud', fromName: 'Shop', fromAddress: 'shop@x.no',
  preview: '', isRead: true, flagged: false, hasAttachments: false, folder: 'inbox', kind: 'promo', why: [], ...o,
});

test('an address block covers that address only, in any case; a company block covers every address and sub-domain', () => {
  assert.equal(isBlocked(['shop@x.no'], 'Shop@X.no'), true);
  assert.equal(isBlocked(['shop@x.no'], 'other@x.no'), false);
  assert.equal(isBlocked(['@acme.com'], 'a@acme.com'), true);
  assert.equal(isBlocked(['@acme.com'], 'news@mail.acme.com'), true);
  assert.equal(isBlocked(['@acme.com'], 'a@notacme.com'), false);
  assert.equal(isBlocked([], 'a@acme.com'), false);
});

test('only mail in the inbox that is not flagged and not kept is picked', () => {
  const list = [mail({ id: '1' }), mail({ id: '2', flagged: true }), mail({ id: '3', folder: 'archive' as Mail['folder'] }), mail({ id: '4', received: '2026-10-05T10:00:00Z' }), mail({ id: '5', fromAddress: 'anna@y.no' })];
  const kept = new Set([keptKey(list[3])]);
  assert.deepEqual(blockedMail(list, ['shop@x.no'], kept).map((m) => m.id), ['1']);
  assert.deepEqual(blockedMail(list, [], kept), []);
});

test('a kept mark follows the mailbox, the sender and the time, not the id', () => {
  assert.equal(keptKey(mail({ id: '1' })), keptKey(mail({ id: '1~' })));
  assert.notEqual(keptKey(mail({ id: '1' })), keptKey(mail({ id: '1', account: 'b@o.no' })));
  assert.equal(keptKey(mail({ id: '1', fromAddress: 'Shop@X.no ' })), keptKey(mail({ id: '1' })));
});

test('kept marks are not repeated, the newest come last, and only the last ones are kept', () => {
  assert.deepEqual(keepMore(['a', 'b'], ['b', 'c']), ['a', 'b', 'c']);
  const many = Array.from({ length: KEPT_MAX + 5 }, (_, i) => `k${i}`);
  const out = keepMore([], many);
  assert.equal(out.length, KEPT_MAX);
  assert.equal(out.at(-1), `k${KEPT_MAX + 4}`);
  assert.equal(out[0], 'k5');
});
