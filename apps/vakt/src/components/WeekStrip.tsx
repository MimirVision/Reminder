// "Denne uka": the seven days of the week at a glance, with what each day's shifts pay. Tap a day to open its shift or
// add one there.
import { useStore } from '../data/store';
import { addDays, weekday, type ISODate } from '../lib/dates';
import { WEEKDAY_SHORT, kr } from '../lib/format';
import { employerOf, payOf, shiftKind, summarize } from '../lib/pay';
import { DAY_OFF_LABEL, type Shift } from '../lib/types';
import { Card, cn } from './ui';

const KIND_COLOR = { Dag: '#f59e0b', Kveld: '#8b5cf6', Natt: '#4f46e5' } as const;
/** '2 340' → '2,3k' so a day's sum fits in a narrow column. */
const short = (n: number) => (n >= 1000 ? `${(n / 1000).toLocaleString('nb-NO', { maximumFractionDigits: 1 })}k` : String(Math.round(n)));

export function WeekStrip({ today, filter, onOpenShift, onAdd }: { today: ISODate; filter: string | null; onOpenShift: (s: Shift) => void; onAdd: (d: ISODate) => void }) {
  const { shifts, setup, employers, daysOff } = useStore();
  const monday = addDays(today, 1 - weekday(today));
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const mine = (filter ? shifts.filter((s) => employerOf(s, employers)?.id === filter) : shifts).filter((s) => s.date >= days[0] && s.date <= days[6]);
  const total = summarize(mine, setup).total;
  return (
    <Card className="p-4" >
      <div className="mb-3 flex items-baseline justify-between px-1">
        <h3 className="text-[16px] font-bold">Denne uka</h3>
        <span className="tabular text-[14px] font-semibold text-ink-2" data-testid="week-total">{mine.length ? kr(total) : 'Ingen vakter'}</span>
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {days.map((d, i) => {
          const day = mine.filter((s) => s.date === d).sort((a, b) => a.start_time.localeCompare(b.start_time));
          const off = daysOff.find((x) => x.date === d);
          const sum = day.reduce((n, s) => n + payOf(s, setup).total, 0);
          const isToday = d === today;
          return (
            <button key={d} type="button" aria-label={day.length ? `${WEEKDAY_SHORT[i]} ${d}: ${kr(sum)}` : `Legg til vakt ${d}`}
              onClick={() => (day.length ? onOpenShift(day[0]) : onAdd(d))}
              className={cn('flex h-[86px] flex-col items-center rounded-2xl pt-2 pb-1.5 transition active:scale-95',
                isToday ? 'hero text-white shadow-float' : day.length ? 'bg-sunken' : off ? 'bg-teal-500/15' : 'bg-sunken/50')}>
              <span className={cn('text-[11px] font-semibold uppercase', isToday ? 'text-white/85' : 'text-ink-3')}>{WEEKDAY_SHORT[i]}</span>
              <span className="text-[16px] leading-tight font-bold">{Number(d.slice(8))}</span>
              <span className="mt-auto flex w-full flex-col items-center gap-0.5 px-1.5">
                {day.slice(0, 2).map((s) => (
                  <span key={s.id} className="h-1.5 w-full rounded-full" style={{ background: isToday ? 'rgb(255 255 255 / 0.9)' : s.status === 'sick' ? 'var(--c-danger)' : KIND_COLOR[shiftKind(s)] }} />
                ))}
                {day.length > 0
                  ? <span className={cn('tabular text-[11px] font-bold', isToday ? 'text-white' : 'text-ink-2')}>{short(sum)}</span>
                  : off ? <span className="text-[10px] font-bold text-teal-700 dark:text-teal-300">{DAY_OFF_LABEL[off.kind].slice(0, 5)}</span>
                  : <span className={cn('text-[16px] leading-none font-light', isToday ? 'text-white/80' : 'text-ink-3/60')}>+</span>}
              </span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}
