import test from 'node:test';
import assert from 'node:assert/strict';
import { canMoveInto, dropChoices, placeOf } from './drop.ts';
import type { FolderInfo, Mail } from './types.ts';

const f = (id: string, kind: FolderInfo['kind'], o: Partial<FolderInfo> = {}): FolderInfo => ({ account: 'a@o.no', id, name: id, kind, unread: 0, total: 0, depth: 0, where: '', ...o });
const folders = [f('I', 'inbox'), f('AR', 'archive'), f('J', 'junk'), f('K', 'other', { name: 'Kunder' }), f('L', 'other', { name: 'Acme', depth: 1, where: 'Kunder' }), f('W', 'other', { account: 'w@f.no' })];
const inboxMail = { account: 'a@o.no' } as Pick<Mail, 'account' | 'fid' | 'fk'>;
const inK = { account: 'a@o.no', fid: 'K', fk: 'other' } as Pick<Mail, 'account' | 'fid' | 'fk'>;

test('where a message is: the inbox when it has no folder, else the folder it was seen in', () => {
  assert.equal(placeOf(inboxMail, folders), 'inbox');
  assert.equal(placeOf(inK, folders), 'other');
  assert.equal(placeOf({ account: 'a@o.no', fid: 'AR' }, folders), 'archive');
  assert.equal(placeOf({ account: 'a@o.no', fid: 'unknown' }, folders), null);
});

test('mail is never dropped on Drafts or Sent, or where it already is, or into a folder of another mailbox', () => {
  assert.equal(canMoveInto([inboxMail], { kind: 'drafts', id: '' }, folders), false);
  assert.equal(canMoveInto([inboxMail], { kind: 'sent', id: '' }, folders), false);
  assert.equal(canMoveInto([inboxMail], { kind: 'inbox', id: '' }, folders), false);
  assert.equal(canMoveInto([inboxMail], { kind: 'archive', id: '' }, folders), true);
  assert.equal(canMoveInto([inK], { kind: 'other', id: 'K', account: 'a@o.no' }, folders), false);
  assert.equal(canMoveInto([inK], { kind: 'other', id: 'L', account: 'a@o.no' }, folders), true);
  assert.equal(canMoveInto([inboxMail], { kind: 'other', id: 'W', account: 'w@f.no' }, folders), false);
  assert.equal(canMoveInto([], { kind: 'archive', id: '' }, folders), false);
  assert.equal(canMoveInto([inboxMail, inK], { kind: 'archive', id: '' }, folders), true, 'a mix goes where both can');
  assert.equal(canMoveInto([inboxMail, { account: 'a@o.no', fk: 'archive' }], { kind: 'archive', id: '' }, folders), false, 'but not if one is already there');
});

test('the choices while carrying: Archive, Junk and your own folders of that mailbox; Inbox only from elsewhere', () => {
  const a = dropChoices(folders, [inboxMail]);
  assert.deepEqual(a.standard.map((d) => d.kind), ['archive', 'junk']);
  assert.deepEqual(a.own.map((x) => x.id), ['K', 'L']);
  assert.equal(a.account, 'a@o.no');
  const b = dropChoices(folders, [{ account: 'a@o.no', fid: 'AR', fk: 'archive' }]);
  assert.deepEqual(b.standard.map((d) => d.kind), ['inbox', 'junk']);
  const c = dropChoices(folders, [inboxMail, { account: 'w@f.no' }]);
  assert.deepEqual([c.own.length, c.account], [0, null]);
});
