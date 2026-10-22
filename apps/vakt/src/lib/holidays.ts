// Norwegian public holidays (helligdager), so holiday supplements apply on the right days.
import { addDays, diffDays, fromParts, parts, type ISODate } from './dates';

/** Easter Sunday in the Gregorian calendar (the anonymous algorithm). */
export function easter(y: number): ISODate {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const n = h + l - 7 * m + 114;
  return fromParts(y, Math.floor(n / 31), (n % 31) + 1);
}

const FIXED: Record<string, string> = {
  '01-01': '1. nyttårsdag', '05-01': '1. mai', '05-17': '17. mai', '12-25': '1. juledag', '12-26': '2. juledag',
};
const FROM_EASTER: Record<number, string> = {
  [-3]: 'Skjærtorsdag', [-2]: 'Langfredag', 0: '1. påskedag', 1: '2. påskedag',
  39: 'Kristi himmelfartsdag', 49: '1. pinsedag', 50: '2. pinsedag',
};

export function holidayName(d: ISODate): string | null {
  return FIXED[d.slice(5)] ?? FROM_EASTER[diffDays(d, easter(parts(d)[0]))] ?? null;
}

export const isHoliday = (d: ISODate) => holidayName(d) !== null;

/** The day before a holiday that is not a holiday itself: julaften, nyttårsaften, påskeaften, pinseaften, onsdag før skjærtorsdag … */
export const isHolidayEve = (d: ISODate) => !isHoliday(d) && isHoliday(addDays(d, 1));

const EVE_NAMES: Record<string, string> = { '12-24': 'Julaften', '12-31': 'Nyttårsaften' };

export function eveName(d: ISODate): string | null {
  if (!isHolidayEve(d)) return null;
  if (EVE_NAMES[d.slice(5)]) return EVE_NAMES[d.slice(5)];
  const next = holidayName(addDays(d, 1))!;
  if (next === '1. påskedag') return 'Påskeaften';
  if (next === '1. pinsedag') return 'Pinseaften';
  return `Dagen før ${next.toLowerCase()}`;
}
