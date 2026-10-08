import test from 'node:test';
import assert from 'node:assert/strict';
import { presets, isSnoozed } from './snooze.ts';

const ids = (d: Date) => presets(d).map((p) => p.id);

test('Monday morning: later today, tomorrow, weekend, next week', () => {
  assert.deepEqual(ids(new Date(2026, 9, 5, 9, 0)), ['later', 'tomorrow', 'weekend', 'nextweek']);
});

test('after 16:00 "later today" is not offered', () => {
  assert.deepEqual(ids(new Date(2026, 9, 5, 17, 0)), ['tomorrow', 'weekend', 'nextweek']);
});

test('on the weekend there is no "this weekend"', () => {
  assert.deepEqual(ids(new Date(2026, 9, 10, 9, 0)), ['later', 'tomorrow', 'nextweek']);
});

test('times are 18:00, 08:00 next day, Saturday 09:00, next Monday 08:00', () => {
  const p = presets(new Date(2026, 9, 5, 9, 0));
  assert.equal(p[0].at.getHours(), 18);
  assert.equal(p[1].at.getDate(), 6);
  assert.equal(p[2].at.getDay(), 6);
  assert.equal(p[3].at.getDay(), 1);
  assert.equal(p[3].at.getDate(), 12);
});

test('every preset is in the future', () => {
  for (const h of [0, 8, 15, 16, 23]) for (let d = 5; d < 12; d++) {
    const now = new Date(2026, 9, d, h, 30);
    for (const p of presets(now)) assert.ok(p.at.getTime() > now.getTime(), `${now.toISOString()} ${p.id}`);
  }
});

test('isSnoozed', () => {
  const now = new Date(2026, 9, 5, 9);
  assert.equal(isSnoozed(null, now), false);
  assert.equal(isSnoozed(new Date(2026, 9, 5, 10).toISOString(), now), true);
  assert.equal(isSnoozed(new Date(2026, 9, 5, 8).toISOString(), now), false);
});
