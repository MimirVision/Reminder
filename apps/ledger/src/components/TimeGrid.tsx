// The calendar's week and day views: tasks along the top (they have a day, not a time), and below them the hours of
// the day with meetings placed at their time. Click an empty slot to book a meeting there; drag a meeting to move it.
import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type MouseEvent, type ReactNode } from 'react';
import { MapPin } from 'lucide-react';
import { useStore } from '../data/store';
import type { ISODate } from '../lib/dates';
import { formatDayLong, formatWeekdayShort } from '../lib/format';
import { durationMinutes, fromMinutes, layoutDay, toMinutes } from '../lib/meetings';
import { parts, weekday } from '../lib/dates';
import type { Meeting } from '../lib/types';
import { cn } from '../ui/cn';
import { useUI } from './ui-state';

export const HOUR_PX = 48;
const SNAP = 15;
const snap = (min: number) => Math.round(min / SNAP) * SNAP;

/** Minutes since midnight, now, ticking every minute. */
function useNowMinutes() {
  const [n, setN] = useState(() => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); });
  useEffect(() => {
    const t = window.setInterval(() => { const d = new Date(); setN(d.getHours() * 60 + d.getMinutes()); }, 60_000);
    return () => window.clearInterval(t);
  }, []);
  return n;
}

export function TimeGrid({ days, meetings, today, holiday, taskCell, onTaskDrop, taskDropTarget, setTaskDropTarget }: {
  days: ISODate[];
  meetings: Meeting[];
  today: ISODate;
  holiday: (d: ISODate) => string | null;
  /** The tasks of a day, for the row above the hours. */
  taskCell: (d: ISODate) => ReactNode;
  onTaskDrop: (e: DragEvent, d: ISODate) => void;
  taskDropTarget: ISODate | null;
  setTaskDropTarget: (d: ISODate | null) => void;
}) {
  const ui = useUI();
  const { run, clientById } = useStore();
  const now = useNowMinutes();
  const scroller = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ day: ISODate; min: number } | null>(null);
  const [dropAt, setDropAt] = useState<{ day: ISODate; min: number; len: number } | null>(null);
  const grab = useRef<{ id: string; offset: number; len: number } | null>(null);

  const byDay = new Map<ISODate, Meeting[]>();
  for (const m of meetings) { const l = byDay.get(m.date) ?? []; l.push(m); byDay.set(m.date, l); }

  // Open on the working day: 07:00, or earlier if a meeting starts earlier.
  const firstStart = Math.min(7 * 60, ...meetings.filter((m) => days.includes(m.date)).map((m) => toMinutes(m.start)));
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = Math.max(0, (firstStart / 60) * HOUR_PX - 8);
  }, [days[0], days.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const minuteAt = (e: { clientY: number }, el: HTMLElement) => {
    const y = e.clientY - el.getBoundingClientRect().top;
    return Math.max(0, Math.min(24 * 60 - SNAP, (y / HOUR_PX) * 60));
  };

  const book = (e: MouseEvent<HTMLDivElement>, day: ISODate) => {
    if (e.target !== e.currentTarget) return;
    const start = Math.min(Math.floor(minuteAt(e, e.currentTarget) / 30) * 30, 23 * 60);
    ui.openMeeting({ mode: 'new', date: day, start: fromMinutes(start), end: fromMinutes(Math.min(start + 60, 23 * 60 + 59)) });
  };

  const onDragOver = (e: DragEvent<HTMLDivElement>, day: ISODate) => {
    if (!e.dataTransfer.types.includes('text/ledger-meeting') || !grab.current) return;
    e.preventDefault();
    const min = Math.max(0, Math.min(24 * 60 - grab.current.len, snap(minuteAt(e, e.currentTarget) - grab.current.offset)));
    setDropAt({ day, min, len: grab.current.len });
  };
  const onDrop = (e: DragEvent<HTMLDivElement>, day: ISODate) => {
    e.preventDefault();
    const g = grab.current, at = dropAt;
    grab.current = null;
    setDropAt(null);
    if (!g || !at) return;
    const m = meetings.find((x) => x.id === g.id);
    const start = fromMinutes(at.min), end = fromMinutes(Math.min(at.min + g.len, 23 * 60 + 59));
    if (!m || (m.date === day && m.start === start)) return;
    void run((r) => r.updateMeeting(g.id, { date: day, start, end }), { success: `Moved to ${formatDayLong(day)} at ${start}` });
  };

  const cols = `56px repeat(${days.length}, minmax(0, 1fr))`;
  return (
    // Seven days need room: on a narrow screen the week scrolls sideways instead of squeezing every day to a sliver.
    <div className="overflow-x-auto rounded-xl border border-line bg-surface">
    <div className={cn(days.length > 1 && 'min-w-[720px]')}>
      {/* Day headers */}
      <div className="grid border-b border-line" style={{ gridTemplateColumns: cols }}>
        <div />
        {days.map((d) => {
          const h = holiday(d);
          return (
            <div key={d} className="flex min-w-0 items-baseline gap-1.5 border-l border-line px-2 py-1.5">
              <span className="text-[11.5px] font-medium text-ink-3">{formatWeekdayShort(d)}</span>
              <span className={cn('num text-[13px]', d === today ? 'rounded-full bg-accent px-1.5 font-semibold text-on-accent' : 'text-ink-2')}>{parts(d)[2]}</span>
              {h && <span className="truncate text-[11px] text-ink-3" title="Public holiday">{h}</span>}
            </div>
          );
        })}
      </div>
      {/* Tasks: they belong to a day, not a time */}
      <div className="grid border-b border-line bg-canvas/40" style={{ gridTemplateColumns: cols }}>
        <div className="px-2 py-1.5 text-right text-[11px] text-ink-3">Tasks</div>
        {days.map((d) => (
          <div key={d}
            onDragOver={(e) => { if (e.dataTransfer.types.includes('text/ledger-task')) { e.preventDefault(); setTaskDropTarget(d); } }}
            onDragLeave={() => setTaskDropTarget(null)}
            onDrop={(e) => onTaskDrop(e, d)}
            className={cn('flex max-h-40 min-h-9 min-w-0 flex-col gap-0.5 overflow-y-auto border-l border-line p-1', taskDropTarget === d && 'bg-accent-soft ring-2 ring-accent/40 ring-inset')}>
            {taskCell(d)}
          </div>
        ))}
      </div>
      {/* Hours */}
      <div ref={scroller} className="relative max-h-[calc(100vh-330px)] min-h-[420px] overflow-y-auto" aria-label="Meetings by time of day">
        <div className="grid" style={{ gridTemplateColumns: cols, height: 24 * HOUR_PX }}>
          <div className="relative">
            {Array.from({ length: 23 }, (_, i) => (
              <span key={i} className="num absolute right-2 -translate-y-1/2 text-[11px] text-ink-3" style={{ top: (i + 1) * HOUR_PX }}>{fromMinutes((i + 1) * 60)}</span>
            ))}
          </div>
          {days.map((d) => {
            const list = byDay.get(d) ?? [];
            const lanes = layoutDay(list);
            const weekend = weekday(d) >= 6;
            return (
              <div key={d} role="group" aria-label={`${formatDayLong(d)}: ${list.length} meeting${list.length === 1 ? '' : 's'}`}
                onClick={(e) => book(e, d)}
                onMouseMove={(e) => { if (e.target === e.currentTarget) setHover({ day: d, min: Math.floor(minuteAt(e, e.currentTarget) / 30) * 30 }); else setHover(null); }}
                onMouseLeave={() => setHover(null)}
                onDragOver={(e) => onDragOver(e, d)} onDragLeave={() => setDropAt((x) => (x?.day === d ? null : x))} onDrop={(e) => onDrop(e, d)}
                className={cn('relative cursor-pointer border-l border-line', (weekend || holiday(d)) && 'bg-canvas/50', d === today && 'bg-accent-soft/20')}
                style={{ backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${HOUR_PX - 1}px, var(--c-line) ${HOUR_PX - 1}px, var(--c-line) ${HOUR_PX}px)` }}>
                {hover?.day === d && !dropAt && (
                  <div aria-hidden className="pointer-events-none absolute inset-x-1 rounded-md border border-dashed border-accent/50 bg-accent-soft/40 px-1.5 text-[11px] text-accent-ink"
                    style={{ top: (hover.min / 60) * HOUR_PX, height: HOUR_PX - 2 }}>
                    <span className="num">{fromMinutes(hover.min)}</span> New meeting
                  </div>
                )}
                {dropAt?.day === d && (
                  <div aria-hidden className="pointer-events-none absolute inset-x-1 rounded-md border-2 border-accent bg-accent-soft/60"
                    style={{ top: (dropAt.min / 60) * HOUR_PX, height: Math.max(18, (dropAt.len / 60) * HOUR_PX - 2) }}>
                    <span className="num px-1.5 text-[11px] text-accent-ink">{fromMinutes(dropAt.min)}</span>
                  </div>
                )}
                {list.map((m) => {
                  const pos = lanes.get(m.id) ?? { lane: 0, lanes: 1 };
                  const len = durationMinutes(m);
                  // Under 75 minutes the time sits beside the title, leaving a line for the client.
                  const short = len < 75;
                  const client = m.clientId ? clientById.get(m.clientId)?.name : null;
                  return (
                    <button key={m.id} draggable
                      onDragStart={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        grab.current = { id: m.id, offset: snap(((e.clientY - rect.top) / HOUR_PX) * 60), len };
                        e.dataTransfer.setData('text/ledger-meeting', m.id);
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      onDragEnd={() => { grab.current = null; setDropAt(null); }}
                      onClick={(e) => { e.stopPropagation(); ui.openMeeting({ mode: 'edit', id: m.id }); }}
                      title={`${m.start}–${m.end} ${m.title}${client ? ` · ${client}` : ''}${m.location ? ` · ${m.location}` : ''}`}
                      aria-label={`${m.title}, ${m.start} to ${m.end}${client ? `, ${client}` : ''}. Open meeting`}
                      className="absolute flex cursor-grab flex-col overflow-hidden rounded-md border-l-[3px] border-accent bg-accent-soft px-1.5 py-0.5 text-left text-[11.5px] leading-tight text-ink shadow-soft transition-[filter] hover:brightness-[0.97] active:cursor-grabbing"
                      style={{
                        top: (toMinutes(m.start) / 60) * HOUR_PX + 1,
                        height: Math.max(18, (len / 60) * HOUR_PX - 2),
                        left: `calc(${(pos.lane / pos.lanes) * 100}% + 2px)`,
                        width: `calc(${100 / pos.lanes}% - 4px)`,
                      }}>
                      <span className={cn('flex min-w-0 gap-1', short ? 'items-center' : 'flex-col')}>
                        <span className="truncate font-semibold">{m.title}</span>
                        <span className="num shrink-0 text-[11px] text-accent-ink">{m.start}{!short && `–${m.end}`}</span>
                      </span>
                      {len >= 45 && client && <span className="truncate text-[11px] text-ink-2">{client}</span>}
                      {len >= 75 && m.location && <span className="flex min-w-0 items-center gap-1 truncate text-[11px] text-ink-3"><MapPin className="size-3 shrink-0" />{m.location}</span>}
                    </button>
                  );
                })}
                {d === today && (
                  <div aria-hidden className="pointer-events-none absolute inset-x-0 z-10 flex items-center" style={{ top: (now / 60) * HOUR_PX }}>
                    <span className="-ml-1 size-2 rounded-full bg-danger" /><span className="h-px flex-1 bg-danger" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
    </div>
  );
}
