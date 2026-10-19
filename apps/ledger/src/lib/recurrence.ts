// The recurrence engine. A schedule is a rule; this file turns the rule into periods ("March 2026", "Q3 2026",
// "FY 2025/26") with a stable key and a due date. supabase/migrations/0002_ledger_engine.sql implements the same rules in
// SQL so the database can generate occurrences on its own; supabase/tests/parity.test.ts checks the two agree.

import {
  addDays, daysInMonth, diffDays, fromMonthIndex, fromParts, isoWeek, monthIndex, parts, startOfWeek, weekday, type ISODate,
} from './dates';
import { toBusinessDay, type HolidayCalendar } from './holidays';
import type { Adjust, DueRule, Frequency, IntervalUnit, Pause, Recurrence, Schedule } from './types';

export interface Period {
  /** Unique within a schedule; with schedule_id it is the occurrence's identity. */
  key: string;
  start: ISODate;
  end: ISODate;
  due: ISODate;
}

export const MAX_PERIODS = 5000;

const mod = (a: number, n: number) => ((a % n) + n) % n;

export function frequencyToUnit(f: Frequency, custom?: { unit: IntervalUnit; interval: number }): { unit: IntervalUnit; interval: number } {
  switch (f) {
    case 'weekly': return { unit: 'week', interval: 1 };
    case 'monthly': return { unit: 'month', interval: 1 };
    case 'quarterly': return { unit: 'month', interval: 3 };
    case 'yearly': return { unit: 'month', interval: 12 };
    case 'custom': return custom ?? { unit: 'month', interval: 2 };
  }
}

/** A schedule's recurrence; `holidays` is the workspace's calendar for business-day adjustment. */
export function recurrenceOf(s: Pick<Schedule, 'unit' | 'interval' | 'anchorMonth' | 'startDate' | 'endDate' | 'dueRule'>, holidays: HolidayCalendar = 'none'): Recurrence {
  return { unit: s.unit, interval: s.interval, anchorMonth: s.anchorMonth, startDate: s.startDate, endDate: s.endDate, dueRule: s.dueRule, holidays };
}

/** Problems with a recurrence, in words a person can act on. Empty when it is valid. */
export function validateRecurrence(r: Recurrence): string[] {
  const errors: string[] = [];
  if (!Number.isInteger(r.interval) || r.interval < 1 || r.interval > (r.unit === 'week' ? 52 : 24)) {
    errors.push(r.unit === 'week' ? 'Repeat every 1–52 weeks.' : 'Repeat every 1–24 months.');
  }
  if (!Number.isInteger(r.anchorMonth) || r.anchorMonth < 1 || r.anchorMonth > 12) errors.push('Choose the month periods start in.');
  if (r.endDate && r.endDate < r.startDate) errors.push('The end date is before the start date.');
  errors.push(...validateDueRule(r.dueRule, r.unit));
  return errors;
}

export function validateDueRule(rule: DueRule, unit: IntervalUnit): string[] {
  const adjustOk = rule.adjust === undefined || ['none', 'next_business_day', 'previous_business_day'].includes(rule.adjust);
  const errors: string[] = adjustOk ? [] : ['Unknown weekend rule.'];
  switch (rule.kind) {
    case 'month_offset':
      if (!Number.isInteger(rule.months) || rule.months < 0 || rule.months > 24) errors.push('Months after must be 0–24.');
      if (rule.day !== 'last' && (!Number.isInteger(rule.day) || rule.day < 1 || rule.day > 31)) errors.push('Day must be 1–31 or the last day.');
      if (rule.from !== 'start' && rule.from !== 'end') errors.push('Choose whether to count from the start or the end of the period.');
      return errors;
    case 'days_after_end':
      if (!Number.isInteger(rule.days) || rule.days < 0 || rule.days > 366) errors.push('Days after the period must be 0–366.');
      return errors;
    case 'weekday':
      if (!Number.isInteger(rule.weekday) || rule.weekday < 1 || rule.weekday > 7) errors.push('Choose a weekday.');
      if (unit !== 'week') errors.push('A weekday rule only works for weekly schedules.');
      return errors;
    default:
      return ['Unknown due-date rule.'];
  }
}

function adjust(d: ISODate, a: Adjust | undefined, cal: HolidayCalendar): ISODate {
  if (a === 'next_business_day') return toBusinessDay(d, 1, cal);
  if (a === 'previous_business_day') return toBusinessDay(d, -1, cal);
  return d;
}

/** The due date of one period. With a holiday calendar, business-day adjustment also skips public holidays. */
export function dueDateFor(rule: DueRule, start: ISODate, end: ISODate, cal: HolidayCalendar = 'none'): ISODate {
  switch (rule.kind) {
    case 'month_offset': {
      const [y, m] = parts(rule.from === 'start' ? start : end);
      const [ty, tm] = fromMonthIndex(monthIndex(y, m) + rule.months);
      const dim = daysInMonth(ty, tm);
      return adjust(fromParts(ty, tm, rule.day === 'last' ? dim : Math.min(rule.day, dim)), rule.adjust, cal);
    }
    case 'days_after_end':
      return adjust(addDays(end, rule.days), rule.adjust, cal);
    case 'weekday':
      return adjust(addDays(start, mod(rule.weekday - weekday(start), 7)), rule.adjust, cal);
  }
}

/** The period containing `d`. */
export function periodContaining(r: Recurrence, d: ISODate): { start: ISODate; end: ISODate } {
  if (r.unit === 'week') {
    const anchor = startOfWeek(r.startDate);
    const len = 7 * r.interval;
    const k = Math.floor(diffDays(d, anchor) / len);
    const start = addDays(anchor, k * len);
    return { start, end: addDays(start, len - 1) };
  }
  const [y, m] = parts(d);
  const i = monthIndex(y, m);
  const p = i - mod(i - (r.anchorMonth - 1), r.interval);
  return monthPeriod(p, r.interval);
}

function monthPeriod(startIndex: number, n: number) {
  const [sy, sm] = fromMonthIndex(startIndex);
  const [ey, em] = fromMonthIndex(startIndex + n - 1);
  return { start: fromParts(sy, sm, 1), end: fromParts(ey, em, daysInMonth(ey, em)) };
}

export function periodKey(r: Pick<Recurrence, 'unit' | 'interval'>, start: ISODate): string {
  return `${r.unit === 'week' ? 'W' : 'M'}${r.interval}:${start}`;
}

/**
 * Every period of the schedule from the one containing its start date, up to and including the last period that
 * starts on or before `through` (and on or before the end date, if there is one).
 */
export function listPeriods(r: Recurrence, through: ISODate): Period[] {
  const out: Period[] = [];
  const last = r.endDate && r.endDate < through ? r.endDate : through;
  let { start, end } = periodContaining(r, r.startDate);
  while (start <= last && out.length < MAX_PERIODS) {
    out.push({ key: periodKey(r, start), start, end, due: dueDateFor(r.dueRule, start, end, r.holidays) });
    ({ start, end } = nextPeriod(r, start));
  }
  return out;
}

function nextPeriod(r: Recurrence, start: ISODate) {
  if (r.unit === 'week') {
    const s = addDays(start, 7 * r.interval);
    return { start: s, end: addDays(s, 7 * r.interval - 1) };
  }
  const [y, m] = parts(start);
  return monthPeriod(monthIndex(y, m) + r.interval, r.interval);
}

/** The next `count` periods whose due date is on or after `from`. */
export function upcomingPeriods(r: Recurrence, from: ISODate, count: number): Period[] {
  const out: Period[] = [];
  let { start, end } = periodContaining(r, r.startDate);
  let guard = 0;
  while (out.length < count && guard++ < MAX_PERIODS) {
    if (r.endDate && start > r.endDate) break;
    const due = dueDateFor(r.dueRule, start, end, r.holidays);
    if (due >= from) out.push({ key: periodKey(r, start), start, end, due });
    ({ start, end } = nextPeriod(r, start));
  }
  return out;
}

export function isPausedOn(due: ISODate, pauses: Pick<Pause, 'pausedFrom' | 'resumedOn'>[]): boolean {
  return pauses.some((p) => p.pausedFrom <= due && (p.resumedOn === null || due < p.resumedOn));
}

/** The date an occurrence is created: `leadDays` before it is due. */
export function createOn(due: ISODate, leadDays: number): ISODate {
  return addDays(due, -leadDays);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** A human name for a period: "March 2026", "Q3 2026", "FY 2025/26", "Week 11, 2026", "Jan–Feb 2026". */
export function periodLabel(key: string): string {
  const m = /^([MW])(\d+):(\d{4}-\d{2}-\d{2})$/.exec(key);
  if (!m) return key;
  const n = +m[2];
  const start = m[3];
  if (m[1] === 'W') {
    const a = isoWeek(start);
    if (n === 1) return `Week ${a.week}, ${a.year}`;
    const b = isoWeek(addDays(start, 7 * n - 1));
    return a.year === b.year ? `Weeks ${a.week}–${b.week}, ${a.year}` : `Week ${a.week}, ${a.year} – week ${b.week}, ${b.year}`;
  }
  const [y, mo] = parts(start);
  const [ey, em] = fromMonthIndex(monthIndex(y, mo) + n - 1);
  if (n === 1) return `${MONTHS_LONG[mo - 1]} ${y}`;
  if (n === 3 && (mo - 1) % 3 === 0) return `Q${(mo - 1) / 3 + 1} ${y}`;
  if (n === 12) return mo === 1 ? `${y}` : `FY ${y}/${String(ey).slice(2)}`;
  if (n === 6 && (mo === 1 || mo === 7)) return `${mo === 1 ? 'H1' : 'H2'} ${y}`;
  return y === ey ? `${MONTHS[mo - 1]}–${MONTHS[em - 1]} ${y}` : `${MONTHS[mo - 1]} ${y} – ${MONTHS[em - 1]} ${ey}`;
}

/** "Every month", "Every 2 months from January", "Every week". */
export function describeRecurrence(s: Pick<Schedule, 'frequency' | 'unit' | 'interval' | 'anchorMonth'>): string {
  if (s.frequency === 'weekly') return 'Weekly';
  if (s.frequency === 'monthly') return 'Monthly';
  if (s.frequency === 'quarterly') return s.anchorMonth % 3 === 1 ? 'Quarterly' : `Quarterly from ${MONTHS_LONG[s.anchorMonth - 1]}`;
  if (s.frequency === 'yearly') return s.anchorMonth === 1 ? 'Yearly' : `Yearly, year starts ${MONTHS_LONG[s.anchorMonth - 1]}`;
  if (s.unit === 'week') return s.interval === 1 ? 'Weekly' : `Every ${s.interval} weeks`;
  return s.interval === 1 ? 'Monthly' : `Every ${s.interval} months`;
}

const ORD = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function describeDueRule(rule: DueRule): string {
  const adj = rule.adjust === 'next_business_day' ? ', next business day if a weekend or holiday'
    : rule.adjust === 'previous_business_day' ? ', previous business day if a weekend or holiday' : '';
  switch (rule.kind) {
    case 'month_offset': {
      const day = rule.day === 'last' ? 'Last day' : `${ORD(rule.day)}`;
      const which = rule.from === 'end'
        ? rule.months === 0 ? 'of the period’s last month' : rule.months === 1 ? 'of the month after the period' : `${rule.months} months after the period ends`
        : rule.months === 0 ? 'of the period’s first month' : `of the month ${rule.months} month${rule.months === 1 ? '' : 's'} after the period starts`;
      return `${day} ${which}${adj}`;
    }
    case 'days_after_end':
      return `${rule.days} day${rule.days === 1 ? '' : 's'} after the period ends${adj}`;
    case 'weekday':
      return `${WEEKDAYS[rule.weekday - 1]}${adj}`;
  }
}

/** The due-date rule in a few words, for tables: "15th, month after", "31st, 5 months after", "Friday". */
export function shortDueRule(rule: DueRule): string {
  const wk = rule.adjust && rule.adjust !== 'none' ? ' (weekday)' : '';
  switch (rule.kind) {
    case 'month_offset': {
      const day = rule.day === 'last' ? 'Last day' : ORD(rule.day);
      if (rule.from === 'end') return `${day}, ${rule.months === 0 ? 'last month' : rule.months === 1 ? 'month after' : `${rule.months} months after`}${wk}`;
      return `${day}, ${rule.months === 0 ? 'first month' : `${rule.months} months in`}${wk}`;
    }
    case 'days_after_end':
      return `${rule.days} days after${wk}`;
    case 'weekday':
      return `${WEEKDAYS[rule.weekday - 1]}${wk}`;
  }
}
