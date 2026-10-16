import { diffDays, parts, type ISODate } from './dates';

let locale = 'en-GB';
export function setLocale(l: string) {
  try { new Intl.DateTimeFormat(l); locale = l; } catch { /* keep the previous locale */ }
}
export const getLocale = () => locale;

const cache = new Map<string, Intl.DateTimeFormat>();
function fmt(opts: Intl.DateTimeFormatOptions) {
  const k = locale + JSON.stringify(opts);
  let f = cache.get(k);
  if (!f) cache.set(k, (f = new Intl.DateTimeFormat(locale, { ...opts, timeZone: 'UTC' })));
  return f;
}
const asUTC = (d: ISODate) => { const [y, m, day] = parts(d); return new Date(Date.UTC(y, m - 1, day)); };

/** 16 Oct 2026 */
export const formatDate = (d: ISODate) => fmt({ day: 'numeric', month: 'short', year: 'numeric' }).format(asUTC(d));
/** Fri 16 Oct */
export const formatDayShort = (d: ISODate) => fmt({ weekday: 'short', day: 'numeric', month: 'short' }).format(asUTC(d));
/** Friday 16 October 2026 */
export const formatDayLong = (d: ISODate) => fmt({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(asUTC(d));
/** October 2026 */
export const formatMonth = (d: ISODate) => fmt({ month: 'long', year: 'numeric' }).format(asUTC(d));
export const formatWeekdayShort = (d: ISODate) => fmt({ weekday: 'short' }).format(asUTC(d));

/** A due date the way a list wants it: "Today", "Tomorrow", "Yesterday", "Mon 19 Oct", or "3 Feb 2027" for other years. */
export function formatDue(d: ISODate, today: ISODate): string {
  const n = diffDays(d, today);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  if (parts(d)[0] !== parts(today)[0]) return formatDate(d);
  return formatDayShort(d);
}

/** "3 days overdue", "in 5 days", "due today". */
export function relativeDue(d: ISODate, today: ISODate): string {
  const n = diffDays(d, today);
  if (n === 0) return 'due today';
  if (n < 0) return `${-n} day${n === -1 ? '' : 's'} overdue`;
  return `in ${n} day${n === 1 ? '' : 's'}`;
}

export function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(d);
}

export const formatCount = (n: number) => new Intl.NumberFormat(locale).format(n);

export function greeting(now = new Date()): string {
  const h = now.getHours();
  return h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}
