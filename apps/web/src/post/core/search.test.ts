import test from 'node:test';
import assert from 'node:assert/strict';
import { fold, parseQuery, search } from './search.ts';
import type { Mail } from './types.ts';

const m = (o: Partial<Mail>): Mail => ({ key: `a|${o.id ?? 'x'}`, account: 'a@o.no', id: 'x', conversationId: 'c', received: '2026-10-01T10:00:00Z', subject: '', fromName: '', fromAddress: 'x@y.no', preview: '', isRead: true, flagged: false, hasAttachments: false, folder: 'inbox', kind: 'person', why: [], ...o });

test('folds Nordic letters and accents', () => {
  assert.equal(fold('Østlandet Åse Ærlig Café'), 'ostlandet ase aerlig cafe');
});

test('parses operators and keeps the rest as words', () => {
  const q = parseQuery('from:Anna is:unread has:attachment in:promotions account:work Møte');
  assert.deepEqual(q, { words: ['mote'], from: ['anna'], unread: true, flagged: false, attachment: true, account: 'work', kind: 'promo' });
});

test('in: takes the tab names, and the older names still work', () => {
  assert.equal(parseQuery('in:primary').kind, 'person');
  assert.equal(parseQuery('in:transactions').kind, 'transaction');
  assert.equal(parseQuery('in:updates').kind, 'update');
  assert.equal(parseQuery('in:newsletters').kind, 'update');
  assert.equal(parseQuery('in:receipts').kind, 'transaction');
  assert.deepEqual(parseQuery('in:nonsense').words, ['in:nonsense']);
  assert.deepEqual(search([m({ id: '1', kind: 'promo', subject: 'tilbud' }), m({ id: '2', kind: 'person', subject: 'tilbud' })], 'in:promotions tilbud').map((x) => x.id), ['1']);
});

test('"from:" alone is just a word, not a broken filter', () => {
  assert.deepEqual(parseQuery('from:').words, ['from:']);
});

test('finds Østlandet with "ostlandet", in subject, sender or preview', () => {
  const all = [m({ id: '1', subject: 'Tur i Østlandet' }), m({ id: '2', preview: 'ostlandet er fint' }), m({ id: '3', subject: 'Annet' })];
  assert.deepEqual(search(all, 'ostlandet').map((x) => x.id).sort(), ['1', '2']);
});

test('subject hits rank above preview hits; ties go newest first', () => {
  const all = [
    m({ id: 'p', preview: 'faktura', received: '2026-10-03T00:00:00Z' }),
    m({ id: 's1', subject: 'Faktura', received: '2026-10-01T00:00:00Z' }),
    m({ id: 's2', subject: 'Faktura 2', received: '2026-10-02T00:00:00Z' }),
  ];
  assert.deepEqual(search(all, 'faktura').map((x) => x.id), ['s2', 's1', 'p']);
});

test('filters combine', () => {
  const all = [m({ id: '1', isRead: false, hasAttachments: true, fromName: 'Anna' }), m({ id: '2', isRead: false, fromName: 'Anna' }), m({ id: '3', hasAttachments: true, fromName: 'Anna' })];
  assert.deepEqual(search(all, 'from:anna is:unread has:attachment').map((x) => x.id), ['1']);
});

test('account filter accepts the address or the label', () => {
  const all = [m({ id: '1', account: 'a@o.no' }), m({ id: '2', account: 'w@f.no' })];
  assert.deepEqual(search(all, 'account:work', { 'w@f.no': 'Work' }).map((x) => x.id), ['2']);
  assert.deepEqual(search(all, 'account:a@o.no').map((x) => x.id), ['1']);
});

test('an empty query shows nothing instead of everything', () => {
  assert.deepEqual(search([m({})], '   '), []);
});
