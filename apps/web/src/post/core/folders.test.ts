import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFolders, destinationOf, folderMail, folderOfMail, kindOfGraphName, moveTargets, placeActions, recipientsOf, STANDARD_KINDS } from './folders.ts';
import type { FolderTree, RawFolder } from './graph.ts';

const f = (id: string, displayName: string, parentFolderId?: string, extra: Partial<RawFolder> = {}): RawFolder => ({ id, displayName, ...(parentFolderId ? { parentFolderId } : {}), childFolderCount: 0, unreadItemCount: 0, totalItemCount: 0, ...extra });
const STANDARD = { inbox: 'IN', drafts: 'DR', sentitems: 'SE', archive: 'AR', junkemail: 'JU', deleteditems: 'DE' } as const;
/** A mailbox in Norwegian: the standard folders have Norwegian names, and some of Outlook's own plumbing is about. */
const tree = (more: RawFolder[] = [], o: Partial<FolderTree> = {}): FolderTree => ({
  folders: [f('IN', 'Innboks', 'ROOT', { unreadItemCount: 4, totalItemCount: 90 }), f('DR', 'Kladd', 'ROOT', { totalItemCount: 2 }), f('SE', 'Sendte elementer', 'ROOT'), f('AR', 'Arkiv', 'ROOT', { totalItemCount: 1200 }), f('JU', 'Søppelpost', 'ROOT', { unreadItemCount: 1 }), f('DE', 'Slettede elementer', 'ROOT'), f('OUT', 'Utboks', 'ROOT'), ...more],
  standard: STANDARD, hidden: ['OUT'], ...o,
});

test('the standard folders come first, in a fixed order, in Post\'s words whatever language the mailbox is in; Outlook\'s plumbing is left out', () => {
  const list = buildFolders('a@x.no', tree());
  assert.deepEqual(list.map((x) => [x.kind, x.name]), [['inbox', 'Inbox'], ['drafts', 'Drafts'], ['sent', 'Sent'], ['archive', 'Archive'], ['junk', 'Junk'], ['deleted', 'Deleted']]);
  assert.deepEqual(list.map((x) => x.kind), [...STANDARD_KINDS]);
  assert.deepEqual(list.find((x) => x.kind === 'inbox'), { account: 'a@x.no', id: 'IN', name: 'Inbox', kind: 'inbox', unread: 4, total: 90, depth: 0, where: '' });
});

test('the folders you made follow, each with the folders inside it; the ones at the top come before the ones inside a standard folder', () => {
  const list = buildFolders('a@x.no', tree([
    f('K', 'Kunder', 'IN', { unreadItemCount: 2, totalItemCount: 12 }),
    f('P', 'Prosjekter', 'ROOT'), f('P26', '2026', 'P'), f('P26B', 'Beta', 'P26'), f('P26A', 'alfa', 'P26'), f('P25', '2025', 'P'),
    f('Z', 'Zeta', 'ROOT'),
  ]));
  assert.deepEqual(list.slice(6).map((x) => [x.name, x.depth, x.where]), [
    ['Prosjekter', 0, ''], ['2025', 1, 'Prosjekter'], ['2026', 1, 'Prosjekter'], ['alfa', 2, 'Prosjekter / 2026'], ['Beta', 2, 'Prosjekter / 2026'],
    ['Zeta', 0, ''],
    ['Kunder', 0, 'Inbox'],
  ]);
  assert.equal(list.find((x) => x.name === 'Kunder')!.kind, 'other');
  assert.equal(list.find((x) => x.name === 'Kunder')!.unread, 2);
});

test('a folder whose parent Outlook did not tell about is a folder at the top, and a ring of parents cannot hang the list', () => {
  const list = buildFolders('a@x.no', tree([f('X', 'Lost', 'NOBODY'), f('C1', 'Ring one', 'C2'), f('C2', 'Ring two', 'C1')]));
  assert.ok(list.some((x) => x.name === 'Lost' && x.depth === 0 && x.where === ''));
  assert.ok(list.some((x) => x.name === 'Ring one') || list.some((x) => x.name === 'Ring two'), 'the list still comes back');
});

test('a mailbox without some of the standard folders lists the ones it has; counts are never negative', () => {
  const list = buildFolders('a@x.no', { folders: [f('IN', 'Inbox', 'ROOT', { unreadItemCount: -3 }), f('DE', 'Deleted Items', 'ROOT')], standard: { inbox: 'IN', deleteditems: 'DE' }, hidden: [] });
  assert.deepEqual(list.map((x) => x.kind), ['inbox', 'deleted']);
  assert.equal(list[0].unread, 0);
});

test('a folder with no name still gets one', () => {
  const list = buildFolders('a@x.no', tree([f('N', '   ', 'ROOT')]));
  assert.equal(list.find((x) => x.id === 'N')!.name, '(no name)');
});

test('Outlook\'s names for the standard folders map to kinds', () => {
  assert.equal(kindOfGraphName('sentitems'), 'sent');
  assert.equal(kindOfGraphName('junkemail'), 'junk');
  assert.equal(kindOfGraphName('deleteditems'), 'deleted');
  assert.equal(kindOfGraphName('outbox'), null);
});

test('a message knows its folder by the id Outlook gave it', () => {
  const list = buildFolders('a@x.no', tree([f('K', 'Kunder', 'IN')]));
  assert.equal(folderOfMail(list, { account: 'a@x.no', fid: 'K' })?.name, 'Kunder');
  assert.equal(folderOfMail(list, { account: 'b@x.no', fid: 'K' }), undefined, 'another mailbox has other folders');
  assert.equal(folderOfMail(list, { account: 'a@x.no' }), undefined);
});

// ---- who a message went to -------------------------------------------------------------------------------------------------------------------

const to = (name: string, address: string) => ({ emailAddress: { name, address } });

test('who a message went to: the person, or first names, up to three, then a count', () => {
  assert.deepEqual(recipientsOf([to('Maria Lund', 'Maria.Lund@x.no')]), { to: 'Maria Lund', toAddress: 'maria.lund@x.no' });
  assert.deepEqual(recipientsOf([to('Maria Lund', 'm@x.no'), to('Per Hansen', 'p@x.no')]), { to: 'Maria, Per', toAddress: 'm@x.no' });
  assert.equal(recipientsOf([to('A One', 'a@x.no'), to('B Two', 'b@x.no'), to('C Three', 'c@x.no'), to('D Four', 'd@x.no'), to('E Five', 'e@x.no')]).to, 'A, B, C +2');
  assert.deepEqual(recipientsOf([to('', 'bare@x.no')]), { to: 'bare@x.no', toAddress: 'bare@x.no' });
  assert.deepEqual(recipientsOf([to('Maria', 'm@x.no'), to('Maria', 'M@X.no')]), { to: 'Maria', toAddress: 'm@x.no' }, 'the same address twice is one person');
  assert.deepEqual(recipientsOf([]), { to: '', toAddress: '' });
  assert.deepEqual(recipientsOf(undefined), { to: '', toAddress: '' });
});

// ---- a message from a folder list ---------------------------------------------------------------------------------------------------------------

const raw = (o: object = {}) => ({ id: 'm1', conversationId: 'c1', receivedDateTime: '2026-10-01T10:00:00Z', subject: 'Hei', from: { emailAddress: { name: 'Test Person', address: 'a@x.no' } }, bodyPreview: 'tekst', isRead: true, parentFolderId: 'SE', ...o });

test('a sent message carries who it went to, and is a person\'s, whatever it looks like', () => {
  const m = folderMail('a@x.no', raw({ toRecipients: [to('Maria Lund', 'maria@x.no')] }), 'sent', {});
  assert.equal(m.to, 'Maria Lund');
  assert.equal(m.toAddress, 'maria@x.no');
  assert.equal(m.kind, 'person');
  assert.equal(m.fk, 'sent');
  assert.equal(m.fid, 'SE');
  assert.equal(m.folder, 'archive', 'not in the inbox on this phone');
  assert.equal(m.draft, undefined);
  assert.equal(m.snoozedUntil, null);
});

test('a draft is marked, has its last change as its time, and is a draft even when found by a search', () => {
  const m = folderMail('a@x.no', raw({ isDraft: true, isRead: true, toRecipients: [], lastModifiedDateTime: '2026-10-05T12:00:00Z', parentFolderId: 'DR' }), 'other', {});
  assert.equal(m.draft, true);
  assert.equal(m.fk, 'drafts');
  assert.equal(m.received, '2026-10-05T12:00:00Z');
  assert.equal(m.to, '');
});

test('a message in the archive is an ordinary message, sorted as usual, that remembers where it is', () => {
  const m = folderMail('a@x.no', raw({ parentFolderId: 'AR', from: { emailAddress: { name: 'Zalando', address: 'info@service.zalando.no' } }, subject: 'Sommersalg: opptil 50% rabatt' }), 'archive', {});
  assert.equal(m.fk, 'archive');
  assert.equal(m.fid, 'AR');
  assert.equal(m.to, undefined);
  assert.equal(m.fromName, 'Zalando');
  assert.notEqual(m.kind, undefined);
});

test('a message found by a search, before the folders were listed, does not claim a folder it may not be in', () => {
  const m = folderMail('a@x.no', raw({ parentFolderId: 'SOMEWHERE' }), null, {});
  assert.equal(m.fk, undefined);
  assert.equal(m.fid, 'SOMEWHERE');
  assert.equal(m.to, undefined);
  const d = folderMail('a@x.no', raw({ isDraft: true, parentFolderId: 'DR' }), null, {});
  assert.equal(d.fk, 'drafts', 'a draft is a draft wherever it was found');
});

// ---- what can be done from where a message is ------------------------------------------------------------------------------------------------

test('from the archive, junk and deleted, "done" sends a message back to the inbox in the words that fit; deleted mail cannot be deleted again', () => {
  assert.deepEqual(placeActions('archive').primary, { to: 'inbox', label: 'Inbox', icon: 'inbox' });
  assert.deepEqual(placeActions('junk').primary, { to: 'inbox', label: 'Not junk', icon: 'inbox' });
  assert.deepEqual(placeActions('deleted').primary, { to: 'inbox', label: 'Restore', icon: 'inbox' });
  assert.equal(placeActions('deleted').canDelete, false);
  assert.equal(placeActions('archive').canDelete, true);
  assert.deepEqual(placeActions('deleted').swipe.left, { to: 'archive', label: 'Archive', icon: 'archive' });
});

test('from sent mail and your own folders "done" is Archive; drafts have no such button; an unknown place offers none, but can still be deleted', () => {
  assert.equal(placeActions('sent').primary?.to, 'archive');
  assert.equal(placeActions('other').primary?.to, 'archive');
  assert.equal(placeActions('drafts').primary, null);
  assert.equal(placeActions('unknown').primary, null);
  assert.equal(placeActions('unknown').canDelete, true);
  assert.equal(placeActions('drafts').swipe.right.to, 'deleted');
});

// ---- the Move to list ------------------------------------------------------------------------------------------------------------------------------

test('the Move to list has the inbox, archive, junk, deleted and your own folders of that mailbox, but not drafts, sent, or where the message already is', () => {
  const a = buildFolders('a@x.no', tree([f('K', 'Kunder', 'IN'), f('P', 'Prosjekter', 'ROOT')]));
  const b = buildFolders('b@x.no', tree([f('Q', 'Annet', 'ROOT')]));
  const names = (x: ReturnType<typeof moveTargets>) => x.map((y) => y.name);
  assert.deepEqual(names(moveTargets([...a, ...b], 'a@x.no')), ['Inbox', 'Archive', 'Junk', 'Deleted', 'Prosjekter', 'Kunder']);
  assert.deepEqual(names(moveTargets([...a, ...b], 'a@x.no', { fid: 'AR' })), ['Inbox', 'Junk', 'Deleted', 'Prosjekter', 'Kunder']);
  assert.deepEqual(names(moveTargets([...a, ...b], 'a@x.no', { inbox: true })), ['Archive', 'Junk', 'Deleted', 'Prosjekter', 'Kunder']);
  assert.deepEqual(names(moveTargets([...a, ...b], 'b@x.no')), ['Inbox', 'Archive', 'Junk', 'Deleted', 'Annet']);
});

test('Outlook is told a standard folder by name and any other folder by its id', () => {
  const a = buildFolders('a@x.no', tree([f('K', 'Kunder', 'IN')]));
  assert.deepEqual(a.map(destinationOf), ['inbox', 'drafts', 'sentitems', 'archive', 'junkemail', 'deleteditems', 'K']);
});
