// A month as a grid of weeks (Monday first, as in Norway): the date picker in the shift sheet and the calendar on Vakter.
import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { addDays, addMonths, daysInMonth, firstOfMonth, weekday, type ISODate, type MonthKey } from '../lib/dates';
import { monthName } from '../lib/format';

const HEAD = ['M', 'T', 'O', 'T', 'F', 'L', 'S'];

/** The days of the month, padded with nulls so the first lands on its weekday. */
export function monthCells(month: MonthKey): (ISODate | null)[] {
  const first = firstOfMonth(month);
  const cells: (ISODate | null)[] = Array(weekday(first) - 1).fill(null);
  for (let i = 0; i < daysInMonth(month); i++) cells.push(addDays(first, i));
  while (cells.length % 7) cells.push(null);
  return cells;
}

export function CalendarGrid({ month, renderDay, gap = 'gap-1' }: { month: MonthKey; renderDay: (d: ISODate) => ReactNode; gap?: string }) {
  return (
    <div>
      <div className="mb-1 grid grid-cols-7 text-center text-[11px] font-semibold text-ink-3">
        {HEAD.map((h, i) => <span key={i} className={i > 4 ? 'text-rose/80' : undefined}>{h}</span>)}
      </div>
      <div className={`grid grid-cols-7 ${gap}`}>
        {monthCells(month).map((d, i) => d ? <div key={d}>{renderDay(d)}</div> : <div key={`x${i}`} />)}
      </div>
    </div>
  );
}

export function MonthNav({ month, setMonth, withYear }: { month: MonthKey; setMonth: (m: MonthKey) => void; withYear?: boolean }) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <button type="button" aria-label="Forrige måned" onClick={() => setMonth(addMonths(month, -1))} className="grid size-9 place-items-center rounded-full text-ink-2 active:bg-sunken"><ChevronLeft className="size-5" /></button>
      <span className="text-[15px] font-bold">{monthName(month, withYear)}</span>
      <button type="button" aria-label="Neste måned" onClick={() => setMonth(addMonths(month, 1))} className="grid size-9 place-items-center rounded-full text-ink-2 active:bg-sunken"><ChevronRight className="size-5" /></button>
    </div>
  );
}
