import test from 'node:test';
import assert from 'node:assert/strict';
import { ribbonMonths, type RibbonTask } from './ribbon.ts';

const base: RibbonTask = { schedule: 'interval', interval_months: 12, window_start_month: null, window_end_month: null, next_due_at: '2026-08-15' };
const on = (r: boolean[] | null) => (r ?? []).map((v, i) => (v ? i + 1 : 0)).filter(Boolean);

test('every 6 months shows both months it falls due', () => assert.deepEqual(on(ribbonMonths({ ...base, interval_months: 6, next_due_at: '2026-04-22' })), [4, 10]));
test('every year shows one month', () => assert.deepEqual(on(ribbonMonths(base)), [8]));
test('longer than a year still shows when it is next due', () => assert.deepEqual(on(ribbonMonths({ ...base, interval_months: 60 })), [8]));
test('every month marks them all, every 3 months marks four', () => {
  assert.equal(on(ribbonMonths({ ...base, interval_months: 1 })).length, 12);
  assert.deepEqual(on(ribbonMonths({ ...base, interval_months: 3, next_due_at: '2026-11-01' })), [2, 5, 8, 11]);
});
test('a seasonal window, also across new year', () => {
  assert.deepEqual(on(ribbonMonths({ ...base, schedule: 'seasonal', window_start_month: 8, window_end_month: 9 })), [8, 9]);
  assert.deepEqual(on(ribbonMonths({ ...base, schedule: 'seasonal', window_start_month: 11, window_end_month: 2 })), [1, 2, 11, 12]);
});
test('nothing to show without the data', () => {
  assert.equal(ribbonMonths({ ...base, schedule: 'seasonal' }), null);
  assert.equal(ribbonMonths({ ...base, interval_months: null }), null);
});
