import test from 'node:test';
import assert from 'node:assert/strict';
import { agoParts, dayProgress, isoWeek, overviewStats, partOfDay, skyOf } from './command.ts';

test('the overview counts late, today, the next seven days and undated', () => {
  const s = overviewStats([{ due_on: '2026-11-20' }, { due_on: '2026-11-25' }, { due_on: '2026-11-25' }, { due_on: '2026-11-26' }, { due_on: '2026-12-02' }, { due_on: '2026-12-03' }, { due_on: null }], '2026-11-25');
  assert.deepEqual(s, { open: 7, late: 1, today: 2, next7: 2, noDate: 1 });
});

test('progress is what is done out of everything that was due, and 1 on an empty day', () => {
  assert.equal(dayProgress(3, { late: 0, today: 1 }), 0.75);
  assert.equal(dayProgress(0, { late: 1, today: 1 }), 0);
  assert.equal(dayProgress(0, { late: 0, today: 0 }), 1);
});

test('ISO week numbers, including the year edges', () => {
  assert.equal(isoWeek(new Date(2026, 10, 26)), 48);
  assert.equal(isoWeek(new Date(2026, 0, 1)), 1);
  assert.equal(isoWeek(new Date(2024, 11, 30)), 1);
  assert.equal(isoWeek(new Date(2021, 0, 3)), 53);
});

test('parts of the day', () => {
  assert.deepEqual([4, 5, 11, 12, 17, 18, 22, 23, 0].map(partOfDay), ['night', 'morning', 'morning', 'afternoon', 'afternoon', 'evening', 'evening', 'night', 'night']);
});

test('weather codes map to a sky', () => {
  assert.equal(skyOf(0).kind, 'clear'); assert.equal(skyOf(2).kind, 'partly'); assert.equal(skyOf(3).kind, 'cloud'); assert.equal(skyOf(45).kind, 'fog');
  assert.equal(skyOf(53).kind, 'drizzle'); assert.equal(skyOf(63).kind, 'rain'); assert.equal(skyOf(81).kind, 'rain'); assert.equal(skyOf(73).kind, 'snow'); assert.equal(skyOf(96).kind, 'storm');
});

test('how long ago', () => {
  const now = Date.parse('2026-11-26T12:00:00Z');
  assert.deepEqual(agoParts('2026-11-26T11:59:40Z', now), { unit: 'now', n: 0 });
  assert.deepEqual(agoParts('2026-11-26T11:15:00Z', now), { unit: 'min', n: 45 });
  assert.deepEqual(agoParts('2026-11-26T08:00:00Z', now), { unit: 'hour', n: 4 });
  assert.deepEqual(agoParts('2026-11-23T12:00:00Z', now), { unit: 'day', n: 3 });
});
