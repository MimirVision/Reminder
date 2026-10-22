// Plain calendar dates ('2026-10-22') and clock times ('07:30'). A shift is wall-clock time where she works, so no time
// zones are involved: a date never shifts, and the night a clock changes counts as the hours on the roster.
export type ISODate = string;

const pad = (n: number) => String(n).padStart(2, '0');

export const fromParts = (y: number, m: number, d: number): ISODate => `${y}-${pad(m)}-${pad(d)}`;
export const parts = (d: ISODate): [number, number, number] => d.split('-').map(Number) as [number, number, number];

export function toISO(date: Date): ISODate {
  return fromParts(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

export const today = (): ISODate => toISO(new Date());

const utc = (d: ISODate) => { const [y, m, day] = parts(d); return Date.UTC(y, m - 1, day); };

export function addDays(d: ISODate, n: number): ISODate {
  const t = new Date(utc(d) + n * 86_400_000);
  return fromParts(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export const diffDays = (a: ISODate, b: ISODate) => Math.round((utc(a) - utc(b)) / 86_400_000);

/** 1 = Monday … 7 = Sunday. */
export function weekday(d: ISODate): number {
  const w = new Date(utc(d)).getUTCDay();
  return w === 0 ? 7 : w;
}

/** '2026-10' */
export type MonthKey = string;
export const monthOf = (d: ISODate): MonthKey => d.slice(0, 7);
export const firstOfMonth = (m: MonthKey): ISODate => `${m}-01`;
export function addMonths(m: MonthKey, n: number): MonthKey {
  const [y, mo] = m.split('-').map(Number);
  const i = y * 12 + (mo - 1) + n;
  return `${Math.floor(i / 12)}-${pad((i % 12) + 1)}`;
}
export function daysInMonth(m: MonthKey): number {
  const [y, mo] = m.split('-').map(Number);
  return new Date(Date.UTC(y, mo, 0)).getUTCDate();
}
export const lastOfMonth = (m: MonthKey): ISODate => `${m}-${pad(daysInMonth(m))}`;

/** ISO week number, as on Norwegian calendars. */
export function isoWeek(d: ISODate): number {
  const thursday = addDays(d, 4 - weekday(d));
  const jan1 = `${thursday.slice(0, 4)}-01-01`;
  return Math.floor(diffDays(thursday, jan1) / 7) + 1;
}

/** '07:30' → 450. Accepts '7:30' and '0730' too. */
export function toMinutes(t: string): number | null {
  const m = /^(\d{1,2}):?(\d{2})$/.exec(t.trim());
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min > 0)) return null;
  return h * 60 + min;
}

export const fromMinutes = (n: number): string => `${pad(Math.floor(n / 60) % 24)}:${pad(n % 60)}`;
