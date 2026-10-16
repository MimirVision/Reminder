// Calendar dates as ISO strings ("2026-03-31"). Due dates are dates, not instants, so every calculation here uses
// UTC arithmetic on whole days: no time of day, no timezone, no daylight-saving surprises. The only place the local
// timezone matters is deciding what "today" is, which `todayIn` does.

export type ISODate = string;

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isISODate(s: unknown): s is ISODate {
  if (typeof s !== 'string') return false;
  const m = ISO.exec(s);
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}

export function parts(d: ISODate): [number, number, number] {
  const m = ISO.exec(d);
  if (!m) throw new Error(`Not a date: ${d}`);
  return [+m[1], +m[2], +m[3]];
}

export function fromParts(y: number, m: number, d: number): ISODate {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y: number, m: number): number {
  return [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

/** Days since 1970-01-01. */
export function toDayNumber(d: ISODate): number {
  const [y, m, day] = parts(d);
  return Math.round(Date.UTC(y, m - 1, day) / 86_400_000);
}

export function fromDayNumber(n: number): ISODate {
  const dt = new Date(n * 86_400_000);
  return fromParts(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function addDays(d: ISODate, n: number): ISODate {
  return fromDayNumber(toDayNumber(d) + n);
}

export function diffDays(a: ISODate, b: ISODate): number {
  return toDayNumber(a) - toDayNumber(b);
}

/** Month index counted from year 0, so months can be compared and stepped with plain integers. */
export function monthIndex(y: number, m: number): number {
  return y * 12 + (m - 1);
}

export function fromMonthIndex(i: number): [number, number] {
  return [Math.floor(i / 12), (((i % 12) + 12) % 12) + 1];
}

/** Adds months, clamping the day to the end of a shorter month (31 Jan + 1 month = 28 or 29 Feb). */
export function addMonths(d: ISODate, n: number): ISODate {
  const [y, m, day] = parts(d);
  const [ny, nm] = fromMonthIndex(monthIndex(y, m) + n);
  return fromParts(ny, nm, Math.min(day, daysInMonth(ny, nm)));
}

export function startOfMonth(d: ISODate): ISODate {
  const [y, m] = parts(d);
  return fromParts(y, m, 1);
}

export function endOfMonth(d: ISODate): ISODate {
  const [y, m] = parts(d);
  return fromParts(y, m, daysInMonth(y, m));
}

/** ISO weekday: Monday 1 … Sunday 7. */
export function weekday(d: ISODate): number {
  // 1970-01-01 was a Thursday (4).
  return ((((toDayNumber(d) + 3) % 7) + 7) % 7) + 1;
}

export function startOfWeek(d: ISODate): ISODate {
  return addDays(d, 1 - weekday(d));
}

/** ISO 8601 week number and week-year. */
export function isoWeek(d: ISODate): { year: number; week: number } {
  const thursday = addDays(d, 4 - weekday(d));
  const [y] = parts(thursday);
  const week = Math.floor(diffDays(thursday, fromParts(y, 1, 1)) / 7) + 1;
  return { year: y, week };
}

export function isWeekend(d: ISODate): boolean {
  return weekday(d) >= 6;
}

export function minDate(a: ISODate, b: ISODate): ISODate {
  return a < b ? a : b;
}

export function maxDate(a: ISODate, b: ISODate): ISODate {
  return a > b ? a : b;
}

/** Today's date in a timezone (the browser's own by default). */
export function todayIn(timeZone?: string, now: Date = new Date()): ISODate {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

/** Converts a JS Date to its date in the browser's local timezone. */
export function localISODate(dt: Date): ISODate {
  return fromParts(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
}

/** The 6×7 grid of dates a month view shows, starting on Monday. */
export function monthGrid(anyDayInMonth: ISODate): ISODate[] {
  const first = startOfWeek(startOfMonth(anyDayInMonth));
  return Array.from({ length: 42 }, (_, i) => addDays(first, i));
}
