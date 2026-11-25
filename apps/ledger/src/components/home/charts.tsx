// Home's chart widgets: workload by week, a deadline calendar, the month's pace, the on-time rate, open work by type,
// and the busiest clients. Plain HTML and SVG, sized to their widget. Every mark has a hover/focus tooltip, every chart
// a legend where colour carries meaning and a table for screen readers. Colours: the --viz-* tokens in index.css.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { useStore } from '../../data/store';
import { addDays, isoWeek, parts, startOfWeek, type ISODate } from '../../lib/dates';
import { formatDate, formatDayLong } from '../../lib/format';
import {
  GROUPS, GROUP_COLOR, GROUP_LABEL, clientLoad, dueByDay, monthPace, niceMax, onTimeRate, typeMix, weeklyLoad, type TypeGroup,
} from '../../lib/insights';
import { useRoute } from '../../router';
import { cn } from '../../ui/cn';
import { Frame } from './widgets';

const COLOR = GROUP_COLOR;
const GROUP_TYPES: Record<TypeGroup, string> = {
  bookkeeping: 'bookkeeping', vat: 'vat', payroll: 'payroll', reporting: 'reporting', yearEnd: 'annual,tax', other: 'follow_up,other',
};
const pct = (x: number) => `${Math.round(x * 100)}%`;
const monthShort = (d: ISODate) => new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`));

/** The size of an element, kept up to date. */
function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.floor(e.contentRect.width), h: Math.floor(e.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

function Swatch({ color, round }: { color: string; round?: boolean }) {
  return <span aria-hidden className={cn('inline-block size-2.5 shrink-0', round ? 'rounded-full' : 'rounded-[3px]')} style={{ background: color }} />;
}

function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-3.5 gap-y-1 text-[11.5px] text-ink-2" aria-label="Legend">
      {items.map((i) => <li key={i.label} className="inline-flex items-center gap-1.5"><Swatch color={i.color} />{i.label}</li>)}
    </ul>
  );
}

/** A tooltip inside a chart, kept within it horizontally. */
function Tip({ x, y, width, children }: { x: number; y: number; width: number; children: ReactNode }) {
  const left = Math.max(4, Math.min(x - 100, width - 204));
  return (
    <div role="tooltip" className="pointer-events-none absolute z-10 w-[200px] rounded-lg bg-surface px-3 py-2 text-[12px] shadow-pop" style={{ left, top: Math.max(0, y) }}>
      {children}
    </div>
  );
}
const TipRow = ({ color, label, value }: { color?: string; label: string; value: ReactNode }) => (
  <div className="flex items-center gap-1.5 text-ink-2">{color && <Swatch color={color} />}<span className="flex-1 truncate">{label}</span><span className="num text-ink">{value}</span></div>
);

/** Horizontal gridlines with clean tick values, behind a chart. */
function Grid({ max, step, height }: { max: number; step: number; height: number }) {
  const ticks = Array.from({ length: Math.floor(max / step) + 1 }, (_, i) => i * step);
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      {ticks.map((t) => (
        <div key={t} className="absolute right-0 left-0 flex items-center" style={{ bottom: (t / max) * height - 0.5 }}>
          <span className="num w-7 shrink-0 -translate-y-px pr-1.5 text-right text-[10.5px] text-ink-3">{t}</span>
          <span className={cn('h-px flex-1', t === 0 ? 'bg-line-strong' : 'bg-line')} />
        </div>
      ))}
    </div>
  );
}

// ── Workload ahead ─────────────────────────────────────────────────────────────

export function WorkloadWidget() {
  const { snap, today } = useStore();
  const { navigate } = useRoute();
  const [box, size] = useSize<HTMLDivElement>();
  // As many weeks as fit, up to four months ahead: further out there is little to plan yet.
  const weeks = Math.max(6, Math.min(17, Math.floor((size.w - 30) / 46) || 8));
  const data = useMemo(() => weeklyLoad(snap.occurrences, today, weeks), [snap.occurrences, today, weeks]);
  const used = GROUPS.filter((g) => data.some((w) => w.counts[g] > 0));
  const { max, step } = niceMax(Math.max(...data.map((w) => w.total)));
  const total = data.reduce((n, w) => n + w.total, 0);
  const [hover, setHover] = useState<number | null>(null);
  const plotH = Math.max(40, size.h - 20);
  const band = (size.w - 30) / weeks;
  const busiest = data.reduce((b, w, i) => (w.total > data[b].total ? i : b), 0);

  return (
    <Frame title="Workload ahead" count={`${total} open · ${weeks} weeks`} padded>
      <div className="flex h-full min-h-[150px] flex-col gap-2.5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-[12.5px] text-ink-3">
            {total ? <>Busiest: <span className="font-medium text-ink">week {isoWeek(data[busiest].start).week}</span> with <span className="num font-medium text-ink">{data[busiest].total}</span> tasks</> : 'Nothing due in these weeks.'}
          </p>
          {used.length > 0 && <Legend items={used.map((g) => ({ label: GROUP_LABEL[g], color: COLOR[g] }))} />}
        </div>
        <div ref={box} className="relative mt-1.5 min-h-0 flex-1" onMouseLeave={() => setHover(null)}>
          {size.w > 0 && <>
            <div className="absolute inset-x-0 top-0" style={{ height: plotH }}><Grid max={max} step={step} height={plotH} /></div>
            <div className="absolute top-0 right-0 left-[30px] flex" style={{ height: plotH }}>
              {data.map((w, i) => (
                <button key={w.start} type="button" onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
                  onClick={() => navigate(`/calendar?view=week&date=${w.start}`)}
                  aria-label={`Week ${isoWeek(w.start).week}: ${w.total} open${w.overdue ? `, ${w.overdue} of them overdue` : ''}. Open in the calendar`}
                  className={cn('group relative flex h-full flex-1 flex-col-reverse items-center rounded-md focus-visible:outline-offset-0', hover === i && 'bg-hover/60')}>
                  {/* Stacked by type, a 2px surface gap between segments, the top one rounded. */}
                  <span className="flex w-full max-w-[24px] flex-col-reverse gap-[2px]" style={{ height: `${(w.total / max) * 100}%` }}>
                    {GROUPS.filter((g) => w.counts[g]).map((g, k, arr) => (
                      <span key={g} className={cn('block w-full', k === arr.length - 1 && 'rounded-t-[4px]')} style={{ flexGrow: w.counts[g], flexBasis: 0, minHeight: 2, background: COLOR[g] }} />
                    ))}
                  </span>
                </button>
              ))}
            </div>
            <div aria-hidden className="absolute right-0 bottom-0 left-[30px] flex text-[10.5px] text-ink-3">
              {data.map((w, i) => {
                const newMonth = i === 0 || parts(w.start)[1] !== parts(data[i - 1].start)[1];
                const every = band < 40 ? 2 : 1;
                return <span key={w.start} className={cn('num flex-1 truncate text-center', i === 0 && 'font-medium text-ink-2')}>{i % every === 0 ? (newMonth ? `${monthShort(w.start)} W${isoWeek(w.start).week}` : `W${isoWeek(w.start).week}`) : ''}</span>;
              })}
            </div>
            {hover !== null && (
              <Tip x={30 + band * (hover + 0.5)} y={Math.max(0, plotH - (data[hover].total / max) * plotH - 120)} width={size.w}>
                <p className="mb-1 font-medium text-ink">Week {isoWeek(data[hover].start).week} · {formatDate(data[hover].start)}–{formatDate(addDays(data[hover].start, 6))}</p>
                {GROUPS.filter((g) => data[hover].counts[g]).map((g) => <TipRow key={g} color={COLOR[g]} label={GROUP_LABEL[g]} value={data[hover].counts[g]} />)}
                <div className="mt-1 border-t border-line pt-1"><TipRow label="Open" value={data[hover].total} /></div>
                {data[hover].overdue > 0 && <p className="mt-0.5 text-danger">{data[hover].overdue} overdue, counted in this week</p>}
              </Tip>
            )}
          </>}
          <table className="sr-only">
            <caption>Open tasks per week, by type</caption>
            <thead><tr><th>Week</th>{used.map((g) => <th key={g}>{GROUP_LABEL[g]}</th>)}<th>Total</th></tr></thead>
            <tbody>{data.map((w) => <tr key={w.start}><td>Week {isoWeek(w.start).week}</td>{used.map((g) => <td key={g}>{w.counts[g]}</td>)}<td>{w.total}</td></tr>)}</tbody>
          </table>
        </div>
      </div>
    </Frame>
  );
}

// ── Deadline calendar (heatmap) ────────────────────────────────────────────────

const DAYS = ['Mon', '', 'Wed', '', 'Fri', '', 'Sun'];

export function HeatmapWidget() {
  const { snap, today } = useStore();
  const { navigate } = useRoute();
  const [box, size] = useSize<HTMLDivElement>();
  const gap = 3;
  // Squares sized by the card's height; as many weeks as then fit across, up to about nine months.
  const cell = Math.max(9, Math.min(30, Math.floor((size.h - 22) / 7) - gap));
  const cols = Math.max(8, Math.min(40, Math.floor((size.w - 30) / (cell + gap)) || 20));
  // A few weeks back, the rest ahead: where the deadlines are.
  const back = Math.min(4, Math.floor(cols / 5));
  const first = addDays(startOfWeek(today), -7 * back);
  const last = addDays(first, cols * 7 - 1);
  const days = useMemo(() => dueByDay(snap.occurrences, first, last), [snap.occurrences, first, last]);
  const max = Math.max(1, ...[...days.values()].map((d) => d.due));
  const level = (n: number) => (n === 0 ? 0 : n <= max * 0.25 ? 1 : n <= max * 0.5 ? 2 : n <= max * 0.75 ? 3 : 4);
  const OPACITY = [0, 0.22, 0.45, 0.7, 1];
  const [hover, setHover] = useState<{ date: ISODate; x: number; y: number } | null>(null);
  const totalAhead = [...days.values()].filter((d) => d.date >= today).reduce((n, d) => n + d.open, 0);
  const late = [...days.values()].filter((d) => d.date < today && d.open > 0);

  return (
    <Frame title="Deadline calendar" count={`${formatDate(first)} – ${formatDate(last)}`} padded>
      <div className="flex h-full min-h-[150px] flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2 text-[12.5px] text-ink-3">
          <p><span className="num font-medium text-ink">{totalAhead}</span> open deadlines ahead{late.length > 0 && <> · <span className="text-danger">{late.reduce((n, d) => n + d.open, 0)} overdue</span></>}</p>
          <div className="flex items-center gap-1.5 text-[11.5px]" aria-label="Legend">
            Fewer
            {OPACITY.map((o, i) => <span key={i} aria-hidden className="size-2.5 rounded-[3px] bg-sunken" style={i ? { background: `color-mix(in oklab, var(--c-accent) ${o * 100}%, var(--c-surface))` } : undefined} />)}
            More
            <span className="ml-2 inline-flex items-center gap-1"><span aria-hidden className="size-1.5 rounded-full bg-danger" />overdue</span>
          </div>
        </div>
        <div ref={box} className="relative min-h-0 flex-1" onMouseLeave={() => setHover(null)}>
          {size.w > 0 && (
            <div className="flex gap-[3px]" role="grid" aria-label="Tasks due per day">
              <div aria-hidden className="flex w-[27px] shrink-0 flex-col gap-[3px] pt-[18px] text-[10.5px] text-ink-3">
                {DAYS.map((d, i) => <span key={i} className="leading-none" style={{ height: cell, lineHeight: `${cell}px` }}>{d}</span>)}
              </div>
              {Array.from({ length: cols }, (_, c) => {
                const start = addDays(first, c * 7);
                const newMonth = c === 0 || parts(start)[1] !== parts(addDays(start, -7))[1];
                return (
                  <div key={start} role="row" className="flex flex-col gap-[3px]">
                    <span aria-hidden className="h-[15px] text-[10.5px] whitespace-nowrap text-ink-3" style={{ width: cell }}>{newMonth ? monthShort(addDays(start, 6)) : ''}</span>
                    {Array.from({ length: 7 }, (_, r) => {
                      const date = addDays(start, r);
                      const d = days.get(date);
                      const n = d?.due ?? 0;
                      const overdue = date < today && (d?.open ?? 0) > 0;
                      return (
                        <button key={date} type="button" role="gridcell" aria-label={`${formatDayLong(date)}: ${n} due${d?.done ? `, ${d.done} done` : ''}${overdue ? `, ${d!.open} overdue` : ''}`}
                          onMouseEnter={(e) => { const b = e.currentTarget.getBoundingClientRect(), p = box.current!.getBoundingClientRect(); setHover({ date, x: b.left - p.left + cell / 2, y: b.bottom - p.top + 6 }); }}
                          onFocus={(e) => { const b = e.currentTarget.getBoundingClientRect(), p = box.current!.getBoundingClientRect(); setHover({ date, x: b.left - p.left + cell / 2, y: b.bottom - p.top + 6 }); }}
                          onBlur={() => setHover(null)}
                          onClick={() => navigate(`/calendar?view=day&date=${date}`)}
                          className={cn('relative rounded-[4px] transition-transform hover:scale-110 focus-visible:outline-offset-1', !n && 'bg-sunken', date === today && 'ring-2 ring-ink ring-offset-1 ring-offset-surface')}
                          style={{ width: cell, height: cell, ...(n ? { background: `color-mix(in oklab, var(--c-accent) ${OPACITY[level(n)] * 100}%, var(--c-surface))` } : {}) }}>
                          {overdue && <span aria-hidden className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-danger ring-2 ring-surface" />}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
          {hover && (() => {
            const d = days.get(hover.date);
            return (
              <Tip x={hover.x} y={Math.min(hover.y, size.h - 70)} width={size.w}>
                <p className="font-medium text-ink">{formatDayLong(hover.date)}{hover.date === today && ' · today'}</p>
                {d ? <>
                  <TipRow label="Due" value={d.due} />
                  {d.done > 0 && <TipRow label="Done" value={d.done} />}
                  {d.open > 0 && <TipRow label={hover.date < today ? 'Overdue' : 'Open'} value={d.open} />}
                </> : <p className="text-ink-3">Nothing due</p>}
              </Tip>
            );
          })()}
        </div>
      </div>
    </Frame>
  );
}

// ── This month's pace ──────────────────────────────────────────────────────────

export function PaceWidget() {
  const { snap, today } = useStore();
  const [box, size] = useSize<HTMLDivElement>();
  const pace = useMemo(() => monthPace(snap.occurrences, today), [snap.occurrences, today]);
  const [hover, setHover] = useState<number | null>(null);
  const n = pace.days.length;
  const ti = pace.days.findIndex((d) => d.date === today);
  const dueNow = pace.days[ti]?.due ?? 0;
  const doneNow = pace.days[ti]?.done ?? 0;
  const gapNow = dueNow - doneNow;
  const { max, step } = niceMax(pace.total);
  const W = Math.max(0, size.w - 30), H = Math.max(0, size.h - 18);
  const x = (i: number) => 30 + (n <= 1 ? 0 : (i / (n - 1)) * W);
  const y = (v: number) => H - (v / max) * H;
  const path = (vals: (number | null)[]) => vals.map((v, i) => (v === null ? '' : `${i === 0 || vals[i - 1] === null ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`)).join('');
  const dueLine = path(pace.days.map((d) => d.due));
  const doneVals = pace.days.map((d) => d.done);
  const doneLine = path(doneVals);
  const doneArea = ti >= 0 ? `${doneLine}L${x(ti)},${H}L${x(0)},${H}Z` : '';
  const monthName = new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' }).format(new Date(`${today}T12:00:00Z`));

  return (
    <Frame title={`${monthName}’s pace`} count={`${pace.doneNow} of ${pace.total} done`} padded>
      <div className="flex h-full min-h-[150px] flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-[12.5px] text-ink-3">
            {pace.total === 0 ? 'Nothing due this month.' : gapNow <= 0 ? <><span className="font-medium text-ok">On pace</span>: everything due so far is done</>
              : <><span className="num font-medium text-ink">{gapNow}</span> due so far still open</>}
          </p>
          <Legend items={[{ label: 'Due by then', color: 'var(--c-ink-3)' }, { label: 'Done', color: 'var(--c-accent)' }]} />
        </div>
        <div ref={box} className="relative mt-1.5 min-h-0 flex-1"
          onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); setHover(Math.max(0, Math.min(n - 1, Math.round(((e.clientX - r.left - 30) / Math.max(1, W)) * (n - 1))))); }}
          onMouseLeave={() => setHover(null)}>
          {size.w > 0 && <>
            <div className="absolute inset-x-0 top-0" style={{ height: H }}><Grid max={max} step={step} height={H} /></div>
            <svg className="absolute inset-0 overflow-visible" width={size.w} height={H} aria-hidden>
              {ti >= 0 && <line x1={x(ti)} x2={x(ti)} y1={0} y2={H} stroke="var(--c-line-strong)" strokeWidth={1} />}
              <path d={doneArea} fill="var(--c-accent)" opacity={0.1} />
              <path d={dueLine} fill="none" stroke="var(--c-ink-3)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              <path d={doneLine} fill="none" stroke="var(--c-accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {ti >= 0 && <circle cx={x(ti)} cy={y(doneNow)} r={4.5} fill="var(--c-accent)" stroke="var(--c-surface)" strokeWidth={2} />}
              {hover !== null && <>
                <line x1={x(hover)} x2={x(hover)} y1={0} y2={H} stroke="var(--c-ink-3)" strokeWidth={1} />
                <circle cx={x(hover)} cy={y(pace.days[hover].due)} r={4} fill="var(--c-ink-3)" stroke="var(--c-surface)" strokeWidth={2} />
                {pace.days[hover].done !== null && <circle cx={x(hover)} cy={y(pace.days[hover].done!)} r={4} fill="var(--c-accent)" stroke="var(--c-surface)" strokeWidth={2} />}
              </>}
            </svg>
            <div aria-hidden className="num absolute right-0 bottom-0 left-[30px] flex justify-between text-[10.5px] text-ink-3">
              <span>1</span>{ti > 2 && ti < n - 3 && <span className="absolute font-medium text-ink-2" style={{ left: x(ti) - 30, transform: 'translateX(-50%)' }}>Today</span>}<span>{n}</span>
            </div>
            {hover !== null && (
              <Tip x={x(hover)} y={0} width={size.w}>
                <p className="mb-1 font-medium text-ink">{formatDayLong(pace.days[hover].date)}</p>
                <TipRow color="var(--c-ink-3)" label="Due by then" value={pace.days[hover].due} />
                <TipRow color="var(--c-accent)" label="Done" value={pace.days[hover].done ?? '—'} />
              </Tip>
            )}
          </>}
          <table className="sr-only">
            <caption>Tasks due this month by each day, and how many were done by then</caption>
            <thead><tr><th>Day</th><th>Due by then</th><th>Done by then</th></tr></thead>
            <tbody>{pace.days.filter((_, i) => i % 7 === 0 || i === ti || i === n - 1).map((d) => <tr key={d.date}><td>{formatDate(d.date)}</td><td>{d.due}</td><td>{d.done ?? '—'}</td></tr>)}</tbody>
          </table>
        </div>
      </div>
    </Frame>
  );
}

// ── On time ────────────────────────────────────────────────────────────────────

export function OnTimeWidget() {
  const { snap, today } = useStore();
  const r = useMemo(() => onTimeRate(snap.occurrences, today), [snap.occurrences, today]);
  const delta = r.rate !== null && r.previous !== null ? Math.round((r.rate - r.previous) * 100) : null;
  const pts = r.weekly.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v !== null);
  const sx = (i: number) => (i / 11) * 100, sy = (v: number) => 30 - v * 28 - 1;
  const spark = pts.map((p, k) => `${k ? 'L' : 'M'}${sx(p.i).toFixed(1)},${sy(p.v).toFixed(1)}`).join('');
  const lastPt = pts[pts.length - 1];
  return (
    <Frame title="On time" count="last 90 days" padded>
      <div className="flex h-full min-h-[96px] flex-col gap-2">
        {r.rate === null ? <p className="text-[12.5px] text-ink-3">Finish a few tasks and the share done by their due date shows here.</p> : <>
          <div className="flex items-end gap-3">
            <span className="text-[34px] leading-none font-semibold tracking-[-0.03em]">{pct(r.rate)}</span>
            {delta !== null && (
              <span className={cn('mb-1 inline-flex items-center gap-0.5 text-[12px] font-medium', delta > 0 ? 'text-ok' : delta < 0 ? 'text-danger' : 'text-ink-3')}>
                {delta > 0 ? <ArrowUpRight className="size-3.5" /> : delta < 0 ? <ArrowDownRight className="size-3.5" /> : <Minus className="size-3.5" />}
                {delta > 0 ? '+' : ''}{delta} pts <span className="font-normal text-ink-3">vs the 90 days before</span>
              </span>
            )}
          </div>
          <p className="text-[12px] text-ink-3"><span className="num text-ink-2">{r.finished}</span> finished, <span className="num text-ink-2">{Math.round(r.rate * r.finished)}</span> of them by the due date</p>
          {pts.length > 1 && (
            <div className="mt-auto flex min-h-8 flex-1 flex-col pt-1">
              <div className="relative min-h-0 flex-1">
                <svg viewBox="0 0 100 31" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" role="img" aria-label={`On-time share per week, last 12 weeks: ${r.weekly.map((v) => (v === null ? 'none' : pct(v))).join(', ')}`}>
                  <line x1={0} x2={100} y1={sy(1)} y2={sy(1)} stroke="var(--c-line)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                  <path d={spark} fill="none" stroke="var(--c-ink-3)" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
                </svg>
                {lastPt && <span aria-hidden className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent ring-2 ring-surface" style={{ left: `${sx(lastPt.i)}%`, top: `${(sy(lastPt.v) / 31) * 100}%` }} />}
              </div>
              <p className="mt-1 flex justify-between text-[10.5px] text-ink-3"><span>12 weeks ago</span><span>100% line · this week</span></p>
            </div>
          )}
        </>}
      </div>
    </Frame>
  );
}

// ── Open work by type ──────────────────────────────────────────────────────────

export function MixWidget() {
  const { snap, today } = useStore();
  const { navigate } = useRoute();
  const mix = useMemo(() => typeMix(snap.occurrences, today), [snap.occurrences, today]);
  const total = mix.reduce((n, m) => n + m.open, 0);
  const [hover, setHover] = useState<TypeGroup | null>(null);
  return (
    <Frame title="Open work by type" count={total} padded>
      {total === 0 ? <p className="text-[12.5px] text-ink-3">No open tasks.</p> : (
        <div className="flex flex-col gap-3">
          {/* One whole, split into its parts, a 2px surface gap between them. */}
          <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full" role="img" aria-label={mix.map((m) => `${GROUP_LABEL[m.group]} ${m.open}`).join(', ')}>
            {mix.map((m) => <span key={m.group} className={cn('h-full transition-opacity', hover && hover !== m.group && 'opacity-35')} style={{ flexGrow: m.open, flexBasis: 0, minWidth: 3, background: COLOR[m.group] }} />)}
          </div>
          <ul className="flex flex-col">
            {mix.map((m) => (
              <li key={m.group}>
                <button type="button" onMouseEnter={() => setHover(m.group)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(m.group)} onBlur={() => setHover(null)}
                  onClick={() => navigate(`/tasks?type=${GROUP_TYPES[m.group]}`)}
                  className="-mx-2 flex w-[calc(100%+16px)] items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-hover">
                  <Swatch color={COLOR[m.group]} />
                  <span className="min-w-0 flex-1 truncate">{GROUP_LABEL[m.group]}</span>
                  {m.overdue > 0 && <span className="text-[11.5px] text-danger">{m.overdue} overdue</span>}
                  <span className="num w-8 text-right font-medium">{m.open}</span>
                  <span className="num w-10 text-right text-[12px] text-ink-3">{pct(m.open / total)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Frame>
  );
}

// ── Busiest clients ────────────────────────────────────────────────────────────

export function ClientLoadWidget() {
  const { snap, today, clientById } = useStore();
  const rows = useMemo(() => clientLoad(snap.occurrences, today, 30).filter((r) => clientById.get(r.clientId)?.status === 'active'), [snap.occurrences, today, clientById]);
  const max = Math.max(1, ...rows.map((r) => r.open));
  return (
    <Frame title="Busiest clients" count="next 30 days" padded>
      {rows.length === 0 ? <p className="text-[12.5px] text-ink-3">Nothing due in the next 30 days.</p> : (
        <div className="flex flex-col gap-2.5">
          <Legend items={[{ label: 'Due in 30 days', color: 'var(--viz-1)' }, { label: 'Overdue', color: 'var(--c-danger)' }]} />
          <ul className="flex flex-col gap-1">
            {rows.map((r) => {
              const c = clientById.get(r.clientId)!;
              return (
                <li key={r.clientId}>
                  <ClientBar name={c.name} id={r.clientId} open={r.open} overdue={r.overdue} soon={r.soon} next={r.next} max={max} />
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Frame>
  );
}

function ClientBar({ name, id, open, overdue, soon, next, max }: { name: string; id: string; open: number; overdue: number; soon: number; next: ISODate | null; max: number }) {
  const { navigate } = useRoute();
  return (
    <button type="button" onClick={() => navigate(`/clients/${id}`)} title={`${name}: ${soon} due in the next 30 days${overdue ? `, ${overdue} overdue` : ''}${next ? `. Next ${formatDate(next)}` : ''}`}
      aria-label={`${name}: ${soon} due in the next 30 days${overdue ? `, ${overdue} overdue` : ''}. Open the client`}
      className="group -mx-2 grid w-[calc(100%+16px)] grid-cols-[minmax(0,38%)_1fr] items-center gap-3 rounded-md px-2 py-1 text-left hover:bg-hover">
      <span className="truncate text-[12.5px]">{name}</span>
      <span className="flex min-w-0 items-center gap-2">
        <span className="flex h-2.5 min-w-0 gap-[2px]" style={{ width: `${(open / max) * 100}%` }}>
          {overdue > 0 && <span className={cn('h-full bg-danger', !soon && 'rounded-r-[4px]')} style={{ flexGrow: overdue, flexBasis: 0, minWidth: 3 }} />}
          {soon > 0 && <span className="h-full rounded-r-[4px] bg-(--viz-1)" style={{ flexGrow: soon, flexBasis: 0, minWidth: 3 }} />}
        </span>
        <span className="num shrink-0 text-[12px] font-medium">{open}</span>
      </span>
    </button>
  );
}
