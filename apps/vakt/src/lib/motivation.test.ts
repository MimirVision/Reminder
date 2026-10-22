import { expect, it } from 'vitest';
import { motivation, type MonthPicture } from './motivation';

const base: MonthPicture = { earned: 0, planned: 0, supplements: 0, goal: null, bestBefore: 0, shiftsDone: 0, shiftsLeft: 0, isCurrent: true, isPast: false };

it('invites the first shift in an empty month', () => {
  expect(motivation(base).text).toMatch(/første vakt/);
});

it('celebrates a reached goal before anything else', () => {
  expect(motivation({ ...base, earned: 31000, goal: 30000, bestBefore: 20000, shiftsDone: 10 }).emoji).toBe('🎉');
});

it('notices a record month', () => {
  expect(motivation({ ...base, earned: 25000, bestBefore: 20000, shiftsDone: 10 }).emoji).toBe('🏆');
});

it('says when the planned shifts will reach the goal', () => {
  expect(motivation({ ...base, earned: 10000, planned: 21000, goal: 30000, shiftsDone: 4, shiftsLeft: 8 }).text).toMatch(/når du målet/);
});

it('counts the shifts left otherwise', () => {
  expect(motivation({ ...base, earned: 2000, planned: 2000, shiftsDone: 1, shiftsLeft: 1 }).text).toMatch(/^1 vakt igjen/);
});
