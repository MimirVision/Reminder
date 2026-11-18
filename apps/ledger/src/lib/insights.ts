// The numbers behind Home's charts: workload by week, deadlines per day, the month's pace, on-time rate, the mix of
// open work by type, and the busiest clients. Pure functions of the tasks and today, so each is tested.
import { addDays, diffDays, localISODate, startOfMonth, endOfMonth, startOfWeek, type ISODate } from './dates';
import { isOpen, type Occurrence, type TaskType } from './types';

/** Task types in five chart colours plus Other. Eight separate colours would be too many to tell apart. */
export type TypeGroup = 'bookkeeping' | 'vat' | 'payroll' | 'reporting' | 'yearEnd' | 'other';
export const GROUPS: TypeGroup[] = ['bookkeeping', 'vat', 'payroll', 'reporting', 'yearEnd', 'other'];
export const GROUP_LABEL: Record<TypeGroup, string> = {
  bookkeeping: 'Bookkeeping', vat: 'VAT', payroll: 'Payroll', reporting: 'Reporting', yearEnd: 'Year-end & tax', other: 'Other',
};
export const groupOf = (t: TaskType): TypeGroup =>
  t === 'annual' || t === 'tax' ? 'yearEnd' : t === 'follow_up' || t === 'other' ? 'other' : t;

const emptyCounts = (): Record<TypeGroup, number> => ({ bookkeeping: 0, vat: 0, payroll: 0, reporting: 0, yearEnd: 0, other: 0 });
const doneOn = (o: Occurrence) => (o.completedAt ? localISODate(new Date(o.completedAt)) : null);

export interface WeekLoad { start: ISODate; counts: Record<TypeGroup, number>; total: number; overdue: number }
/**
 * Open work due in each of the next `weeks` weeks, by type. Overdue work is counted into this week, since that is
 * when it has to be done, and also reported on its own.
 */
export function weeklyLoad(tasks: Occurrence[], today: ISODate, weeks: number): WeekLoad[] {
  const first = startOfWeek(today);
  const out: WeekLoad[] = Array.from({ length: weeks }, (_, i) => ({ start: addDays(first, i * 7), counts: emptyCounts(), total: 0, overdue: 0 }));
  for (const o of tasks) {
    if (!isOpen(o.status)) continue;
    const i = o.dueDate < today ? 0 : Math.floor(diffDays(o.dueDate, first) / 7);
    if (i < 0 || i >= weeks) continue;
    out[i].counts[groupOf(o.taskType)]++;
    out[i].total++;
    if (o.dueDate < today) out[i].overdue++;
  }
  return out;
}

export interface DayDue { date: ISODate; due: number; done: number; open: number }
/** Tasks due on each day from `from` to `to` (cancelled ones left out), and how many of them are done. */
export function dueByDay(tasks: Occurrence[], from: ISODate, to: ISODate): Map<ISODate, DayDue> {
  const out = new Map<ISODate, DayDue>();
  for (const o of tasks) {
    if (o.status === 'cancelled' || o.dueDate < from || o.dueDate > to) continue;
    const d = out.get(o.dueDate) ?? { date: o.dueDate, due: 0, done: 0, open: 0 };
    d.due++;
    if (o.status === 'done') d.done++; else d.open++;
    out.set(o.dueDate, d);
  }
  return out;
}

export interface PaceDay { date: ISODate; due: number; done: number | null }
/**
 * This month, day by day: how many of the month's tasks were due by then, and how many of them were done by then.
 * Days after today have no "done" (null): the line stops at today.
 */
export function monthPace(tasks: Occurrence[], today: ISODate): { days: PaceDay[]; total: number; doneNow: number } {
  const first = startOfMonth(today), last = endOfMonth(today);
  const month = tasks.filter((o) => o.status !== 'cancelled' && o.dueDate >= first && o.dueDate <= last);
  const days: PaceDay[] = [];
  for (let d = first; d <= last; d = addDays(d, 1)) {
    days.push({
      date: d,
      due: month.filter((o) => o.dueDate <= d).length,
      done: d <= today ? month.filter((o) => o.status === 'done' && (doneOn(o) ?? '9999') <= d).length : null,
    });
  }
  return { days, total: month.length, doneNow: month.filter((o) => o.status === 'done').length };
}

export interface OnTime { rate: number | null; previous: number | null; finished: number; weekly: (number | null)[] }
/**
 * Share of tasks finished on or before their due date: over the last 90 days, the 90 before that, and per week for
 * the last 12 weeks (null for a week with nothing finished).
 */
export function onTimeRate(tasks: Occurrence[], today: ISODate): OnTime {
  const done = tasks.filter((o) => o.status === 'done' && o.completedAt).map((o) => ({ on: doneOn(o)!, ok: doneOn(o)! <= o.dueDate }));
  const share = (list: typeof done) => (list.length ? list.filter((x) => x.ok).length / list.length : null);
  const last = done.filter((x) => x.on > addDays(today, -90) && x.on <= today);
  const prev = done.filter((x) => x.on > addDays(today, -180) && x.on <= addDays(today, -90));
  const first = addDays(startOfWeek(today), -11 * 7);
  const weekly = Array.from({ length: 12 }, (_, i) => share(done.filter((x) => x.on >= addDays(first, i * 7) && x.on < addDays(first, i * 7 + 7))));
  return { rate: share(last), previous: share(prev), finished: last.length, weekly };
}

export interface TypeMix { group: TypeGroup; open: number; overdue: number }
/** Open work by type group, largest first (Other always last). */
export function typeMix(tasks: Occurrence[], today: ISODate): TypeMix[] {
  const m = new Map<TypeGroup, TypeMix>(GROUPS.map((g) => [g, { group: g, open: 0, overdue: 0 }]));
  for (const o of tasks) {
    if (!isOpen(o.status)) continue;
    const r = m.get(groupOf(o.taskType))!;
    r.open++;
    if (o.dueDate < today) r.overdue++;
  }
  return [...m.values()].filter((r) => r.open > 0).sort((a, b) => (a.group === 'other' ? 1 : b.group === 'other' ? -1 : b.open - a.open));
}

export interface ClientLoad { clientId: string; open: number; overdue: number; soon: number; next: ISODate | null }
/** Clients by open work in the next `days` days (overdue included), busiest first. */
export function clientLoad(tasks: Occurrence[], today: ISODate, days = 30): ClientLoad[] {
  const until = addDays(today, days);
  const m = new Map<string, ClientLoad>();
  for (const o of tasks) {
    if (!isOpen(o.status) || o.dueDate > until) continue;
    const r = m.get(o.clientId) ?? { clientId: o.clientId, open: 0, overdue: 0, soon: 0, next: null };
    r.open++;
    if (o.dueDate < today) r.overdue++; else { r.soon++; if (!r.next || o.dueDate < r.next) r.next = o.dueDate; }
    m.set(o.clientId, r);
  }
  return [...m.values()].sort((a, b) => b.open - a.open || b.overdue - a.overdue || a.clientId.localeCompare(b.clientId));
}

/** Rounds an axis maximum up to a clean number in up to 5 steps: 7 → 8 (step 2), 23 → 25 (step 5). */
export function niceMax(max: number): { max: number; step: number } {
  if (max <= 0) return { max: 4, step: 1 };
  const raw = max / 5;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((s) => s * pow).find((s) => s >= raw && Number.isInteger(s)) ?? Math.ceil(raw);
  return { max: Math.ceil(max / step) * step, step };
}
