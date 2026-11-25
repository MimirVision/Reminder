// The year at a glance: twelve small months, each day darker the more is due on it, overdue days marked. For seeing
// the busy weeks long before they arrive (VAT terms, year-end). A day opens that day; a month's name opens the month.
import { useState } from 'react';
import { useStore } from '../../data/store';
import { monthGrid, parts, type ISODate } from '../../lib/dates';
import { formatDayLong } from '../../lib/format';
import { holidayName } from '../../lib/holidays';
import { isOpen, type Occurrence } from '../../lib/types';
import { cn } from '../../ui/cn';

const monthName = (y: number, m: number) => new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 15)));
const OPACITY = [0, 0.2, 0.42, 0.68, 1];

export function YearView({ year, today, byDay, openDay, openMonth }: {
  year: number; today: ISODate; byDay: Map<ISODate, Occurrence[]>; openDay: (d: ISODate) => void; openMonth: (d: ISODate) => void;
}) {
  const { calendar } = useStore();
  const [hover, setHover] = useState<ISODate | null>(null);
  const counts = [...byDay.values()].map((l) => l.length);
  const max = Math.max(1, ...counts);
  const level = (n: number) => (n === 0 ? 0 : n <= max * 0.25 ? 1 : n <= max * 0.5 ? 2 : n <= max * 0.75 ? 3 : 4);
  const h = hover ? byDay.get(hover) ?? [] : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 min-[2400px]:grid-cols-6">
        {Array.from({ length: 12 }, (_, i) => {
          const m = i + 1;
          const first = `${year}-${String(m).padStart(2, '0')}-01`;
          const cells = monthGrid(first);
          const inMonth = cells.filter((d) => parts(d)[1] === m);
          const all = inMonth.flatMap((d) => byDay.get(d) ?? []);
          const open = all.filter((o) => isOpen(o.status)).length;
          const late = all.filter((o) => isOpen(o.status) && o.dueDate < today).length;
          const current = parts(today)[0] === year && parts(today)[1] === m;
          return (
            <section key={m} aria-label={monthName(year, m)} className={cn('rounded-xl border bg-surface p-3', current ? 'border-accent/40' : 'border-line')}>
              <header className="mb-2 flex items-baseline gap-2">
                <button onClick={() => openMonth(first)} className="text-[13.5px] font-semibold hover:text-accent hover:underline">{monthName(year, m)}</button>
                <span className="num ml-auto text-[12px] text-ink-3">{all.length ? `${open} open` : '—'}{late > 0 && <span className="text-danger"> · {late} overdue</span>}</span>
              </header>
              <div className="grid grid-cols-7 gap-[3px] text-center">
                {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((w, k) => <span key={k} aria-hidden className="pb-0.5 text-[10px] text-ink-3">{w}</span>)}
                {cells.map((d) => {
                  if (parts(d)[1] !== m) return <span key={d} aria-hidden />;
                  const list = byDay.get(d) ?? [];
                  const overdue = list.some((o) => isOpen(o.status) && o.dueDate < today);
                  const n = list.length;
                  const holiday = holidayName(d, calendar);
                  return (
                    <button key={d} onClick={() => openDay(d)} onMouseEnter={() => setHover(d)} onFocus={() => setHover(d)} onMouseLeave={() => setHover(null)} onBlur={() => setHover(null)}
                      aria-label={`${formatDayLong(d)}: ${n} due${overdue ? ', some overdue' : ''}${holiday ? `, ${holiday}` : ''}`}
                      className={cn('num relative flex aspect-square items-center justify-center rounded-[5px] text-[11px] transition-transform hover:scale-110',
                        n ? (level(n) >= 3 ? 'text-on-accent' : 'text-ink') : holiday ? 'text-ink-3/60' : 'text-ink-3', d === today && 'ring-2 ring-ink ring-offset-1 ring-offset-surface')}
                      style={n ? { background: `color-mix(in oklab, var(--c-accent) ${OPACITY[level(n)] * 100}%, var(--c-surface))` } : undefined}>
                      {parts(d)[2]}
                      {overdue && <span aria-hidden className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-danger ring-2 ring-surface" />}
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
      <p className="flex flex-wrap items-center gap-2 text-[12px] text-ink-3" aria-live="polite">
        <span className="inline-flex items-center gap-1">Fewer {OPACITY.slice(1).map((o) => <span key={o} className="size-2.5 rounded-[3px]" style={{ background: `color-mix(in oklab, var(--c-accent) ${o * 100}%, var(--c-surface))` }} />)} more due</span>
        <span className="inline-flex items-center gap-1"><span className="size-1.5 rounded-full bg-danger" /> overdue</span>
        {hover && <span className="ml-auto text-ink-2">{formatDayLong(hover)}: {h!.length ? `${h!.length} due, ${h!.filter((o) => isOpen(o.status)).length} open` : 'nothing due'}</span>}
      </p>
    </div>
  );
}
