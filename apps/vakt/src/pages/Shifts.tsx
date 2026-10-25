// Every shift in the month, week by week, with what each one pays.
import { useState } from 'react';
import { Camera, Check, Paintbrush, Repeat2 } from 'lucide-react';
import { ImportSheet } from '../components/ImportSheet';
import { timesFor } from '../lib/templates';
import { newId } from '../data/repo';
import { KindIcon } from '../components/ShiftSheet';
import { useStore } from '../data/store';
import { DayOffSheet } from '../components/DayOffSheet';
import { RepeatSheet } from '../components/RepeatSheet';
import { DAY_OFF_LABEL, type DayOff, type DayOffKind, type ShiftTemplate } from '../lib/types';
import { isoWeek, type ISODate, type MonthKey } from '../lib/dates';
import { kr, monthName } from '../lib/format';
import { holidayName } from '../lib/holidays';
import { employerOf, inMonth, payOf, shiftEnd, shiftKind, summarize } from '../lib/pay';
import { CalendarGrid } from '../components/Calendar';
import { cn } from '../components/ui';
import type { Shift } from '../lib/types';
import { ShiftRow } from '../components/ShiftRow';
import { Button, Card } from '../components/ui';

const KIND_COLOR = { Dag: '#f59e0b', Kveld: '#8b5cf6', Natt: '#4f46e5' } as const;

export function Shifts({ month, today, filter, onOpenShift, onAdd }: { month: MonthKey; today: ISODate; filter: string | null; onOpenShift: (s: Shift) => void; onAdd: (date?: ISODate) => void }) {
  const { shifts, setup, employers, daysOff, saveShift, deleteShift, saveDayOff, deleteDayOff } = useStore();
  const [dayOff, setDayOff] = useState<DayOff | null>(null);
  const [repeat, setRepeat] = useState(false);
  const [importing, setImporting] = useState(false);

  // Quick entry ("trykk-modus"): pick a shift type or a day off once, then every tap on a day adds it, and a second
  // tap takes it away again. The fastest way to put in a whole roster.
  type Brush = { shift: ShiftTemplate } | { off: DayOffKind };
  const [brush, setBrush] = useState<Brush | null>(null);
  const lastEmployer = (() => { try { return localStorage.getItem('vakt-last-employer'); } catch { return null; } })();
  const [brushEmp, setBrushEmp] = useState<string | undefined>(() => (employers.find((e) => e.id === (filter ?? lastEmployer)) ?? employers[0])?.id);
  const emp = employers.find((e) => e.id === (filter ?? brushEmp)) ?? employers[0];
  const [added, setAdded] = useState({ count: 0, total: 0 });
  const paint = async (d: ISODate) => {
    if (!brush || !emp) return;
    if ('off' in brush) {
      const had = daysOff.find((x) => x.date === d);
      if (had && had.kind === brush.off) await deleteDayOff(had.id);
      else await saveDayOff({ id: had?.id ?? newId(), date: d, kind: brush.off, note: '' });
      return;
    }
    const t = timesFor(brush.shift, d);
    const had = shifts.find((s) => s.date === d && s.start_time === t.start_time && s.end_time === t.end_time && employerOf(s, employers)?.id === emp.id);
    if (had) {
      if (await deleteShift(had.id)) setAdded((a) => ({ count: a.count - 1, total: a.total - payOf(had, setup).total }));
      return;
    }
    const s: Shift = { id: newId(), employer_id: emp.id, date: d, start_time: t.start_time, end_time: t.end_time, break_minutes: t.break_minutes, overtime_percent: 0, note: '', status: 'worked' };
    if (await saveShift(s)) {
      navigator.vibrate?.(8);
      setAdded((a) => ({ count: a.count + 1, total: a.total + payOf(s, setup).total }));
    }
  };
  // A shift type with its own times on some days says so instead of one time that isn't always right.
  const brushName = brush ? ('off' in brush ? DAY_OFF_LABEL[brush.off]
    : brush.shift.days && Object.keys(brush.shift.days).length ? `${brush.shift.name} (tider etter dag)` : `${brush.shift.name} ${brush.shift.start_time}–${brush.shift.end_time}`) : '';
  const list = inMonth(filter ? shifts.filter((s) => employerOf(s, employers)?.id === filter) : shifts, month).sort((a, b) => (a.date + a.start_time).localeCompare(b.date + b.start_time));
  const weeks = new Map<number, Shift[]>();
  for (const s of list) weeks.set(isoWeek(s.date), [...(weeks.get(isoWeek(s.date)) ?? []), s]);
  const sum = summarize(list, setup);

  const now = new Date();
  // The month as a calendar: a coloured bar per shift (day, evening, night). Tap a day to add or open its shift.
  const brushes = (
    <div className={cn('mb-3 rounded-2xl p-2.5 transition', brush ? 'bg-accent-soft' : 'bg-sunken')} data-testid="quick-entry">
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <span className="flex items-center gap-1.5 text-[13px] font-semibold text-ink-2">
          <Paintbrush className="size-4" />{brush ? `Trykk på dagene: ${brushName}` : 'Legg inn raskt – velg, og trykk på dagene'}
        </span>
        {brush && (
          <button type="button" onClick={() => { setBrush(null); setAdded({ count: 0, total: 0 }); }}
            className="flex items-center gap-1 rounded-full bg-ink px-3 py-1 text-[13px] font-semibold text-canvas"><Check className="size-3.5" /> Ferdig</button>
        )}
      </div>
      {!filter && employers.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {employers.map((e) => (
            <button key={e.id} type="button" aria-pressed={emp?.id === e.id} onClick={() => setBrushEmp(e.id)}
              className={cn('flex items-center gap-1.5 rounded-full px-3 py-1 text-[12.5px] font-semibold', emp?.id === e.id ? 'bg-surface text-ink shadow-card' : 'text-ink-3')}>
              <span className="size-2 rounded-full" style={{ background: e.color }} />{e.name}
            </button>
          ))}
        </div>
      )}
      <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none]" role="group" aria-label="Legg inn raskt">
        {(emp?.templates ?? []).map((t) => {
          const on = Boolean(brush && 'shift' in brush && brush.shift.id === t.id);
          return (
            <button key={t.id} type="button" aria-pressed={on} onClick={() => setBrush(on ? null : { shift: t })}
              className={cn('flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-[13.5px] font-semibold transition active:scale-95',
                on ? 'hero text-white shadow-float' : 'bg-surface text-ink shadow-card')}>
              <KindIcon kind={shiftKind(t)} className="size-4" />{t.name}
            </button>
          );
        })}
        {(['ferie', 'fri'] as DayOffKind[]).map((k) => {
          const on = Boolean(brush && 'off' in brush && brush.off === k);
          return (
            <button key={k} type="button" aria-pressed={on} onClick={() => setBrush(on ? null : { off: k })}
              className={cn('shrink-0 rounded-xl px-3 py-2 text-[13.5px] font-semibold transition active:scale-95',
                on ? 'bg-teal-600 text-white' : 'bg-surface text-teal-700 shadow-card dark:text-teal-300')}>
              {DAY_OFF_LABEL[k]}
            </button>
          );
        })}
      </div>
      {brush && added.count > 0 && (
        <p className="mt-2 px-1 text-[13px] font-semibold text-accent-ink" data-testid="quick-added">+{added.count} {added.count === 1 ? 'vakt' : 'vakter'} · +{kr(added.total)}</p>
      )}
    </div>
  );

  const calendar = (
    <Card className="p-3.5">
      {brushes}
      <CalendarGrid month={month} renderDay={(d) => {
        const day = list.filter((s) => s.date === d);
        const off = daysOff.find((x) => x.date === d);
        const isToday = d === today;
        return (
          <button type="button" aria-label={day.length ? `${d}: ${day.length} vakt` : off ? `${d}: ${DAY_OFF_LABEL[off.kind]}` : `Legg til vakt ${d}`}
            onClick={() => (brush ? void paint(d) : day.length ? onOpenShift(day[0]) : off ? setDayOff(off) : onAdd(d))}
            className={cn('flex h-13 w-full flex-col items-center rounded-xl pt-1.5 transition active:scale-90',
              day.length ? 'bg-sunken' : off ? 'bg-teal-500/15' : 'active:bg-sunken', isToday && 'ring-2 ring-accent/50')}>
            <span className={cn('text-[13px] font-semibold', isToday ? 'text-accent-ink' : holidayName(d) ? 'text-rose' : day.length ? 'text-ink' : 'text-ink-3')}>{Number(d.slice(8))}</span>
            <span className="mt-1 flex w-full flex-col items-center gap-0.5 px-1.5">
              {day.slice(0, 2).map((s) => (
                <span key={s.id} className={cn('h-1.5 w-full rounded-full', shiftEnd(s) > now && 'opacity-45')} style={{ background: s.status === 'sick' ? 'var(--c-danger)' : KIND_COLOR[shiftKind(s)] }} />
              ))}
              {!day.length && off && <span className="text-[9.5px] leading-none font-bold text-teal-700 dark:text-teal-300">{DAY_OFF_LABEL[off.kind].slice(0, 5)}</span>}
            </span>
          </button>
        );
      }} />
      <div className="mt-3 flex justify-center gap-4 text-[11.5px] text-ink-3">
        {(Object.keys(KIND_COLOR) as (keyof typeof KIND_COLOR)[]).map((k) => (
          <span key={k} className="flex items-center gap-1.5"><span className="h-1.5 w-3 rounded-full" style={{ background: KIND_COLOR[k] }} />{k}</span>
        ))}
        <span className="flex items-center gap-1.5"><span className="h-1.5 w-3 rounded-full bg-danger" />Syk</span>
      </div>
    </Card>
  );
  const sheets = (
    <>
      {dayOff && <DayOffSheet day={dayOff} onClose={() => setDayOff(null)} />}
      {repeat && <RepeatSheet from={list[0]?.date ?? `${month}-01`} onClose={() => setRepeat(false)} />}
      {importing && <ImportSheet month={month} onClose={() => setImporting(false)} />}
    </>
  );

  if (list.length === 0) {
    return (
      <div className="space-y-4 md:grid md:grid-cols-2 md:items-start md:gap-5 md:space-y-0">
        {calendar}
        <Card className="text-center">
          <p className="mb-1 text-[17px] font-bold">Ingen vakter i {monthName(month).toLowerCase()} ennå</p>
          <p className="mb-4 text-[14px] text-ink-3">Trykk på dagene i kalenderen, eller legg inn flere dager på én gang med +.</p>
          <Button variant="primary" onClick={() => onAdd()} className="w-full">Legg inn vakter</Button>
          <Button variant="soft" onClick={() => setImporting(true)} className="mt-2 w-full"><Camera className="size-5" /> Importer turnus fra GAT (bilde)</Button>
          <Button variant="ghost" onClick={() => setRepeat(true)} className="mt-1 w-full"><Repeat2 className="size-5" /> Gjenta vakter fra en annen uke</Button>
        </Card>
        {sheets}
      </div>
    );
  }

  return (
    <div className="space-y-5 md:grid md:grid-cols-2 md:items-start md:gap-5 md:space-y-0">
      {/* On iPad the calendar stays in view on the left while the list scrolls. */}
      <div className="space-y-3 md:sticky md:top-28">
        {calendar}
        <div className="grid grid-cols-2 gap-2">
          <Button variant="soft" className="px-3" onClick={() => setImporting(true)}><Camera className="size-5" /> Importer fra GAT</Button>
          <Button variant="soft" className="px-3" onClick={() => setRepeat(true)}><Repeat2 className="size-5" /> Gjenta uker</Button>
        </div>
        {sheets}
      </div>
      <div className="space-y-5">
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
    </div>
  );
}
