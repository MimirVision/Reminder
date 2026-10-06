import test from 'node:test';
import assert from 'node:assert/strict';
import { sortingReport } from './report.ts';
import type { Mail } from './types.ts';

const m = (id: string, o: Partial<Mail>): Mail => ({ key: `a|${id}`, account: 'a', id, conversationId: '', received: '2026-10-01T10:00:00Z', subject: 'SECRET SUBJECT', fromName: 'Secret Name', fromAddress: 'x@y.no', preview: 'SECRET PREVIEW', isRead: false, flagged: false, hasAttachments: false, folder: 'inbox', kind: 'person', why: ['Written by a person'], ...o });

test('the report counts tabs and companies, and says what decided', () => {
  const mail = [
    m('1', { fromAddress: 'anna@privat.no' }),
    m('2', { fromAddress: 'tilbud@mail.butikk.no', kind: 'promo', sig: ['unsub', 'esp'], why: ['Has an unsubscribe link'], inf: 'other' }),
    m('3', { fromAddress: 'ordre@butikk.no', kind: 'transaction', sig: ['unsub'], why: ['Looks like a receipt or an invoice'], inf: 'focused' }),
    m('4', { fromAddress: 'news@butikk.no', kind: 'promo', sig: ['unsub', 'esp'], why: ['Has an unsubscribe link'], inf: 'other' }),
    m('5', { fromAddress: 'gone@x.no', folder: 'archive' }),
  ];
  const r = sortingReport(mail, { '@butikk.no': 'promo', 'anna@privat.no': 'person' }, '2026-10-06');
  assert.match(r, /^Post sorting report · rules v\d+ · 2026-10-06\n4 messages in the inbox, headers read for 3\n/);
  assert.match(r, /Primary 1 · Transactions 1 · Updates 0 · Promotions 2/);
  assert.match(r, /P 0\/0, T 1\/0, U 0\/0, M 0\/2/);
  assert.match(r, /butikk\.no {2}3 {2}P0 T1 U0 M2 {2}unsub×3 esp×2 {2}"Has an unsubscribe link"/);
  assert.match(r, /privat\.no {2}1 {2}P1 T0 U0 M0 {2}no marks/);
  assert.match(r, /everything from butikk\.no → Promotions/);
  assert.match(r, /one sender at privat\.no → Primary/);
  assert.ok(r.indexOf('butikk.no  3') < r.indexOf('privat.no  1'), 'busiest company first');
});

test('the report never contains a subject, a preview, a name or a full address', () => {
  const r = sortingReport([m('1', { fromAddress: 'anna.hansen@firma.no', fromName: 'Anna Hansen', subject: 'Min hemmelige tittel', preview: 'Hemmelig tekst' })], { 'anna.hansen@firma.no': 'update' }, '2026-10-06');
  for (const secret of ['anna.hansen', 'Anna', 'Hansen', 'hemmelige', 'Hemmelig', '@firma.no']) assert.ok(!r.includes(secret), secret);
  assert.ok(r.includes('firma.no'));
});

test('a long list is cut after the top companies, and an empty inbox is fine', () => {
  const many = Array.from({ length: 5 }, (_, i) => m(String(i), { fromAddress: `a@firma${i}.no` }));
  const r = sortingReport(many, {}, '2026-10-06', 2);
  assert.match(r, /\(and 3 more companies, 3 messages\)/);
  assert.match(r, /Your rules: none/);
  assert.match(sortingReport([], {}, '2026-10-06'), /0 messages in the inbox/);
});

test('mail with an old saved kind does not break the report', () => {
  assert.doesNotThrow(() => sortingReport([m('1', { kind: 'newsletter' as never })], {}, '2026-10-06'));
});
