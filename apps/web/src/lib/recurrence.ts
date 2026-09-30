import type { RepeatRule } from './types';

export const REPEAT_RULES: RepeatRule[] = ['daily', 'weekly', 'monthly', 'yearly'];
export const isRepeatRule = (v: unknown): v is RepeatRule => typeof v === 'string' && (REPEAT_RULES as string[]).includes(v);

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s: string) => new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));

/** One step of a repeat rule from a date (month and year steps clamp to the end of a short month, like the database does). */
export function stepDate(dateISO: string, rule: RepeatRule): string {
  const d = parse(dateISO);
  if (rule === 'daily') d.setDate(d.getDate() + 1);
  else if (rule === 'weekly') d.setDate(d.getDate() + 7);
  else {
    const day = d.getDate();
    d.setDate(1);
    if (rule === 'monthly') d.setMonth(d.getMonth() + 1); else d.setFullYear(d.getFullYear() + 1);
    d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  }
  return iso(d);
}

/** The date the next occurrence gets after ticking off: the first step that is still in the future (matches complete_memory in SQL). */
export function nextOccurrence(dueISO: string, rule: RepeatRule, todayISO: string): string {
  let d = dueISO;
  do d = stepDate(d, rule); while (d <= todayISO);
  return d;
}
