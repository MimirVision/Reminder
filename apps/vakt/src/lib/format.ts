import { diffDays, parts, weekday, type ISODate, type MonthKey } from './dates';

const krFmt = new Intl.NumberFormat('nb-NO', { maximumFractionDigits: 0 });
/** '12 345 kr' */
export const kr = (n: number) => `${krFmt.format(Math.round(n))} kr`;
export const num = (n: number) => krFmt.format(Math.round(n));

/** '7,5 t' */
export const hrs = (n: number) => `${n.toLocaleString('nb-NO', { maximumFractionDigits: 2 })} t`;

export const MONTHS = ['januar', 'februar', 'mars', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'desember'];
export const WEEKDAY_SHORT = ['man', 'tir', 'ons', 'tor', 'fre', 'lør', 'søn'];
export const WEEKDAY_LONG = ['mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag', 'søndag'];

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** 'Oktober' or 'Oktober 2025' outside the current year. */
export function monthName(m: MonthKey, withYear = false): string {
  const [y, mo] = m.split('-').map(Number);
  return cap(MONTHS[mo - 1]) + (withYear ? ` ${y}` : '');
}

/** 'tirsdag 21. oktober' */
export function longDate(d: ISODate): string {
  const [, m, day] = parts(d);
  return `${WEEKDAY_LONG[weekday(d) - 1]} ${day}. ${MONTHS[m - 1]}`;
}

/** 'I dag', 'I morgen', 'I går' or 'tir 21. okt' */
export function relDate(d: ISODate, today: ISODate): string {
  const [, m, day] = parts(d);
  const diff = diffDays(d, today);
  if (diff === 0) return 'I dag';
  if (diff === 1) return 'I morgen';
  if (diff === -1) return 'I går';
  return `${cap(WEEKDAY_SHORT[weekday(d) - 1])} ${day}. ${MONTHS[m - 1].slice(0, 3)}`;
}
