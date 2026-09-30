import test from 'node:test';
import assert from 'node:assert/strict';
import { monthGrid, shiftMonth } from './calendar.ts';

test('October 2026 starts on a Thursday and fills whole Monday-first weeks', () => {
  const g = monthGrid(2026, 10);
  assert.ok(g.every((w) => w.length === 7));
  assert.equal(g[0][0].iso, '2026-09-28');
  assert.equal(g[0][3].iso, '2026-10-01');
  assert.equal(g[0][3].inMonth, true);
  assert.equal(g[0][2].inMonth, false);
  assert.equal(g.length, 5);
  assert.equal(g[4][6].iso, '2026-11-01');
});

test('a month that starts on Monday has no leading days; February 2027 fits four weeks', () => {
  assert.equal(monthGrid(2026, 6)[0][0].iso, '2026-06-01');
  const feb = monthGrid(2027, 2);
  assert.equal(feb.length, 4);
  assert.ok(feb.flat().every((c) => c.inMonth));
});

test('month stepping crosses years', () => {
  assert.deepEqual(shiftMonth(2026, 12, 1), { year: 2027, month: 1 });
  assert.deepEqual(shiftMonth(2026, 1, -1), { year: 2025, month: 12 });
});
