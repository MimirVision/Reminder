// The month as a list, day by day: meetings and time set aside at their times, then every task due that day with its
// client, type and state, ticked off right there. Days with nothing on them are left out. Opens at today.
import { useLayoutEffect, useRef, useState } from 'react';
import { CalendarCheck, Check, ChevronDown, MapPin } from 'lucide-react';
import { useStore } from '../../data/store';
import type { ISODate } from '../../lib/dates';
import { formatDayLong } from '../../lib/format';
import { addDays } from '../../lib/dates';
import { typeColor } from '../../lib/insights';
import { STATUS_LABEL, TYPE_LABEL } from '../../lib/labels';
import { isOpen, type Meeting, type Occurrence } from '../../lib/types';
import { cn } from '../../ui/cn';
import { EmptyState } from '../../ui/states';
import { CompleteToggle } from '../TaskTable';
import { useUI } from '../ui-state';

export function AgendaView({ days, today, byDay, meetingsOn, blocksOn }: {
  days: ISODate[]; today: ISODate; byDay: Map<ISODate, Occurrence[]>; meetingsOn: (d: ISODate) => Meeting[]; blocksOn: (d: ISODate) => Occurrence[];
}) {
  const ui = useUI();
  const { clientById } = useStore();
  const shown = days.filter((d) => (byDay.get(d)?.length ?? 0) + meetingsOn(d).length + blocksOn(d).length > 0);
  const todayRef = useRef<HTMLElement>(null);
  const [showDone, setShowDone] = useState<Set<ISODate>>(new Set());
  useLayoutEffect(() => { todayRef.current?.scrollIntoView({ block: 'start' }); }, [days[0]]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!shown.length) return <div className="rounded-xl border border-line bg-surface py-10"><EmptyState icon={CalendarCheck} title="Nothing this month" body="No tasks are due and no meetings are booked." /></div>;
  // Today, or the first day after it that has something on it, is where the list opens.
  const anchor = shown.find((d) => d >= today);
  return (
    <div className="flex flex-col gap-3">
      {shown.map((d) => {
        const tasks = byDay.get(d) ?? [];
        const timed = [
          ...meetingsOn(d).map((m) => ({ key: m.id, start: m.start, end: m.end, title: m.title, client: m.clientId ? clientById.get(m.clientId)?.name : 'Internal', where: m.location, block: false, open: () => ui.openMeeting({ mode: 'edit', id: m.id }) })),
          ...blocksOn(d).map((b) => ({ key: `b${b.id}`, start: b.plannedStart!, end: b.plannedEnd!, title: b.title, client: clientById.get(b.clientId)?.name, where: '', block: true, open: () => ui.openTask(b.id) })),
        ].sort((a, b) => a.start.localeCompare(b.start));
        const open = tasks.filter((t) => isOpen(t.status)).length;
        return (
          <section key={d} ref={d === anchor ? todayRef : undefined} aria-label={formatDayLong(d)}
            className={cn('scroll-mt-20 overflow-clip rounded-xl border bg-surface', d === today ? 'border-accent/40' : 'border-line')}>
            <header className={cn('sticky top-[52px] z-10 flex items-baseline gap-2 border-b border-line px-4 py-2 backdrop-blur', d === today ? 'bg-accent-soft/70' : 'bg-surface/90')}>
              <h3 className="text-[13.5px] font-semibold">{formatDayLong(d)}</h3>
              {(d === today || d === addDays(today, 1) || d === addDays(today, -1)) && <span className={cn('text-[12px]', d === today ? 'font-medium text-accent-ink' : 'text-ink-3')}>{d === today ? 'Today' : d > today ? 'Tomorrow' : 'Yesterday'}</span>}
              <span className="num ml-auto text-[12px] text-ink-3">
                {[timed.length && `${timed.length} at a time`, tasks.length && `${open} open${tasks.length > open ? ` · ${tasks.length - open} done` : ''}`].filter(Boolean).join(' · ')}
              </span>
            </header>
            <ul className="divide-y divide-line/70">
              {timed.map((x) => (
                <li key={x.key}>
                  <button onClick={x.open} className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-hover/60">
                    <span className="num w-[88px] shrink-0 text-[12.5px] text-ink-2">{x.start}–{x.end}</span>
                    <span aria-hidden className={cn('h-5 shrink-0', x.block ? 'border-l-[3px] border-dashed border-ink-3/60' : 'w-[3px] rounded-full bg-accent')} />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{x.block && <span className="font-normal text-ink-3">Time for </span>}{x.title}</span>
                    <span className="hidden min-w-0 truncate text-[12.5px] text-ink-3 sm:block">{x.client}</span>
                    {x.where && <span className="hidden shrink-0 items-center gap-1 text-[12px] text-ink-3 md:inline-flex"><MapPin className="size-3" />{x.where}</span>}
                  </button>
                </li>
              ))}
              {tasks.filter((t) => isOpen(t.status) || showDone.has(d)).map((t) => {
                const overdue = isOpen(t.status) && t.dueDate < today;
                return (
                  <li key={t.id} className={cn('flex items-center gap-3 px-4 py-1.5 hover:bg-hover/60', !isOpen(t.status) && 'opacity-60')}>
                    <span className="flex w-[88px] shrink-0 items-center"><CompleteToggle task={t} /></span>
                    <span aria-hidden className="h-5 w-[3px] shrink-0 rounded-full" style={{ background: typeColor(t.taskType) }} />
                    <button onClick={() => ui.openTask(t.id)} className="flex min-w-0 flex-1 flex-col text-left sm:flex-row sm:items-center sm:gap-3">
                      <span className={cn('min-w-0 truncate text-[13px] font-medium sm:flex-1', t.status === 'done' && 'line-through decoration-ink-3/50')}>{t.title}</span>
                      <span className="min-w-0 truncate text-[12.5px] text-ink-2 sm:w-56 sm:shrink-0">{clientById.get(t.clientId)?.name}</span>
                    </button>
                    <span className="hidden w-28 shrink-0 text-[12px] text-ink-3 lg:block">{TYPE_LABEL[t.taskType]}</span>
                    <span className={cn('w-24 shrink-0 text-right text-[12px]', overdue ? 'font-medium text-danger' : t.status === 'waiting' ? 'text-warn' : 'text-ink-3')}>
                      {overdue ? 'Overdue' : STATUS_LABEL[t.status]}
                    </span>
                  </li>
                );
              })}
            </ul>
            {/* Finished work folds away, so what is still to do stands out. */}
            {tasks.length > open && (
              <button onClick={() => setShowDone((s) => { const n = new Set(s); if (n.has(d)) n.delete(d); else n.add(d); return n; })} aria-expanded={showDone.has(d)}
                className="flex h-8 w-full items-center gap-2 border-t border-line px-4 text-left text-[12.5px] text-ink-3 hover:bg-hover/60 hover:text-ink">
                <Check className="size-3.5 text-ok" strokeWidth={3} /> {showDone.has(d) ? 'Hide' : 'Show'} {tasks.length - open} done
                <ChevronDown className={cn('size-3.5 transition-transform', showDone.has(d) && 'rotate-180')} />
              </button>
            )}
          </section>
        );
      })}
    </div>
  );
}
