import { describe, expect, it } from 'vitest';
import { easter, holidayName, isBusinessDay, isHoliday, toBusinessDay } from './holidays';
import { dueDateFor, listPeriods, recurrenceOf } from './recurrence';

describe('Norwegian public holidays', () => {
  it('finds Easter Sunday', () => {
    expect(['2024', '2025', '2026', '2027', '2038'].map((y) => easter(+y))).toEqual(['2024-03-31', '2025-04-20', '2026-04-05', '2027-03-28', '2038-04-25']);
  });

  it('knows the fixed and the moving days', () => {
    for (const d of ['2026-01-01', '2026-04-02', '2026-04-03', '2026-04-05', '2026-04-06', '2026-05-01', '2026-05-14', '2026-05-17', '2026-05-24', '2026-05-25', '2026-12-25', '2026-12-26']) {
      expect(isHoliday(d, 'NO'), d).toBe(true);
    }
    for (const d of ['2026-04-04', '2026-05-13', '2026-12-24', '2026-12-31']) expect(isHoliday(d, 'NO'), d).toBe(false);
    expect(holidayName('2026-05-17', 'NO')).toBe('Constitution Day');
    expect(holidayName('2026-05-14', 'NO')).toBe('Ascension Day');
    expect(isHoliday('2026-05-17', 'none')).toBe(false);
  });

  it('moves past weekends and holidays together', () => {
    expect(isBusinessDay('2026-05-18', 'NO')).toBe(true);
    expect(toBusinessDay('2026-12-25', 1, 'NO')).toBe('2026-12-28'); // Fri holiday, Sat, Sun
    expect(toBusinessDay('2026-04-06', -1, 'NO')).toBe('2026-04-01'); // Easter Monday back past Sunday, Saturday, Good Friday, Maundy Thursday
    expect(toBusinessDay('2026-12-25', 1, 'none')).toBe('2026-12-25');
  });

  it('changes due dates only with a calendar and an adjustment rule', () => {
    const may17 = { kind: 'month_offset', from: 'end', months: 1, day: 17, adjust: 'next_business_day' } as const;
    expect(dueDateFor(may17, '2027-04-01', '2027-04-30')).toBe('2027-05-17'); // a Monday: weekends only, no change
    expect(dueDateFor(may17, '2027-04-01', '2027-04-30', 'NO')).toBe('2027-05-18');
    expect(dueDateFor({ ...may17, adjust: 'none' }, '2027-04-01', '2027-04-30', 'NO')).toBe('2027-05-17');
    const rec = recurrenceOf({ unit: 'month', interval: 1, anchorMonth: 1, startDate: '2026-11-01', endDate: null, dueRule: { kind: 'month_offset', from: 'end', months: 0, day: 25, adjust: 'next_business_day' } }, 'NO');
    expect(listPeriods(rec, '2026-12-31').map((p) => p.due)).toEqual(['2026-11-25', '2026-12-28']);
  });
});
