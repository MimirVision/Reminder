import { Check } from 'lucide-react';
import { useStore } from '../data/store';
import { parts, weekday, type ISODate } from '../lib/dates';
import { WEEKDAY_SHORT, hrs, kr } from '../lib/format';
import { eveName, holidayName } from '../lib/holidays';
import { calcShift, shiftEnd, shiftKind } from '../lib/pay';
import type { Shift } from '../lib/types';
import { KindIcon } from './ShiftSheet';
import { cn } from './ui';

export function ShiftRow({ shift, today, onOpen }: { shift: Shift; today: ISODate; onOpen: () => void }) {
  const { supplements, settings } = useStore();
  const pay = calcShift(shift, supplements, settings.wages);
  const done = shiftEnd(shift) <= new Date();
  const kind = shiftKind(shift);
  const special = holidayName(shift.date) ?? eveName(shift.date);
  const isToday = shift.date === today;
  return (
    <button onClick={onOpen} className="flex w-full items-center gap-3.5 rounded-2xl bg-surface p-3 text-left shadow-card transition active:scale-[0.99]">
      <div className={cn('flex size-13 shrink-0 flex-col items-center justify-center rounded-xl',
        isToday ? 'hero text-white' : special ? 'bg-danger-soft text-danger' : 'bg-sunken text-ink')}>
        <span className="text-[11px] font-semibold uppercase opacity-80">{WEEKDAY_SHORT[weekday(shift.date) - 1]}</span>
        <span className="tabular text-[19px] leading-none font-bold">{parts(shift.date)[2]}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[15px] font-semibold">
          <KindIcon kind={kind} className="size-4 text-ink-3" />
          <span className="tabular">{shift.start_time}–{shift.end_time}</span>
          {done && <Check className="size-4 text-ok" aria-label="Ferdig" />}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 truncate text-[12.5px] text-ink-3">
          <span>{hrs(pay.paidHours)}</span>
          {special && <span className="font-medium text-rose">· {special}</span>}
          {shift.overtime_percent > 0 && <span className="font-medium text-accent-ink">· Overtid</span>}
          {shift.note && <span className="truncate">· {shift.note}</span>}
          {pay.supplements.length > 0 && (
            <span className="ml-0.5 flex gap-1">{pay.supplements.map((x) => <span key={x.id} className="size-2 rounded-full" style={{ background: x.color }} title={x.name} />)}</span>
          )}
        </div>
      </div>
      <div className="text-right">
        <div className={cn('tabular text-[16px] font-bold', done ? 'text-ink' : 'text-ink-2')}>{kr(pay.total)}</div>
        {pay.supplementTotal > 0 && <div className="tabular text-[12px] font-medium text-ok">+{kr(pay.supplementTotal)}</div>}
      </div>
    </button>
  );
}
