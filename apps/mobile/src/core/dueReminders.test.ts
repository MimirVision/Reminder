import test from 'node:test';
import assert from 'node:assert/strict';
import { dueMoment, pickDueReminders, type DueMemory } from './dueReminders.ts';

const m = (id: string, due_on: string | null, due_time: string | null = null, status: DueMemory['status'] = 'active', body = id): DueMemory => ({ id, body, status, due_on, due_time });

test('a date alone means 09:00, a time is used as given', () => {
  const a = dueMoment('2026-10-03', null);
  assert.deepEqual([a.getFullYear(), a.getMonth(), a.getDate(), a.getHours(), a.getMinutes()], [2026, 9, 3, 9, 0]);
  const b = dueMoment('2026-10-03', '18:30:00');
  assert.deepEqual([b.getHours(), b.getMinutes()], [18, 30]);
});

test('only open, dated, future to-dos are picked, soonest first, first line only', () => {
  const now = new Date(2026, 9, 1, 12, 0);
  const picked = pickDueReminders([
    m('late', '2026-10-05'), m('past', '2026-09-30'), m('today-earlier', '2026-10-01', '08:00'), m('today-later', '2026-10-01', '18:00'),
    m('done', '2026-10-02', null, 'done'), m('undated', null), m('multi', '2026-10-03', null, 'inbox', 'Line one\nLine two'),
  ], now);
  assert.deepEqual(picked.map((r) => r.id), ['today-later', 'multi', 'late']);
  assert.equal(picked[1].body, 'Line one');
});

test('the list is capped for iOS', () => {
  const now = new Date(2026, 0, 1);
  const many = Array.from({ length: 100 }, (_, i) => m(`m${i}`, `2026-03-${String(1 + (i % 28)).padStart(2, '0')}`));
  assert.equal(pickDueReminders(many, now).length, 60);
  assert.equal(pickDueReminders(many, now, 5).length, 5);
});

test('remind me before rings earlier, and falls back to the due moment when that is already past', () => {
  const now = new Date(2026, 9, 1, 12, 0);
  const withLead = (id: string, time: string, lead: number | null): DueMemory => ({ ...m(id, '2026-10-01', time), remind_before: lead });
  const picked = pickDueReminders([withLead('a', '18:00', 30), withLead('b', '12:20', 30), withLead('c', '18:00', null), withLead('d', '11:00', 30)], now);
  assert.deepEqual(picked.map((r) => [r.id, r.at.getHours() * 60 + r.at.getMinutes(), r.lead]), [['b', 740, 0], ['a', 1050, 30], ['c', 1080, 0]]);
});
