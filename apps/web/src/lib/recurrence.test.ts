import test from 'node:test';
import assert from 'node:assert/strict';
import { isRepeatRule, nextOccurrence, stepDate } from './recurrence.ts';

test('steps by day, week, month and year, clamping short months', () => {
  assert.equal(stepDate('2026-10-31', 'daily'), '2026-11-01');
  assert.equal(stepDate('2026-12-28', 'weekly'), '2027-01-04');
  assert.equal(stepDate('2026-01-31', 'monthly'), '2026-02-28');
  assert.equal(stepDate('2024-01-31', 'monthly'), '2024-02-29');
  assert.equal(stepDate('2024-02-29', 'yearly'), '2025-02-28');
});

test('the next occurrence is always in the future, on the same weekday for weekly', () => {
  assert.equal(nextOccurrence('2026-09-30', 'daily', '2026-09-30'), '2026-10-01');
  assert.equal(nextOccurrence('2026-09-01', 'weekly', '2026-09-30'), '2026-10-06');
  assert.equal(nextOccurrence('2026-10-07', 'weekly', '2026-09-30'), '2026-10-14');
  assert.equal(nextOccurrence('2020-01-31', 'yearly', '2026-09-30'), '2027-01-31');
});

test('rule check', () => {
  assert.equal(isRepeatRule('weekly'), true);
  assert.equal(isRepeatRule('hourly'), false);
  assert.equal(isRepeatRule(null), false);
});
