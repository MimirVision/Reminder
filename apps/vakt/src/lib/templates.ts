// Shift types with their own times on some days: "Natt" may be 21:45–07:45 on weekdays but 21:30–08:15 from Friday to
// Saturday. Every place that turns a shift type into a shift asks here which times apply on that date.
import { weekday, type ISODate } from './dates';
import { isHoliday } from './holidays';
import type { Shift, ShiftTemplate, TemplateDay, Times } from './types';

export const TEMPLATE_DAYS: TemplateDay[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun', 'holiday'];
const KEYS: TemplateDay[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const NAMES: Record<TemplateDay, string> = { mon: 'mandag', tue: 'tirsdag', wed: 'onsdag', thu: 'torsdag', fri: 'fredag', sat: 'lørdag', sun: 'søndag', holiday: 'helligdag' };
const SHORT: Record<TemplateDay, string> = { mon: 'man', tue: 'tir', wed: 'ons', thu: 'tor', fri: 'fre', sat: 'lør', sun: 'søn', holiday: 'helligdag' };

/** Which of a template's day settings counts on a date: a public holiday first, then the weekday. */
export function templateDay(t: Pick<ShiftTemplate, 'days'>, date: ISODate): TemplateDay | null {
  if (t.days?.holiday && isHoliday(date)) return 'holiday';
  const k = KEYS[weekday(date) - 1];
  return t.days?.[k] ? k : null;
}

/** The times a shift type has on a date. */
export function timesFor(t: ShiftTemplate, date: ISODate): Times {
  const day = templateDay(t, date);
  const x = day ? t.days![day]! : t;
  return { start_time: x.start_time, end_time: x.end_time, break_minutes: x.break_minutes };
}

export const sameTimes = (a: Pick<Times, 'start_time' | 'end_time'>, b: Pick<Times, 'start_time' | 'end_time'>) =>
  a.start_time === b.start_time && a.end_time === b.end_time;

/** The shift type a shift was made from, judged by its times on its date. */
export function templateOf(templates: ShiftTemplate[], s: Pick<Shift, 'date' | 'start_time' | 'end_time'>): ShiftTemplate | undefined {
  return templates.find((t) => sameTimes(timesFor(t, s.date), s));
}

/** "fredag → lørdag" for a night that runs past midnight, else "fredag". */
export function dayLabel(day: TemplateDay, overnight: boolean, short = false): string {
  const names = short ? SHORT : NAMES;
  if (day === 'holiday') return short ? 'helligdag' : 'helligdager';
  const next = KEYS[(KEYS.indexOf(day) + 1) % 7];
  return overnight ? `${names[day]} → ${names[next]}` : names[day];
}

export const overnight = (x: Pick<Times, 'start_time' | 'end_time'>) => x.end_time <= x.start_time;
