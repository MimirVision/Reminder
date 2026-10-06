import test from 'node:test';
import assert from 'node:assert/strict';
import { groupThreads, isMine, looksLikeReply, replyTarget, singles, threadKey, threadOf, threadWho } from './threads.ts';
import type { Mail } from './types.ts';

let n = 0;
const mail = (o: Partial<Mail> & { id: string }): Mail => ({
  key: `${o.account ?? 'a@o.no'}|${o.id}`, account: 'a@o.no', conversationId: '', received: `2026-10-0${1 + (n++ % 9)}T10:00:00Z`, subject: 'Hello', fromName: 'Anna Berg', fromAddress: 'anna@x.no',
  preview: '', isRead: true, flagged: false, hasAttachments: false, folder: 'inbox', kind: 'person', why: [], ...o,
});

test('messages that answer each other become one conversation, newest first', () => {
  const list = [
    mail({ id: '1', conversationId: 'C1', received: '2026-10-01T10:00:00Z' }),
    mail({ id: '2', conversationId: 'C1', received: '2026-10-03T10:00:00Z', isRead: false }),
    mail({ id: '3', conversationId: 'C2', received: '2026-10-02T10:00:00Z' }),
    mail({ id: '4', conversationId: 'C1', received: '2026-10-02T09:00:00Z', isRead: false }),
  ];
  const t = groupThreads(list);
  assert.deepEqual(t.map((x) => x.items.map((m) => m.id)), [['2', '4', '1'], ['3']]);
  assert.equal(t[0].latest.id, '2');
  assert.equal(t[0].unread, 2);
  assert.equal(t[1].unread, 0);
});

test('the rows come in the order of their newest message, whatever order they were given in', () => {
  const list = [
    mail({ id: 'old', conversationId: 'A', received: '2026-10-01T10:00:00Z' }),
    mail({ id: 'new', conversationId: 'B', received: '2026-10-05T10:00:00Z' }),
    mail({ id: 'newer-in-A', conversationId: 'A', received: '2026-10-06T10:00:00Z' }),
  ];
  assert.deepEqual(groupThreads(list).map((x) => x.latest.id), ['newer-in-A', 'new']);
});

test('a conversation never spans two mailboxes, and a message without a conversation id is on its own', () => {
  const list = [
    mail({ id: '1', conversationId: 'C1', account: 'a@o.no' }),
    mail({ id: '1', conversationId: 'C1', account: 'b@o.no', key: 'b@o.no|1' }),
    mail({ id: '2', conversationId: '' }),
    mail({ id: '3', conversationId: '' }),
  ];
  const t = groupThreads(list);
  assert.equal(t.length, 4);
  assert.ok(t.every((x) => x.items.length === 1));
  assert.equal(new Set(t.map((x) => x.key)).size, 4);
});

test('a conversation sits in the tab of its newest message', () => {
  const t = groupThreads([
    mail({ id: '1', conversationId: 'C', kind: 'update', received: '2026-10-01T10:00:00Z' }),
    mail({ id: '2', conversationId: 'C', kind: 'person', received: '2026-10-02T10:00:00Z' }),
  ]);
  assert.equal(t.length, 1);
  assert.equal(t[0].kind, 'person');
});

test('singles gives every message its own row, newest first, with its own unread state', () => {
  const t = singles([mail({ id: '1', conversationId: 'C', received: '2026-10-01T10:00:00Z', isRead: false }), mail({ id: '2', conversationId: 'C', received: '2026-10-02T10:00:00Z' })]);
  assert.deepEqual(t.map((x) => [x.latest.id, x.items.length, x.unread]), [['2', 1, 0], ['1', 1, 1]]);
});

test('a row keeps its key when a new answer arrives', () => {
  const before = groupThreads([mail({ id: '1', conversationId: 'C' })]);
  const after = groupThreads([mail({ id: '1', conversationId: 'C' }), mail({ id: '2', conversationId: 'C', received: '2026-10-09T10:00:00Z' })]);
  assert.equal(before[0].key, after[0].key);
  assert.equal(after[0].latest.id, '2');
});

test('threadOf: everything in the inbox that belongs with a message, or just the message when conversations are off', () => {
  const all = [
    mail({ id: '1', conversationId: 'C', received: '2026-10-01T10:00:00Z' }),
    mail({ id: '2', conversationId: 'C', received: '2026-10-03T10:00:00Z' }),
    mail({ id: '3', conversationId: 'D' }),
    mail({ id: '4', conversationId: 'C', received: '2026-10-02T10:00:00Z', folder: 'archive' }),
  ];
  assert.deepEqual(threadOf(all, all[0], true).map((m) => m.id), ['2', '1']);
  assert.deepEqual(threadOf(all, all[0], false).map((m) => m.id), ['1']);
  assert.deepEqual(threadOf(all, all[2], true).map((m) => m.id), ['3']);
  // not in the inbox: nothing to act on
  assert.deepEqual(threadOf(all, all[3], false).map((m) => m.id), []);
  assert.deepEqual(threadOf(all, mail({ id: 'x', conversationId: '' }), true).map((m) => m.id), []);
});

test('threadKey separates a conversation from a message of the same name', () => {
  assert.notEqual(threadKey(mail({ id: 'X', conversationId: '' })), threadKey(mail({ id: 'Y', conversationId: 'X' })));
  assert.equal(threadKey(mail({ id: '1', conversationId: 'C' })), threadKey(mail({ id: '2', conversationId: 'C' })));
});

test('threadWho: one sender is named in full, several are first names, newest first', () => {
  const who = (items: Mail[]) => threadWho({ items });
  assert.equal(who([mail({ id: '1' }), mail({ id: '2' })]), 'Anna Berg');
  assert.equal(who([mail({ id: '1', fromName: 'Per Hansen', fromAddress: 'per@x.no' }), mail({ id: '2' })]), 'Per, Anna');
  assert.equal(who([mail({ id: '1', fromName: 'Per Hansen', fromAddress: 'per@x.no' }), mail({ id: '2', fromName: 'Kari Nord', fromAddress: 'kari@x.no' }), mail({ id: '3' }), mail({ id: '4', fromName: 'Ola', fromAddress: 'ola@x.no' })]), 'Per, Kari, Anna +1');
  // two Annas must still be told apart
  assert.equal(who([mail({ id: '1', fromName: 'Anna Lund', fromAddress: 'lund@x.no' }), mail({ id: '2' })]), 'Anna Lund, Anna Berg');
  // no display name: the address
  assert.equal(who([mail({ id: '1', fromName: '', fromAddress: 'post@bank.no' })]), 'post@bank.no');
  assert.equal(who([mail({ id: '1', fromName: '', fromAddress: 'post@bank.no' }), mail({ id: '2' })]), 'post@bank.no, Anna');
});

test('isMine: the sender is this mailbox, whatever the letter case', () => {
  assert.equal(isMine({ account: 'Test.Person@Outlook.com', fromAddress: 'test.person@outlook.com' }), true);
  assert.equal(isMine({ account: 'a@o.no', fromAddress: 'anna@x.no' }), false);
  assert.equal(isMine({ account: 'a@o.no', fromAddress: '' }), false);
});

test('replyTarget: the newest message somebody else wrote, else the newest', () => {
  const me = (id: string) => mail({ id, fromAddress: 'a@o.no', fromName: 'Meg' });
  assert.equal(replyTarget([me('3'), mail({ id: '2' }), mail({ id: '1' })])?.id, '2', 'your own reply is not what you answer');
  assert.equal(replyTarget([mail({ id: '3' }), me('2')])?.id, '3');
  assert.equal(replyTarget([me('2'), me('1')])?.id, '2', 'only yours: the newest of them');
  assert.equal(replyTarget([]), undefined);
});

test('looksLikeReply: the prefixes mail programs add in the languages around here', () => {
  for (const s of ['Re: Ferie', 'RE: Ferie', 'Sv: Ferie', 'VS: Ferie', 'AW: Urlaub', 'Fwd: Ferie', 'FW: Ferie', 'VB: Ferie', '  re :Ferie']) assert.equal(looksLikeReply(s), true, s);
  for (const s of ['Ferie', 'Regning', 'Reservasjon: Ferie', '', 'Fw']) assert.equal(looksLikeReply(s), false, s);
});
