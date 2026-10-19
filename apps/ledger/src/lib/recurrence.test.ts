import { describe, expect, it } from 'vitest';
import { addDays, addMonths, isoWeek, monthGrid, todayIn, weekday } from './dates';
import { describeDueRule, dueDateFor, listPeriods, periodContaining, periodLabel, upcomingPeriods, validateRecurrence } from './recurrence';
import type { Recurrence } from './types';

const rec = (r: Partial<Recurrence>): Recurrence => ({
  unit: 'month', interval: 1, anchorMonth: 1, startDate: '2026-01-01', endDate: null,
  dueRule: { kind: 'month_offset', from: 'end', months: 1, day: 10 }, ...r,
});

describe('dates', () => {
  it('handles month ends and leap years', () => {
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonths('2025-01-31', 1)).toBe('2025-02-28');
    expect(addMonths('2100-01-31', 1)).toBe('2100-02-28');
    expect(addMonths('2000-01-31', 1)).toBe('2000-02-29');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2024-12-31', 1)).toBe('2025-01-01');
  });

  it('is unaffected by daylight saving', () => {
    // Europe/Oslo springs forward on 29 March 2026 and falls back on 25 October 2026.
    expect(addDays('2026-03-28', 1)).toBe('2026-03-29');
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30');
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26');
    expect(todayIn('Europe/Oslo', new Date('2026-03-28T23:30:00Z'))).toBe('2026-03-29');
    expect(todayIn('Europe/Oslo', new Date('2026-10-24T22:30:00Z'))).toBe('2026-10-25');
    expect(todayIn('Europe/Oslo', new Date('2026-10-25T22:59:00Z'))).toBe('2026-10-25');
    expect(todayIn('Europe/Oslo', new Date('2026-10-25T23:00:00Z'))).toBe('2026-10-26');
  });

  it('knows weekdays and ISO weeks', () => {
    expect(weekday('2026-10-16')).toBe(5);
    expect(isoWeek('2026-01-01')).toEqual({ year: 2026, week: 1 });
    expect(isoWeek('2027-01-01')).toEqual({ year: 2026, week: 53 });
    expect(isoWeek('2024-12-30')).toEqual({ year: 2025, week: 1 });
  });

  it('builds a month grid starting on Monday', () => {
    const g = monthGrid('2026-02-14');
    expect(g).toHaveLength(42);
    expect(g[0]).toBe('2026-01-26');
    expect(weekday(g[0])).toBe(1);
  });
});

describe('periods', () => {
  it('aligns quarters to the anchor month', () => {
    expect(periodContaining(rec({ interval: 3 }), '2026-05-20')).toEqual({ start: '2026-04-01', end: '2026-06-30' });
    expect(periodContaining(rec({ interval: 3, anchorMonth: 2 }), '2026-05-20')).toEqual({ start: '2026-05-01', end: '2026-07-31' });
  });

  it('gives a July fiscal year', () => {
    const p = periodContaining(rec({ interval: 12, anchorMonth: 7 }), '2026-03-01');
    expect(p).toEqual({ start: '2025-07-01', end: '2026-06-30' });
  });

  it('lists Norwegian two-monthly VAT terms with their due dates', () => {
    // Term 1 (Jan–Feb) is due 10 April, term 2 (Mar–Apr) 10 June, …, term 6 (Nov–Dec) 10 February.
    const ps = listPeriods(rec({ interval: 2, dueRule: { kind: 'month_offset', from: 'end', months: 1, day: 10 } }), '2026-12-31');
    expect(ps.map((p) => periodLabel(p.key))).toEqual(['Jan–Feb 2026', 'Mar–Apr 2026', 'May–Jun 2026', 'Jul–Aug 2026', 'Sep–Oct 2026', 'Nov–Dec 2026']);
    expect(ps.map((p) => p.due)).toEqual(['2026-03-10', '2026-05-10', '2026-07-10', '2026-09-10', '2026-11-10', '2027-01-10']);
    const vat = listPeriods(rec({ interval: 2, dueRule: { kind: 'month_offset', from: 'end', months: 2, day: 10 } }), '2026-02-01');
    expect(vat[0].due).toBe('2026-04-10');
  });

  it('starts with the period containing the start date and stops at the end date', () => {
    const ps = listPeriods(rec({ startDate: '2026-03-15', endDate: '2026-06-02' }), '2027-01-01');
    expect(ps.map((p) => p.start)).toEqual(['2026-03-01', '2026-04-01', '2026-05-01', '2026-06-01']);
  });

  it('clamps a due day to short months and supports the last day', () => {
    expect(dueDateFor({ kind: 'month_offset', from: 'end', months: 1, day: 31 }, '2026-01-01', '2026-01-31')).toBe('2026-02-28');
    expect(dueDateFor({ kind: 'month_offset', from: 'end', months: 1, day: 31 }, '2028-01-01', '2028-01-31')).toBe('2028-02-29');
    expect(dueDateFor({ kind: 'month_offset', from: 'end', months: 1, day: 'last' }, '2028-01-01', '2028-01-31')).toBe('2028-02-29');
    expect(dueDateFor({ kind: 'month_offset', from: 'end', months: 5, day: 31 }, '2026-01-01', '2026-12-31')).toBe('2027-05-31');
  });

  it('moves weekend due dates when asked', () => {
    // 10 Oct 2026 is a Saturday.
    const r = { kind: 'month_offset', from: 'end', months: 1, day: 10 } as const;
    expect(dueDateFor(r, '2026-09-01', '2026-09-30')).toBe('2026-10-10');
    expect(dueDateFor({ ...r, adjust: 'next_business_day' }, '2026-09-01', '2026-09-30')).toBe('2026-10-12');
    expect(dueDateFor({ ...r, adjust: 'previous_business_day' }, '2026-09-01', '2026-09-30')).toBe('2026-10-09');
  });

  it('handles weekly schedules and labels them by ISO week', () => {
    const r = rec({ unit: 'week', interval: 1, startDate: '2026-10-14', dueRule: { kind: 'weekday', weekday: 5 } });
    const ps = listPeriods(r, '2026-10-26');
    expect(ps.map((p) => [p.start, p.due])).toEqual([['2026-10-12', '2026-10-16'], ['2026-10-19', '2026-10-23'], ['2026-10-26', '2026-10-30']]);
    expect(periodLabel(ps[0].key)).toBe('Week 42, 2026');
  });

  it('labels periods for people', () => {
    expect(periodLabel('M1:2026-03-01')).toBe('March 2026');
    expect(periodLabel('M3:2026-07-01')).toBe('Q3 2026');
    expect(periodLabel('M12:2026-01-01')).toBe('2026');
    expect(periodLabel('M12:2025-07-01')).toBe('FY 2025/26');
    expect(periodLabel('M2:2025-11-01')).toBe('Nov–Dec 2025');
    expect(periodLabel('M2:2025-12-01')).toBe('Dec 2025 – Jan 2026');
    expect(periodLabel('W2:2026-10-12')).toBe('Weeks 42–43, 2026');
  });

  it('previews upcoming periods from a date', () => {
    const ps = upcomingPeriods(rec({ interval: 3 }), '2026-10-16', 3);
    expect(ps.map((p) => p.due)).toEqual(['2027-01-10', '2027-04-10', '2027-07-10']);
  });

  it('validates rules', () => {
    expect(validateRecurrence(rec({}))).toEqual([]);
    expect(validateRecurrence(rec({ endDate: '2025-01-01' }))).toContain('The end date is before the start date.');
    expect(validateRecurrence(rec({ dueRule: { kind: 'weekday', weekday: 3 } }))).toContain('A weekday rule only works for weekly schedules.');
    expect(validateRecurrence(rec({ interval: 0 })).length).toBe(1);
  });

  it('describes rules', () => {
    expect(describeDueRule({ kind: 'month_offset', from: 'end', months: 1, day: 10, adjust: 'next_business_day' }))
      .toBe('10th of the month after the period, next business day if a weekend or holiday');
    expect(describeDueRule({ kind: 'days_after_end', days: 14 })).toBe('14 days after the period ends');
  });
});

describe('short due rule', () => {
  it('fits in a table cell', async () => {
    const { shortDueRule } = await import('./recurrence');
    expect(shortDueRule({ kind: 'month_offset', from: 'end', months: 1, day: 15, adjust: 'next_business_day' })).toBe('15th, month after (weekday)');
    expect(shortDueRule({ kind: 'month_offset', from: 'end', months: 5, day: 'last' })).toBe('Last day, 5 months after');
    expect(shortDueRule({ kind: 'weekday', weekday: 5 })).toBe('Friday');
  });
});
