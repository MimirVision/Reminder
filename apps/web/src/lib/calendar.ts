// A month grid for the phone app's own date picker (weeks start on Monday). Pure, unit tested.
import { addDays, isoDate, parseISODate } from './when.ts';

export type Cell = { iso: string; day: number; inMonth: boolean };

/** The weeks (arrays of 7 cells) that cover a month, Monday first. `month` is 1-12. */
export function monthGrid(year: number, month: number): Cell[][] {
  const first = new Date(year, month - 1, 1);
  const lead = (first.getDay() + 6) % 7;
  const start = addDays(isoDate(first), -lead);
  const weeks: Cell[][] = [];
  let cur = start;
  do {
    const week: Cell[] = [];
    for (let i = 0; i < 7; i++) {
      const d = parseISODate(cur);
      week.push({ iso: cur, day: d.getDate(), inMonth: d.getMonth() === month - 1 });
      cur = addDays(cur, 1);
    }
    weeks.push(week);
  } while (parseISODate(cur).getMonth() === month - 1);
  return weeks;
}

export const shiftMonth = (year: number, month: number, by: number): { year: number; month: number } => {
  const d = new Date(year, month - 1 + by, 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
};
