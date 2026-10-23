// Every shift in the month, week by week, with what each one pays.
import { useStore } from '../data/store';
import { isoWeek, type ISODate, type MonthKey } from '../lib/dates';
import { kr, monthName } from '../lib/format';
import { holidayName } from '../lib/holidays';
import { employerOf, inMonth, shiftEnd, shiftKind, summarize } from '../lib/pay';
import { CalendarGrid } from '../components/Calendar';
import { cn } from '../components/ui';
import type { Shift } from '../lib/types';
import { ShiftRow } from '../components/ShiftRow';
import { Button, Card } from '../components/ui';

const KIND_COLOR = { Dag: '#f59e0b', Kveld: '#8b5cf6', Natt: '#4f46e5' } as const;

export function Shifts({ month, today, filter, onOpenShift, onAdd }: { month: MonthKey; today: ISODate; filter: string | null; onOpenShift: (s: Shift) => void; onAdd: (date?: ISODate) => void }) {
  const { shifts, setup, employers } = useStore();
  const list = inMonth(filter ? shifts.filter((s) => employerOf(s, employers)?.id === filter) : shifts, month).sort((a, b) => (a.date + a.start_time).localeCompare(b.date + b.start_time));
  const weeks = new Map<number, Shift[]>();
  for (const s of list) weeks.set(isoWeek(s.date), [...(weeks.get(isoWeek(s.date)) ?? []), s]);
  const sum = summarize(list, setup);

  const now = new Date();
  // The month as a calendar: a coloured bar per shift (day, evening, night). Tap a day to add or open its shift.
  const calendar = (
    <Card className="p-3.5">
      <CalendarGrid month={month} renderDay={(d) => {
        const day = list.filter((s) => s.date === d);
        const isToday = d === today;
        return (
          <button type="button" aria-label={day.length ? `${d}: ${day.length} vakt` : `Legg til vakt ${d}`}
            onClick={() => (day.length ? onOpenShift(day[0]) : onAdd(d))}
            className={cn('flex h-13 w-full flex-col items-center rounded-xl pt-1.5 transition active:scale-90',
              day.length ? 'bg-sunken' : 'active:bg-sunken', isToday && 'ring-2 ring-accent/50')}>
            <span className={cn('text-[13px] font-semibold', isToday ? 'text-accent-ink' : holidayName(d) ? 'text-rose' : day.length ? 'text-ink' : 'text-ink-3')}>{Number(d.slice(8))}</span>
            <span className="mt-1 flex w-full flex-col items-center gap-0.5 px-1.5">
              {day.slice(0, 2).map((s) => (
                <span key={s.id} className={cn('h-1.5 w-full rounded-full', shiftEnd(s) > now && 'opacity-45')} style={{ background: KIND_COLOR[shiftKind(s)] }} />
              ))}
            </span>
          </button>
        );
      }} />
      <div className="mt-3 flex justify-center gap-4 text-[11.5px] text-ink-3">
        {(Object.keys(KIND_COLOR) as (keyof typeof KIND_COLOR)[]).map((k) => (
          <span key={k} className="flex items-center gap-1.5"><span className="h-1.5 w-3 rounded-full" style={{ background: KIND_COLOR[k] }} />{k}</span>
        ))}
      </div>
    </Card>
  );

  if (list.length === 0) {
    return (
      <div className="space-y-4">
        {calendar}
        <Card className="text-center">
          <p className="mb-1 text-[17px] font-bold">Ingen vakter i {monthName(month).toLowerCase()} ennå</p>
          <p className="mb-4 text-[14px] text-ink-3">Trykk på dagene i kalenderen, eller legg inn flere dager på én gang med +.</p>
          <Button variant="primary" onClick={() => onAdd()} className="w-full">Legg inn vakter</Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {calendar}
      <div className="flex items-baseline justify-between px-1">
        <span className="text-[14px] text-ink-3">{list.length} vakter</span>
        <span className="tabular text-[15px] font-bold">{kr(sum.total)}</span>
      </div>
      {[...weeks.entries()].map(([week, items]) => (
        <section key={week}>
          <div className="mb-2 flex items-baseline justify-between px-1">
            <h3 className="text-[13px] font-bold tracking-wide text-ink-3 uppercase">Uke {week}</h3>
            <span className="tabular text-[13px] font-semibold text-ink-3">{kr(summarize(items, setup).total)}</span>
          </div>
          <div className="space-y-2">
            {items.map((s) => <ShiftRow key={s.id} shift={s} today={today} onOpen={() => onOpenShift(s)} />)}
          </div>
        </section>
      ))}
    </div>
  );
}
