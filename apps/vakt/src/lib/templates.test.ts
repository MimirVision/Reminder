import { expect, it } from 'vitest';
import { dayLabel, templateOf, timesFor } from './templates';
import type { ShiftTemplate } from './types';

const natt: ShiftTemplate = {
  id: 'n', name: 'Natt', start_time: '21:45', end_time: '07:45', break_minutes: 0,
  days: { fri: { start_time: '21:30', end_time: '08:15', break_minutes: 0 }, holiday: { start_time: '22:00', end_time: '08:00', break_minutes: 15 } },
};

it('uses the times for the day the shift starts on, holidays first', () => {
  expect(timesFor(natt, '2026-10-21')).toEqual({ start_time: '21:45', end_time: '07:45', break_minutes: 0 }); // Wednesday
  expect(timesFor(natt, '2026-10-23')).toMatchObject({ start_time: '21:30', end_time: '08:15' }); // Friday
  expect(timesFor(natt, '2026-12-25')).toMatchObject({ start_time: '22:00', break_minutes: 15 }); // 1. juledag, a Friday
});

it('finds the shift type from a shift’s times on its date', () => {
  expect(templateOf([natt], { date: '2026-10-23', start_time: '21:30', end_time: '08:15' })?.id).toBe('n');
  expect(templateOf([natt], { date: '2026-10-21', start_time: '21:30', end_time: '08:15' })).toBeUndefined();
});

it('names the days, with nights running into the next day', () => {
  expect(dayLabel('fri', true)).toBe('fredag → lørdag');
  expect(dayLabel('sun', true, true)).toBe('søn → man');
  expect(dayLabel('sat', false)).toBe('lørdag');
});
