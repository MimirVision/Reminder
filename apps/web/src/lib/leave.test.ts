import test from 'node:test';
import assert from 'node:assert/strict';
import { pickLeaveReminders, travelMinutes } from './leave.ts';
import { durationLabel, endClock } from './duration.ts';
import { planBriefings } from './briefing.ts';

const at = (d: string, hm: string) => { const [h, m] = hm.split(':').map(Number); return new Date(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10), h, m); };

test('rush hour makes the drive longer, midday does not', () => {
  assert.equal(travelMinutes(600, at('2026-10-05', '12:00')), 11); // Monday noon: 10 min x 1.08 rounds up
  assert.equal(travelMinutes(600, at('2026-10-05', '08:00')), 13); // morning rush x 1.3
  assert.equal(travelMinutes(600, at('2026-10-10', '08:00')), 10); // Saturday
  assert.equal(travelMinutes(1, at('2026-10-10', '08:00')), 1);
});

test('leave-by: due time minus the drive minus the buffer, only if still ahead', () => {
  const base = { status: 'active', due_on: '2026-10-05', due_time: '18:00', remind_travel: true, body: 'Dentist\nbring card' };
  const now = at('2026-10-05', '10:00');
  const r = pickLeaveReminders([
    { ...base, id: 'a', travelMin: 25 },
    { ...base, id: 'b', travelMin: null },
    { ...base, id: 'c', travelMin: 25, remind_travel: false },
    { ...base, id: 'd', travelMin: 25, due_time: null },
    { ...base, id: 'e', travelMin: 25, due_time: '10:20' },
    { ...base, id: 'f', travelMin: 25, status: 'done' },
  ], now);
  assert.deepEqual(r.map((x) => x.id), ['a']);
  assert.equal(r[0].at.getTime(), at('2026-10-05', '17:30').getTime());
  assert.equal(r[0].body, 'Dentist');
});

test('duration wording and end time', () => {
  assert.deepEqual([15, 60, 90, 120].map(durationLabel), ['15 min', '1 h', '1 h 30 min', '2 h']);
  assert.equal(endClock('18:00', 45), '18:45');
  assert.equal(endClock('23:30', 60), '00:30');
});

test('briefings: days with something due, today includes overdue, times still ahead', () => {
  const items = [
    { id: '1', body: 'Late one', status: 'active', due_on: '2026-10-03', due_time: null },
    { id: '2', body: 'B', status: 'active', due_on: '2026-10-05', due_time: '17:00' },
    { id: '3', body: 'A', status: 'active', due_on: '2026-10-05', due_time: '09:00' },
    { id: '4', body: 'Done', status: 'done', due_on: '2026-10-06', due_time: null },
    { id: '5', body: 'Later', status: 'inbox', due_on: '2026-10-07', due_time: null },
  ];
  const r = planBriefings(items, at('2026-10-05', '06:00'), '07:30');
  assert.deepEqual(r.map((x) => [x.day, x.count, x.late]), [['2026-10-05', 3, 1], ['2026-10-07', 1, 0]]);
  assert.deepEqual(r[0].titles, ['A', 'B']);
  // after 07:30 today's briefing is gone
  assert.deepEqual(planBriefings(items, at('2026-10-05', '08:00'), '07:30').map((x) => x.day), ['2026-10-07']);
});
