// The yearly pay settlement (lønnsoppgjør). In health care the new hourly wage usually applies from 1 May and is
// known by early summer. From June on, until she has a wage from this spring or answered, the app asks once a year.
import type { ISODate } from './dates';
import type { Employer } from './types';

export function wageCheckDue(employers: Employer[], today: ISODate, checkedYear: number | null): number | null {
  const year = Number(today.slice(0, 4));
  if (today < `${year}-06-01` || checkedYear === year || employers.length === 0) return null;
  const updated = employers.every((e) => e.wages.some((w) => w.from >= `${year}-04-01`));
  return updated ? null : year;
}
