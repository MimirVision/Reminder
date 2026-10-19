// Public holidays, so "next business day" also skips them. Mirrors ledger_is_holiday() in
// supabase/migrations/0003_ledger_v3.sql; the parity test runs both.
import { addDays, diffDays, fromParts, parts, weekday, type ISODate } from './dates';

/** 'NO' for Norway (the default), 'none' to count weekends only. */
export type HolidayCalendar = 'NO' | 'none';

/** Easter Sunday in the Gregorian calendar (the anonymous algorithm). */
export function easter(y: number): ISODate {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const n = h + l - 7 * m + 114;
  return fromParts(y, Math.floor(n / 31), (n % 31) + 1);
}

const FIXED_NO = new Set(['01-01', '05-01', '05-17', '12-25', '12-26']);
/** Days from Easter Sunday: Maundy Thursday, Good Friday, Easter Sunday and Monday, Ascension, Whit Sunday and Monday. */
const EASTER_NO = new Set([-3, -2, 0, 1, 39, 49, 50]);

/** A workspace's calendar: Norway unless switched off. */
export const calendarOf = (settings: { holidays?: HolidayCalendar } | undefined): HolidayCalendar => settings?.holidays ?? 'NO';

export function isHoliday(d: ISODate, cal: HolidayCalendar): boolean {
  if (cal !== 'NO') return false;
  if (FIXED_NO.has(d.slice(5))) return true;
  return EASTER_NO.has(diffDays(d, easter(parts(d)[0])));
}

export function holidayName(d: ISODate, cal: HolidayCalendar): string | null {
  if (!isHoliday(d, cal)) return null;
  const fixed: Record<string, string> = { '01-01': 'New Year’s Day', '05-01': 'Labour Day', '05-17': 'Constitution Day', '12-25': 'Christmas Day', '12-26': 'Boxing Day' };
  if (fixed[d.slice(5)]) return fixed[d.slice(5)];
  const named: Record<number, string> = { [-3]: 'Maundy Thursday', [-2]: 'Good Friday', 0: 'Easter Sunday', 1: 'Easter Monday', 39: 'Ascension Day', 49: 'Whit Sunday', 50: 'Whit Monday' };
  return named[diffDays(d, easter(parts(d)[0]))] ?? null;
}

export function isBusinessDay(d: ISODate, cal: HolidayCalendar): boolean {
  return weekday(d) < 6 && !isHoliday(d, cal);
}

/** Moves a date off weekends and holidays in one direction (at most two weeks, like the database). */
export function toBusinessDay(d: ISODate, step: 1 | -1, cal: HolidayCalendar): ISODate {
  let n = 0;
  while (!isBusinessDay(d, cal) && n++ < 14) d = addDays(d, step);
  return d;
}
