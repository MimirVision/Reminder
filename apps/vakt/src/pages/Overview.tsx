// The month at a glance: what she has earned, what is on the way, how close the goal is, and what the supplements gave.
import { useMemo } from 'react';
import { CalendarClock, Clock, Sparkles, Target } from 'lucide-react';
import { useStore } from '../data/store';
import { monthOf, type ISODate, type MonthKey } from '../lib/dates';
import { hrs, kr, monthName, relDate } from '../lib/format';
import { motivation } from '../lib/motivation';
import { employerOf, inMonth, payOf, shiftEnd, summarize } from '../lib/pay';
import type { Shift } from '../lib/types';
import { ShiftRow } from '../components/ShiftRow';
import { Button, Card, CountUp, cn } from '../components/ui';

/** `filter` is an employer id to show only that job, or null for all of them. */
export function Overview({ month, today, filter, onOpenShift, onAdd, onSeeAll }: {
  month: MonthKey; today: ISODate; filter: string | null; onOpenShift: (s: Shift) => void; onAdd: () => void; onSeeAll: () => void;
}) {
  const { shifts: allShifts, setup, employers, settings } = useStore();
  const now = new Date();
  const view = useMemo(() => {
    const shifts = filter ? allShifts.filter((s) => employerOf(s, employers)?.id === filter) : allShifts;
    const list = inMonth(shifts, month).sort((a, b) => (a.date + a.start_time).localeCompare(b.date + b.start_time));
    const done = list.filter((s) => shiftEnd(s) <= now);
    const left = list.filter((s) => shiftEnd(s) > now);
    const totals = new Map<string, number>();
    for (const s of shifts) if (monthOf(s.date) < month) totals.set(monthOf(s.date), (totals.get(monthOf(s.date)) ?? 0) + payOf(s, setup).total);
    const next = shifts.filter((s) => shiftEnd(s) > now).sort((a, b) => (a.date + a.start_time).localeCompare(b.date + b.start_time))[0];
    return {
      list, done, left, next,
      earned: summarize(done, setup),
      planned: summarize(left, setup),
      all: summarize(list, setup),
      bestBefore: Math.max(0, ...totals.values()),
    };
    // `now` changes every render; the minute it is read in is close enough.
  }, [allShifts, setup, employers, filter, month]);

  const current = month === monthOf(today);
  const past = month < monthOf(today);
  // The goal is for all jobs together, so it only shows with all of them.
  const goal = filter ? null : settings.goal;
  const earned = view.earned.total, planned = view.planned.total, total = earned + planned;
  const msg = motivation({
    earned, planned, supplements: view.all.supplementTotal, goal, bestBefore: view.bestBefore,
    shiftsDone: view.done.length, shiftsLeft: view.left.length, isCurrent: current, isPast: past,
  });
  const tax = settings.tax_percent;
  const scale = Math.max(goal ?? 0, total, 1);

  const heroLabel = past ? `Tjent i ${monthName(month).toLowerCase()}` : view.done.length === 0 && view.left.length > 0 ? 'Planlagt denne måneden' : 'Tjent så langt';
  const heroValue = view.done.length === 0 && view.left.length > 0 && !past ? planned : earned;

  return (
    <div className="space-y-4">
      <section data-tour="hero" className="hero relative overflow-hidden rounded-[28px] p-6 text-white shadow-float animate-rise">
        <div className="pointer-events-none absolute -top-16 -right-16 size-48 rounded-full bg-white/10" />
        <div className="pointer-events-none absolute -bottom-20 -left-10 size-40 rounded-full bg-white/10" />
        <p className="relative text-[14px] font-medium text-white/80">{heroLabel}</p>
        <p className="tabular relative font-display text-[52px] leading-[1.05] font-semibold tracking-tight" data-testid="hero-total">
          <CountUp value={heroValue} format={kr} />
        </p>
        {planned > 0 && view.done.length > 0 && (
          <p className="relative mt-1 text-[14.5px] text-white/90">
            + <span className="tabular font-semibold">{kr(planned)}</span> på vei · <span className="tabular font-semibold">{kr(total)}</span> totalt
          </p>
        )}
        {tax ? <p className="relative mt-1 text-[13px] text-white/75">Totalt ca. {kr(total * (1 - tax / 100))} etter skatt ({tax} % trekk)</p> : null}

        {goal ? (
          <div className="relative mt-5">
            <div className="relative h-3.5 overflow-hidden rounded-full bg-white/20">
              <div className="absolute inset-y-0 left-0 rounded-full bg-white/35" style={{ width: `${Math.min(100, (total / scale) * 100)}%` }} />
              <div className="absolute inset-y-0 left-0 rounded-full bg-white transition-[width] duration-700" style={{ width: `${Math.min(100, (earned / scale) * 100)}%` }} />
              {total > goal && <div className="absolute inset-y-0 w-0.5 bg-ink/40" style={{ left: `${(goal / scale) * 100}%` }} />}
            </div>
            <div className="mt-2 flex justify-between text-[13px] text-white/85">
              <span className="flex items-center gap-1"><Target className="size-3.5" /> Mål {kr(goal)}</span>
              <span className="tabular font-semibold">{Math.round((earned / goal) * 100)} %{planned > 0 ? ` → ${Math.round((total / goal) * 100)} %` : ''}</span>
            </div>
          </div>
        ) : null}
      </section>

      <div className="flex items-start gap-3 rounded-3xl bg-accent-soft p-4 animate-rise [animation-delay:60ms]">
        <span className="text-[26px] leading-none" aria-hidden>{msg.emoji}</span>
        <p className="text-[15px] leading-snug font-medium text-accent-ink" data-testid="motivation">{msg.text}</p>
      </div>

      <div className="grid grid-cols-3 gap-3 animate-rise [animation-delay:120ms]">
        <Tile icon={<CalendarClock className="size-4" />} tone="violet" label="Vakter" value={`${view.done.length}${view.left.length ? `/${view.list.length}` : ''}`} />
        <Tile icon={<Clock className="size-4" />} tone="sky" label="Timer" value={hrs(Math.round(view.all.hours * 10) / 10)} />
        <Tile icon={<Sparkles className="size-4" />} tone="green" label="Tillegg" value={kr(view.all.supplementTotal)} />
      </div>

      {view.next && current && (
        <section className="animate-rise [animation-delay:160ms]">
          <p className="mb-2 px-1 text-[13px] font-semibold text-ink-3">Neste vakt · {relDate(view.next.date, today)}</p>
          <ShiftRow shift={view.next} today={today} onOpen={() => onOpenShift(view.next!)} />
        </section>
      )}

      {!filter && employers.length > 1 && view.all.total > 0 && (
        <Card className="animate-rise [animation-delay:180ms]">
          <h3 className="mb-3 text-[16px] font-bold">Per arbeidsgiver</h3>
          <ul className="space-y-2.5 text-[14.5px]">
            {employers.filter((e) => view.all.byEmployer.has(e.id)).map((e) => (
              <Line key={e.id} color={e.color} label={e.name} sub={`${Math.round(((view.all.byEmployer.get(e.id) ?? 0) / view.all.total) * 100)} %`} value={view.all.byEmployer.get(e.id) ?? 0} />
            ))}
          </ul>
        </Card>
      )}

      {view.all.total > 0 && (
        <Card className="animate-rise [animation-delay:200ms]">
          <h3 className="text-[16px] font-bold">Hvor pengene kommer fra</h3>
          <p className="mb-4 text-[13px] text-ink-3">
            {view.all.supplementTotal > 0 ? `Tilleggene utgjør ${Math.round((view.all.supplementTotal / view.all.total) * 100)} % av månedens lønn.` : 'Ingen tillegg denne måneden ennå.'}
          </p>
          <div className="mb-4 flex h-4 overflow-hidden rounded-full bg-sunken">
            <div className="bg-ink-3/40" style={{ width: `${(view.all.base / view.all.total) * 100}%` }} title="Timelønn" />
            {view.all.overtime > 0 && <div className="bg-accent" style={{ width: `${(view.all.overtime / view.all.total) * 100}%` }} title="Overtid" />}
            {view.all.bySupplement.map((x) => <div key={x.id} style={{ width: `${(x.amount / view.all.total) * 100}%`, background: x.color }} title={x.name} />)}
          </div>
          <ul className="space-y-2.5 text-[14.5px]">
            <Line color="color-mix(in srgb, var(--c-ink-3) 40%, transparent)" label="Timelønn" sub={hrs(Math.round(view.all.hours * 10) / 10)} value={view.all.base} />
            {view.all.overtime > 0 && <Line color="var(--c-accent)" label="Overtid" value={view.all.overtime} />}
            {view.all.bySupplement.map((x) => <Line key={x.id} color={x.color} label={x.name} sub={hrs(Math.round(x.hours * 10) / 10)} value={x.amount} />)}
          </ul>
        </Card>
      )}

      {view.list.length === 0 ? (
        <Card className="text-center">
          <p className="mb-1 text-[17px] font-bold">Ingen vakter i {monthName(month).toLowerCase()} ennå</p>
          <p className="mb-4 text-[14px] text-ink-3">Legg inn vaktene dine, så ser du med en gang hva du tjener.</p>
          <Button variant="primary" onClick={onAdd} className="w-full">Legg inn vakt</Button>
        </Card>
      ) : (
        <button onClick={onSeeAll} className="w-full rounded-2xl py-3 text-[14.5px] font-semibold text-accent-ink">
          Se alle {view.list.length} vakter i {monthName(month).toLowerCase()} →
        </button>
      )}
    </div>
  );
}

const TONES = {
  violet: 'bg-accent-soft text-accent-ink',
  sky: 'bg-sky-500/12 text-sky-600 dark:text-sky-300',
  green: 'bg-ok-soft text-ok',
};

function Tile({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone: keyof typeof TONES }) {
  return (
    <div className="rounded-3xl bg-surface p-3.5 shadow-card">
      <div className={cn('mb-2.5 grid size-8 place-items-center rounded-xl', TONES[tone])}>{icon}</div>
      <div className="tabular truncate text-[17px] leading-tight font-bold">{value}</div>
      <div className="mt-0.5 text-[12.5px] font-medium text-ink-3">{label}</div>
    </div>
  );
}

function Line({ color, label, sub, value }: { color: string; label: string; sub?: string; value: number }) {
  return (
    <li className="flex items-center gap-2.5">
      <span className="size-3 shrink-0 rounded-full" style={{ background: color }} />
      <span className="flex-1 font-medium">{label}{sub && <span className="ml-1.5 text-[12.5px] font-normal text-ink-3">{sub}</span>}</span>
      <span className="tabular font-semibold">{kr(value)}</span>
    </li>
  );
}
