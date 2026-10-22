// The year: month by month, the best month, and how much the supplements added up to.
import { useMemo } from 'react';
import { ChevronLeft, ChevronRight, Trophy } from 'lucide-react';
import { useStore } from '../data/store';
import { monthOf, type ISODate, type MonthKey } from '../lib/dates';
import { MONTHS, hrs, kr, monthName } from '../lib/format';
import { shiftEnd, summarize } from '../lib/pay';
import { Card, CountUp, cn } from '../components/ui';

export function Year({ year, setYear, today, onPickMonth }: { year: number; setYear: (y: number) => void; today: ISODate; onPickMonth: (m: MonthKey) => void }) {
  const { shifts, supplements, settings } = useStore();
  const data = useMemo(() => {
    const now = new Date();
    const months = MONTHS.map((_, i) => {
      const key = `${year}-${String(i + 1).padStart(2, '0')}`;
      const list = shifts.filter((s) => monthOf(s.date) === key);
      const done = summarize(list.filter((s) => shiftEnd(s) <= now), supplements, settings.wages);
      const left = summarize(list.filter((s) => shiftEnd(s) > now), supplements, settings.wages);
      return { key, earned: done.total, planned: left.total };
    });
    const all = summarize(shifts.filter((s) => s.date.startsWith(`${year}-`)), supplements, settings.wages);
    return { months, all };
  }, [shifts, supplements, settings.wages, year]);

  const max = Math.max(1, ...data.months.map((m) => m.earned + m.planned), settings.goal ?? 0);
  const withShifts = data.months.filter((m) => m.earned + m.planned > 0);
  const best = withShifts.reduce<(typeof data.months)[number] | null>((b, m) => (!b || m.earned + m.planned > b.earned + b.planned ? m : b), null);
  const avg = withShifts.length ? data.all.total / withShifts.length : 0;
  const thisMonth = monthOf(today);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button aria-label="Forrige år" onClick={() => setYear(year - 1)} className="grid size-10 place-items-center rounded-full bg-surface shadow-card"><ChevronLeft className="size-5" /></button>
        <h2 className="tabular text-[20px] font-bold">{year}</h2>
        <button aria-label="Neste år" onClick={() => setYear(year + 1)} className="grid size-10 place-items-center rounded-full bg-surface shadow-card"><ChevronRight className="size-5" /></button>
      </div>

      <section className="hero rounded-[28px] p-6 text-white shadow-float">
        <p className="text-[14px] font-medium text-white/80">Totalt i {year}</p>
        <p className="tabular font-display text-[46px] leading-tight font-semibold"><CountUp value={data.all.total} format={kr} /></p>
        <div className="mt-3 grid grid-cols-3 gap-2 text-[13px]">
          <Stat label="Vakter" value={String(data.all.count)} />
          <Stat label="Timer" value={hrs(Math.round(data.all.hours))} />
          <Stat label="Tillegg" value={kr(data.all.supplementTotal)} />
        </div>
      </section>

      <Card>
        <div className="mb-4 flex items-baseline justify-between">
          <h3 className="text-[16px] font-bold">Måned for måned</h3>
          {avg > 0 && <span className="text-[13px] text-ink-3">snitt {kr(avg)}</span>}
        </div>
        <div className="relative flex h-44 items-end gap-1.5">
          {settings.goal ? <div className="pointer-events-none absolute inset-x-0 border-t border-dashed border-rose/60" style={{ bottom: `${(settings.goal / max) * 100}%` }} /> : null}
          {data.months.map((m, i) => {
            const isBest = best?.key === m.key;
            return (
              <button key={m.key} onClick={() => onPickMonth(m.key)} aria-label={`${monthName(m.key)}: ${kr(m.earned + m.planned)}`}
                className="group flex h-full flex-1 flex-col items-center justify-end gap-1">
                <div className="flex w-full flex-col justify-end overflow-hidden rounded-lg" style={{ height: `${((m.earned + m.planned) / max) * 100}%`, minHeight: m.earned + m.planned > 0 ? 4 : 0 }}>
                  <div className="w-full bg-accent/30" style={{ flex: m.planned }} />
                  <div className={cn('w-full', isBest ? 'bg-rose' : 'bg-accent')} style={{ flex: m.earned }} />
                </div>
                <span className={cn('text-[10.5px] font-semibold', m.key === thisMonth ? 'text-accent-ink' : 'text-ink-3')}>{MONTHS[i].slice(0, 1).toUpperCase()}</span>
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex gap-4 text-[12px] text-ink-3">
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-accent" />Tjent</span>
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-accent/30" />Planlagt</span>
          {settings.goal ? <span className="flex items-center gap-1.5"><span className="w-3 border-t border-dashed border-rose" />Mål</span> : null}
        </div>
      </Card>

      {best && (
        <Card className="flex items-center gap-4">
          <div className="grid size-12 place-items-center rounded-2xl bg-rose/15 text-rose"><Trophy className="size-6" /></div>
          <div>
            <p className="text-[13px] font-semibold text-ink-3">Beste måned</p>
            <p className="text-[17px] font-bold">{monthName(best.key)} · <span className="tabular">{kr(best.earned + best.planned)}</span></p>
          </div>
        </Card>
      )}

      {data.all.bySupplement.length > 0 && (
        <Card>
          <h3 className="mb-3 text-[16px] font-bold">Tilleggene i {year}</h3>
          <ul className="space-y-2.5">
            {data.all.bySupplement.map((x) => (
              <li key={x.id} className="flex items-center gap-2.5 text-[14.5px]">
                <span className="size-3 rounded-full" style={{ background: x.color }} />
                <span className="flex-1 font-medium">{x.name}</span>
                <span className="tabular font-semibold">{kr(x.amount)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white/15 px-3 py-2">
      <div className="text-white/75">{label}</div>
      <div className="tabular truncate text-[15px] font-bold">{value}</div>
    </div>
  );
}
