// The month: six weeks that fill the screen, week numbers down the side, and in each day its meetings, its open work
// (the same task for several clients folded into one "×4" chip) and how much is already done. As many lines show
// as the day has room for; the rest is one click away.
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { Check, ListChecks, Plus, Users } from 'lucide-react';
import { useStore } from '../../data/store';
import { isoWeek, parts, type ISODate } from '../../lib/dates';
import { formatDayLong } from '../../lib/format';
import { holidayName } from '../../lib/holidays';
import { isOpen, type Meeting, type Occurrence } from '../../lib/types';
import { cn } from '../../ui/cn';
import { Menu, MenuItem, Popover } from '../../ui/overlay';
import { useUI } from '../ui-state';
import { GroupChip, MeetingChip, TaskChip, groupDay } from './chips';

const LINE = 22; // px per chip line, gap included

export function MonthView({ days, month, today, byDay, meetingsOn, dropTarget, dropProps, openDay, openWeek }: {
  days: ISODate[];
  month: number;
  today: ISODate;
  byDay: Map<ISODate, Occurrence[]>;
  meetingsOn: (d: ISODate) => Meeting[];
  dropTarget: ISODate | null;
  dropProps: (d: ISODate) => { onDragOver: (e: DragEvent) => void; onDragLeave: () => void; onDrop: (e: DragEvent) => void };
  openDay: (d: ISODate) => void;
  openWeek: (d: ISODate) => void;
}) {
  const ui = useUI();
  const { repo, calendar } = useStore();
  // How many lines fit in a day: from the grid's height, which follows the window.
  const grid = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState(4);
  useEffect(() => {
    const el = grid.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setLines(Math.max(2, Math.floor((e.contentRect.height / 6 - 34) / LINE))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const weeks = Array.from({ length: days.length / 7 }, (_, i) => days.slice(i * 7, i * 7 + 7));

  return (
    <div className="flex flex-col overflow-clip rounded-xl border border-line bg-surface sm:h-[max(640px,calc(100dvh-236px))]">
      <div className="grid grid-cols-[repeat(7,minmax(0,1fr))] border-b border-line sm:grid-cols-[36px_repeat(7,minmax(0,1fr))]">
        <div className="hidden sm:block" />
        {weeks[0].map((d) => (
          <div key={d} className="px-2 py-1.5 text-[11.5px] font-medium text-ink-3">
            {new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`))}
          </div>
        ))}
      </div>
      <div ref={grid} className="grid min-h-0 flex-1 grid-cols-[repeat(7,minmax(0,1fr))] sm:grid-cols-[36px_repeat(7,minmax(0,1fr))] sm:grid-rows-6">
        {weeks.map((week) => [
          <button key={`w${week[0]}`} onClick={() => openWeek(week[0])} title={`Open week ${isoWeek(week[0]).week}`}
            className="num hidden border-r border-b border-line pt-2 text-center text-[11px] text-ink-3 hover:bg-hover hover:text-ink sm:block">
            {isoWeek(week[0]).week}
          </button>,
          ...week.map((d, i) => {
            const list = byDay.get(d) ?? [];
            const dayMeetings = meetingsOn(d);
            const openItems = groupDay(list.filter((t) => isOpen(t.status)));
            const closed = list.filter((t) => !isOpen(t.status));
            const outside = parts(d)[1] !== month;
            const weekend = i >= 5;
            const holiday = holidayName(d, calendar);
            const openCount = list.length - closed.length;
            // Meetings, then open work; what doesn't fit (and finished work) folds into one line.
            const items = [...dayMeetings.map((m) => ({ key: m.id, el: <MeetingChip key={m.id} m={m} /> })),
              ...openItems.map((x) => (Array.isArray(x)
                ? { key: `g${x[0].id}`, el: <GroupChip key={`g${x[0].id}`} tasks={x} today={today} /> }
                : { key: x.id, el: <TaskChip key={x.id} task={x} today={today} compact /> }))];
            const fit = items.length + (closed.length ? 1 : 0) > lines ? Math.max(0, lines - 1) : items.length;
            const hidden = items.length - fit;
            return (
              <div key={d} {...dropProps(d)}
                onDoubleClick={(e) => { if (e.target === e.currentTarget) ui.openNewTask({ dueDate: d }); }}
                className={cn('group/cell relative flex min-h-16 min-w-0 flex-col gap-0.5 overflow-hidden border-r border-b border-line p-1 [&:nth-child(8n)]:border-r-0 sm:min-h-0',
                  (weekend || holiday) && 'bg-canvas/50', outside && 'bg-canvas/70 [&>*]:opacity-70', d === today && 'bg-accent-soft/35', dropTarget === d && 'bg-accent-soft ring-2 ring-accent/40 ring-inset')}
                aria-label={`${formatDayLong(d)}${holiday ? `, ${holiday}` : ''}: ${list.length} task${list.length === 1 ? '' : 's'}${dayMeetings.length ? `, ${dayMeetings.length} meeting${dayMeetings.length === 1 ? '' : 's'}` : ''}`}>
                <div className="mb-0.5 flex shrink-0 items-center gap-1 px-1">
                  <button onClick={() => openDay(d)} aria-label={`Open ${formatDayLong(d)}`}
                    className={cn('tnum flex size-[22px] items-center justify-center rounded-full text-[12px] hover:ring-2 hover:ring-line-strong',
                      d === today ? 'bg-accent font-semibold text-on-accent' : outside ? 'text-ink-3/60' : 'text-ink-2')}>{parts(d)[2]}</button>
                  {holiday && <span className="truncate text-[11px] text-ink-3" title="Public holiday">{holiday}</span>}
                  {/* How busy the day is, at the right; on hover the same place offers "add". */}
                  <span className="ml-auto" />
                  {openCount > 2 && <span className="num text-[11px] text-ink-3" title={`${openCount} open tasks`}>{openCount} open</span>}
                  <Menu label={`Add on ${formatDayLong(d)}`} align="end" trigger={
                    <button aria-label={`Add on ${formatDayLong(d)}`}
                      className="flex size-[22px] items-center justify-center rounded-md text-ink-3 opacity-0 transition-opacity group-hover/cell:opacity-100 hover:bg-hover hover:text-ink focus-visible:opacity-100 data-[state=open]:opacity-100">
                      <Plus className="size-3.5" />
                    </button>
                  }>
                    <MenuItem onSelect={() => ui.openNewTask({ dueDate: d })}><ListChecks /> Task</MenuItem>
                    {repo.meetings && <MenuItem onSelect={() => ui.openMeeting({ mode: 'new', date: d })}><Users /> Meeting</MenuItem>}
                  </Menu>
                </div>
                {/* On a phone a cell is too narrow for titles: dots show what the day holds, and a tap opens it. */}
                {(dayMeetings.length > 0 || openCount > 0) && (
                  <button onClick={() => openDay(d)} aria-label={`Open ${formatDayLong(d)}`} className="flex flex-wrap gap-0.5 px-1 sm:hidden">
                    {dayMeetings.slice(0, 4).map((m) => <span key={m.id} className="size-1.5 rounded-full bg-accent" />)}
                    {list.filter((t) => isOpen(t.status)).slice(0, 4).map((t) => <span key={t.id} className={cn('size-1.5 rounded-full', t.dueDate < today ? 'bg-danger' : 'bg-ink-3/60')} />)}
                  </button>
                )}
                <div className="flex min-h-0 flex-col gap-0.5 max-sm:hidden">
                  {items.slice(0, fit).map((x) => x.el)}
                  {(hidden > 0 || closed.length > 0) && (
                    <Popover trigger={
                      <button className="flex h-5 max-w-full shrink-0 items-center gap-1 overflow-hidden rounded px-1.5 text-left text-[11.5px] font-medium whitespace-nowrap text-ink-3 hover:bg-hover hover:text-ink">
                        {hidden > 0 ? `+${hidden} more` : <><Check className="size-3 text-ok" strokeWidth={3} />{closed.length} done</>}
                        {hidden > 0 && closed.length > 0 && <span className="font-normal">· {closed.length} done</span>}
                      </button>
                    }>
                      <div className="w-80 p-2">
                        <div className="mb-1.5 flex items-center px-1 text-[12.5px] font-semibold">
                          {formatDayLong(d)}
                          <button onClick={() => openDay(d)} className="ml-auto text-[12px] font-normal text-accent hover:underline">Open day</button>
                        </div>
                        <div className="flex max-h-96 flex-col gap-0.5 overflow-y-auto">
                          {items.map((x) => x.el)}
                          {closed.map((t) => <TaskChip key={t.id} task={t} today={today} />)}
                        </div>
                      </div>
                    </Popover>
                  )}
                </div>
              </div>
            );
          }),
        ])}
      </div>
    </div>
  );
}
