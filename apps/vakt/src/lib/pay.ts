// What a shift pays: the hourly wage for the paid hours, every supplement whose window the shift overlaps, and overtime.
// Pure functions, so the same numbers show everywhere and are easy to test.
import { addDays, monthOf, toMinutes, weekday, type ISODate, type MonthKey } from './dates';
import { isHoliday, isHolidayEve } from './holidays';
import { WEEKDAYS, type DayKey, type Employer, type Setup, type Shift, type Supplement, type Wage } from './types';

export interface SupplementPay { id: string; name: string; color: string; hours: number; amount: number }
export interface ShiftPay {
  /** Clock hours from start to end. */
  hours: number;
  /** Hours after the unpaid break. */
  paidHours: number;
  wage: number;
  base: number;
  overtime: number;
  supplements: SupplementPay[];
  supplementTotal: number;
  total: number;
}

/** The shift as minutes from midnight on its date; the end is past 1440 for a shift that runs into the next day. */
export function shiftSpan(s: Pick<Shift, 'start_time' | 'end_time'>): { start: number; end: number } | null {
  const start = toMinutes(s.start_time), end = toMinutes(s.end_time);
  if (start === null || end === null) return null;
  return { start, end: end <= start ? end + 1440 : end };
}

export function dayKeys(d: ISODate): Set<DayKey> {
  const keys = new Set<DayKey>([WEEKDAYS[weekday(d) - 1]]);
  if (isHoliday(d)) keys.add('holiday');
  if (isHolidayEve(d)) keys.add('holiday_eve');
  return keys;
}

export const appliesOn = (sup: Pick<Supplement, 'days'>, d: ISODate) => {
  const keys = dayKeys(d);
  return sup.days.some((k) => keys.has(k));
};

/** Minutes of the shift inside the supplement's window. A window belongs to the day it starts on, so a Friday night
 *  window 21:00–06:00 covers Saturday 00:00–06:00 too, and a shift from Thursday evening is checked against Thursday,
 *  Friday (after midnight) and, for long shifts, the day after. */
export function overlapMinutes(shift: Shift, sup: Supplement): number {
  const span = shiftSpan(shift);
  const ws = toMinutes(sup.start_time), we = toMinutes(sup.end_time);
  if (!span || ws === null || we === null) return 0;
  const length = we === ws ? 1440 : we > ws ? we - ws : we + 1440 - ws;
  let total = 0;
  for (let day = -1; day <= 1; day++) {
    if (!appliesOn(sup, addDays(shift.date, day))) continue;
    const from = day * 1440 + ws, to = from + length;
    total += Math.max(0, Math.min(to, span.end) - Math.max(from, span.start));
  }
  return Math.min(total, span.end - span.start);
}

/** The hourly wage on a date: the newest one that has started, or the earliest if the date is before all of them. */
export function wageOn(wages: Wage[], d: ISODate): number {
  if (wages.length === 0) return 0;
  const sorted = [...wages].sort((a, b) => a.from.localeCompare(b.from));
  let w = sorted[0];
  for (const x of sorted) if (x.from <= d) w = x;
  return w.hourly;
}

export function calcShift(shift: Shift, supplements: Supplement[], wages: Wage[]): ShiftPay {
  const span = shiftSpan(shift);
  const wage = wageOn(wages, shift.date);
  const minutes = span ? span.end - span.start : 0;
  const paidMinutes = Math.max(0, minutes - Math.max(0, shift.break_minutes || 0));
  // The break is unpaid but its time of day isn't recorded, so each supplement loses the same share of its hours.
  const paidShare = minutes > 0 ? paidMinutes / minutes : 0;
  const paidHours = paidMinutes / 60;

  const pays: SupplementPay[] = [];
  for (const sup of supplements) {
    if (!sup.active) continue;
    const overlap = overlapMinutes(shift, sup);
    if (overlap <= 0) continue;
    const hours = (overlap / 60) * paidShare;
    let amount: number;
    if (sup.amount_type === 'kr_per_shift') amount = sup.amount;
    else if (sup.amount_type === 'kr_per_hour') amount = hours * sup.amount;
    else amount = hours * Math.max((wage * sup.amount) / 100, sup.min_per_hour ?? 0);
    if (amount > 0) pays.push({ id: sup.id, name: sup.name, color: sup.color, hours, amount });
  }

  const base = paidHours * wage;
  const overtime = paidHours * wage * (Math.max(0, shift.overtime_percent || 0) / 100);
  const supplementTotal = pays.reduce((s, p) => s + p.amount, 0);
  return { hours: minutes / 60, paidHours, wage, base, overtime, supplements: pays, supplementTotal, total: base + overtime + supplementTotal };
}

/** The employer a shift is for; shifts from before employers existed count as the first one. */
export function employerOf(shift: Pick<Shift, 'employer_id'>, employers: Employer[]): Employer | undefined {
  return employers.find((e) => e.id === shift.employer_id) ?? employers[0];
}

/** A shift's pay with its own employer's wage and supplements. */
export function payOf(shift: Shift, setup: Setup): ShiftPay {
  const emp = employerOf(shift, setup.employers);
  if (!emp) return calcShift(shift, [], []);
  return calcShift(shift, setup.supplements.filter((x) => x.employer_id === emp.id), emp.wages);
}

export interface Summary {
  count: number;
  hours: number;
  base: number;
  overtime: number;
  supplementTotal: number;
  total: number;
  /** Per supplement, largest first. Supplements with the same name at different employers are added together. */
  bySupplement: SupplementPay[];
  /** Total per employer id. */
  byEmployer: Map<string, number>;
}

export function summarize(shifts: Shift[], setup: Setup): Summary {
  const by = new Map<string, SupplementPay>();
  const sum: Summary = { count: 0, hours: 0, base: 0, overtime: 0, supplementTotal: 0, total: 0, bySupplement: [], byEmployer: new Map() };
  for (const s of shifts) {
    const p = payOf(s, setup);
    sum.count++;
    sum.hours += p.paidHours;
    sum.base += p.base;
    sum.overtime += p.overtime;
    sum.supplementTotal += p.supplementTotal;
    sum.total += p.total;
    const emp = employerOf(s, setup.employers);
    if (emp) sum.byEmployer.set(emp.id, (sum.byEmployer.get(emp.id) ?? 0) + p.total);
    for (const x of p.supplements) {
      const key = x.name.trim().toLowerCase();
      const acc = by.get(key) ?? { ...x, hours: 0, amount: 0 };
      acc.hours += x.hours;
      acc.amount += x.amount;
      by.set(key, acc);
    }
  }
  sum.bySupplement = [...by.values()].sort((a, b) => b.amount - a.amount);
  return sum;
}

/** The target employer with the source's wages, shift types and supplements: copies with new ids, so changing
 *  one employer later never changes the other. The target keeps its own name and colour. */
export function copySetup(source: Employer, supplements: Supplement[], target: Employer, newId: () => string): { employer: Employer; supplements: Supplement[] } {
  return {
    employer: {
      ...target,
      wages: source.wages.map((w) => ({ ...w })),
      templates: source.templates.map((t) => ({ ...t, id: newId() })),
    },
    supplements: supplements.filter((x) => x.employer_id === source.id).map((x) => ({ ...x, days: [...x.days], id: newId(), employer_id: target.id })),
  };
}

/** When a shift is over, as a local Date: worked shifts count as earned, the rest as planned. */
export function shiftEnd(s: Shift): Date {
  const span = shiftSpan(s);
  const [y, m, d] = s.date.split('-').map(Number);
  return new Date(y, m - 1, d, 0, span ? span.end : 1440);
}

export const inMonth = (shifts: Shift[], m: MonthKey) => shifts.filter((s) => monthOf(s.date) === m);

/** Dag, Kveld or Natt from the times alone, for a label on each shift. */
export function shiftKind(s: Pick<Shift, 'start_time' | 'end_time'>): 'Dag' | 'Kveld' | 'Natt' {
  const span = shiftSpan(s);
  if (!span) return 'Dag';
  if (span.end > 1440 + 120 || span.start >= 20 * 60) return 'Natt';
  if (span.start >= 12 * 60) return 'Kveld';
  return 'Dag';
}
