import test from 'node:test';
import assert from 'node:assert/strict';
import { compareTodos, groupUpcoming, isLate, rescheduleTargets } from './todoGroups.ts';

const m = (o: object) => ({ due_on: null as string | null, due_time: null as string | null, pinned: false, priority: 0 as 0 | 1 | 2 | 3, ...o });

test('order: pinned, then priority, then time', () => {
  const list = [m({ id: 'late', due_on: '2026-10-01', due_time: '18:00' }), m({ id: 'urgent', due_on: '2026-10-01', due_time: '20:00', priority: 3 }), m({ id: 'pin', due_on: '2026-10-05', pinned: true }), m({ id: 'early', due_on: '2026-10-01', due_time: '08:00' })];
  assert.deepEqual([...list].sort(compareTodos).map((x) => (x as { id: string }).id), ['pin', 'urgent', 'early', 'late']);
});

test('upcoming is grouped by day, soonest first', () => {
  const g = groupUpcoming([m({ id: 'a', due_on: '2026-10-05' }), m({ id: 'b', due_on: '2026-10-03', priority: 1 }), m({ id: 'c', due_on: '2026-10-03', priority: 3 }), m({ id: 'today', due_on: '2026-10-01' }), m({ id: 'none' })], '2026-10-01');
  assert.deepEqual(g.map((x) => x.date), ['2026-10-03', '2026-10-05']);
  assert.deepEqual(g[0].items.map((x) => (x as { id: string }).id), ['c', 'b']);
});

test('late means before today', () => {
  assert.equal(isLate({ due_on: '2026-09-30' }, '2026-10-01'), true);
  assert.equal(isLate({ due_on: '2026-10-01' }, '2026-10-01'), false);
  assert.equal(isLate({ due_on: null }, '2026-10-01'), false);
});

test('move-to choices skip duplicates (a Saturday has no separate "weekend")', () => {
  // Thursday 1 Oct 2026
  assert.deepEqual(rescheduleTargets('2026-10-01', 4).map((x) => [x.id, x.date]), [['today', '2026-10-01'], ['tomorrow', '2026-10-02'], ['weekend', '2026-10-03'], ['nextWeek', '2026-10-05']]);
  // Saturday: the weekend is today
  assert.deepEqual(rescheduleTargets('2026-10-03', 6).map((x) => x.id), ['today', 'tomorrow', 'nextWeek']);
});
