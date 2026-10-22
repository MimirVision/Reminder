// Every shift in the month, week by week, with what each one pays.
import { useStore } from '../data/store';
import { isoWeek, type ISODate, type MonthKey } from '../lib/dates';
import { kr, monthName } from '../lib/format';
import { inMonth, summarize } from '../lib/pay';
import type { Shift } from '../lib/types';
import { ShiftRow } from '../components/ShiftRow';
import { Button, Card } from '../components/ui';

export function Shifts({ month, today, onOpenShift, onAdd }: { month: MonthKey; today: ISODate; onOpenShift: (s: Shift) => void; onAdd: () => void }) {
  const { shifts, supplements, settings } = useStore();
  const list = inMonth(shifts, month).sort((a, b) => (a.date + a.start_time).localeCompare(b.date + b.start_time));
  const weeks = new Map<number, Shift[]>();
  for (const s of list) weeks.set(isoWeek(s.date), [...(weeks.get(isoWeek(s.date)) ?? []), s]);
  const sum = summarize(list, supplements, settings.wages);

  if (list.length === 0) {
    return (
      <Card className="mt-2 text-center">
        <div className="mb-2 text-[40px]" aria-hidden>🗓️</div>
        <p className="mb-1 text-[17px] font-bold">Ingen vakter i {monthName(month).toLowerCase()}</p>
        <p className="mb-4 text-[14px] text-ink-3">Tips: bruk «Lagre + ny» for å legge inn hele turnusen på et blunk.</p>
        <Button variant="primary" onClick={onAdd} className="w-full">Legg inn vakt</Button>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-baseline justify-between px-1">
        <span className="text-[14px] text-ink-3">{list.length} vakter</span>
        <span className="tabular text-[15px] font-bold">{kr(sum.total)}</span>
      </div>
      {[...weeks.entries()].map(([week, items]) => (
        <section key={week}>
          <div className="mb-2 flex items-baseline justify-between px-1">
            <h3 className="text-[13px] font-bold tracking-wide text-ink-3 uppercase">Uke {week}</h3>
            <span className="tabular text-[13px] font-semibold text-ink-3">{kr(summarize(items, supplements, settings.wages).total)}</span>
          </div>
          <div className="space-y-2">
            {items.map((s) => <ShiftRow key={s.id} shift={s} today={today} onOpen={() => onOpenShift(s)} />)}
          </div>
        </section>
      ))}
    </div>
  );
}
