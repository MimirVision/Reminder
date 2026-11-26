import type { Memory } from './types.ts';
import { addDays } from './when.ts';

/** The numbers across the top of the overview. */
export type Stats = { open: number; late: number; today: number; next7: number; noDate: number };

export function overviewStats(open: Pick<Memory, 'due_on'>[], today: string): Stats {
  const end = addDays(today, 7);
  let late = 0; let t = 0; let next7 = 0; let noDate = 0;
  for (const m of open) {
    if (!m.due_on) noDate++;
    else if (m.due_on < today) late++;
    else if (m.due_on === today) t++;
    else if (m.due_on <= end) next7++;
  }
  return { open: open.length, late, today: t, next7, noDate };
}

/** How much of today's load is behind you: finished today out of finished + still open today (late things count as today's load). 1 when there is nothing. */
export function dayProgress(doneToday: number, stats: Pick<Stats, 'late' | 'today'>): number {
  const total = doneToday + stats.late + stats.today;
  return total === 0 ? 1 : doneToday / total;
}

/** ISO 8601 week number (weeks start on Monday; week 1 holds the first Thursday of the year). */
export function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = Date.UTC(t.getUTCFullYear(), 0, 1);
  return Math.ceil(((t.getTime() - y0) / 86_400_000 + 1) / 7);
}

export type Part = 'morning' | 'afternoon' | 'evening' | 'night';
export const partOfDay = (hour: number): Part => (hour >= 5 && hour < 12 ? 'morning' : hour >= 12 && hour < 18 ? 'afternoon' : hour >= 18 && hour < 23 ? 'evening' : 'night');

export type Sky = 'clear' | 'partly' | 'cloud' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'storm';
/** WMO weather code (as Open-Meteo gives it) to a simple kind of sky, with a glyph to show. */
export function skyOf(code: number): { kind: Sky; glyph: string } {
  if (code === 0) return { kind: 'clear', glyph: '☀️' };
  if (code <= 2) return { kind: 'partly', glyph: '🌤️' };
  if (code === 3) return { kind: 'cloud', glyph: '☁️' };
  if (code === 45 || code === 48) return { kind: 'fog', glyph: '🌫️' };
  if (code >= 51 && code <= 57) return { kind: 'drizzle', glyph: '🌦️' };
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return { kind: 'rain', glyph: '🌧️' };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { kind: 'snow', glyph: '🌨️' };
  if (code >= 95) return { kind: 'storm', glyph: '⛈️' };
  return { kind: 'cloud', glyph: '☁️' };
}

/** "5 min ago" style, in the shortest form the caller can translate: returns the unit and count. */
export function agoParts(iso: string, now = Date.now()): { unit: 'now' | 'min' | 'hour' | 'day'; n: number } {
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return { unit: 'now', n: 0 };
  if (mins < 60) return { unit: 'min', n: mins };
  const hours = Math.round(mins / 60);
  return hours < 24 ? { unit: 'hour', n: hours } : { unit: 'day', n: Math.round(hours / 24) };
}
