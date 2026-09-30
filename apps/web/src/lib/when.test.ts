import test from 'node:test';
import assert from 'node:assert/strict';
import { makeT } from '../i18n/core.ts';
import { addDays, compareDue, dueBucket, dueLabel, quickDates, timeShort } from './when.ts';

const wed = new Date(2026, 8, 30, 10, 0); // Wednesday 30 Sep 2026 (local time, so the tests do not depend on the machine's zone)
const en = makeT('en');
const nb = makeT('nb');

test('day arithmetic crosses month and year ends', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2026-09-30', 1), '2026-10-01');
});

test('quick dates: tomorrow, the coming Saturday, next Monday', () => {
  assert.deepEqual(quickDates(wed), { today: '2026-09-30', tomorrow: '2026-10-01', weekend: '2026-10-03', nextWeek: '2026-10-05' });
  assert.equal(quickDates(new Date(2026, 9, 3)).weekend, '2026-10-03', 'on Saturday the weekend is today');
  assert.equal(quickDates(new Date(2026, 9, 4)).weekend, '2026-10-04', 'on Sunday too');
  assert.equal(quickDates(new Date(2026, 9, 4)).nextWeek, '2026-10-05');
  assert.equal(quickDates(new Date(2026, 9, 5)).nextWeek, '2026-10-12', 'on Monday next week is a week away');
});

test('labels in English', () => {
  const l = (due_on: string | null, due_time: string | null = null) => dueLabel({ due_on, due_time }, en, 'en-GB', wed);
  assert.equal(l(null), '');
  assert.equal(l('2026-09-30'), 'Today');
  assert.equal(l('2026-09-30', '18:00:00'), 'Today 18:00');
  assert.equal(l('2026-10-01'), 'Tomorrow');
  assert.equal(l('2026-10-01', '09:30'), 'Tomorrow 09:30');
  assert.match(l('2026-10-03'), /^Saturday$/);
  assert.match(l('2026-10-20'), /20 Oct/);
  assert.match(l('2027-01-05'), /2027/, 'other years show the year');
  assert.match(l('2026-09-28', '08:00'), /^Since .*28 Sep/, 'earlier days: neutral wording, no time, no "overdue"');
});

test('labels in Norwegian', () => {
  const l = (due_on: string, due_time: string | null = null) => dueLabel({ due_on, due_time }, nb, 'nb-NO', wed);
  assert.equal(l('2026-09-30', '18:00'), 'I dag 18:00');
  assert.equal(l('2026-10-01'), 'I morgen');
  assert.match(l('2026-10-03'), /lørdag/i);
  assert.match(l('2026-09-28'), /^Siden /);
});

test('buckets and ordering', () => {
  assert.equal(dueBucket({ due_on: null, due_time: null }, wed), 'none');
  assert.equal(dueBucket({ due_on: '2026-09-29', due_time: null }, wed), 'today', 'earlier days are shown with today');
  assert.equal(dueBucket({ due_on: '2026-09-30', due_time: '23:59' }, wed), 'today');
  assert.equal(dueBucket({ due_on: '2026-10-01', due_time: null }, wed), 'upcoming');
  const items = [
    { due_on: null, due_time: null, n: 'undated' }, { due_on: '2026-10-02', due_time: '09:00', n: 'c' },
    { due_on: '2026-10-01', due_time: '18:00', n: 'b' }, { due_on: '2026-10-01', due_time: null, n: 'a' },
  ];
  assert.deepEqual(items.sort(compareDue).map((x) => x.n), ['a', 'b', 'c', 'undated']);
  assert.equal(timeShort('18:00:00'), '18:00');
  assert.equal(timeShort(null), '');
});
