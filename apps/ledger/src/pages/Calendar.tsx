import { useMemo, useState, type DragEvent } from 'react';
import { AlertTriangle, Check, ChevronLeft, ChevronRight, ListChecks, Plus, Users } from 'lucide-react';
import { TimeGrid } from '../components/TimeGrid';
import { sortMeetings } from '../lib/meetings';
import { FilterMenu } from '../components/FilterMenu';
import { Page } from '../components/Shell';
import { holidayName } from '../lib/holidays';
import { useUI } from '../components/ui-state';
import { useStore } from '../data/store';
import { addDays, addMonths, isoWeek, isISODate, monthGrid, parts, startOfMonth, startOfWeek, type ISODate } from '../lib/dates';
import { formatDate, formatDayLong, formatMonth, formatWeekdayShort } from '../lib/format';
import { PRIORITY_RANK, STATUS_LABEL, TYPE_LABEL } from '../lib/labels';
import { isOpen, TASK_STATUSES, TASK_TYPES, type Meeting, type Occurrence, type TaskStatus } from '../lib/types';
import { useRoute } from '../router';
import { Button, IconButton } from '../ui/button';
import { cn } from '../ui/cn';
import { Segmented } from '../ui/field';
import { Menu, MenuItem, Popover } from '../ui/overlay';

type View = 'month' | 'week' | 'day';

function Chip({ task, today, compact, stacked }: { task: Occurrence; today: ISODate; compact?: boolean; stacked?: boolean }) {
  const ui = useUI();
  const { clientById } = useStore();
  const open = isOpen(task.status);
  const overdue = open && task.dueDate < today;
  const client = clientById.get(task.clientId)?.name ?? '';
  const state = overdue ? 'Overdue' : task.status === 'done' ? 'Done' : task.status === 'cancelled' ? 'Cancelled' : STATUS_LABEL[task.status];
  return (
    <button
      draggable={open}
      onDragStart={(e) => { e.dataTransfer.setData('text/ledger-task', task.id); e.dataTransfer.effectAllowed = 'move'; }}
      onClick={() => ui.openTask(task.id)}
      title={`${task.title} · ${client} · ${state}`}
      aria-label={`${task.title}, ${client}, ${state}. Open task`}
      className={cn(
        'group flex w-full min-w-0 gap-1.5 rounded-[5px] border-l-2 px-1.5 text-left text-[12px] transition-colors',
        stacked ? 'items-start py-1 leading-[16px]' : 'items-center leading-[20px]',
        overdue ? 'border-danger bg-danger-soft text-danger hover:brightness-[0.98]'
          : !open ? 'border-transparent text-ink-3 hover:bg-hover'
          : task.status === 'waiting' ? 'border-warn bg-sunken text-ink hover:bg-hover'
          : 'border-accent/70 bg-sunken text-ink hover:bg-hover',
        open && 'cursor-grab active:cursor-grabbing',
      )}
    >
      {overdue ? <AlertTriangle className={cn('size-3 shrink-0', stacked && 'mt-0.5')} /> : task.status === 'done' ? <Check className={cn('size-3 shrink-0 text-ok', stacked && 'mt-0.5')} strokeWidth={3} /> : null}
      {stacked ? (
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={cn('line-clamp-2 font-medium', task.status === 'cancelled' && 'line-through')}>{task.title}</span>
          <span className={cn('truncate text-[11.5px]', overdue ? 'text-danger/75' : 'text-ink-3')}>{client}</span>
        </span>
      ) : (
        <span className={cn('min-w-0 flex-1 truncate', task.status === 'cancelled' && 'line-through', task.status === 'done' && 'line-through decoration-ink-3/50')}>
          {task.title}
          {!compact && <span className={cn('ml-1', overdue ? 'text-danger/75' : 'text-ink-3')}>{client}</span>}
        </span>
      )}
    </button>
  );
}

const ORDER: Record<TaskStatus, number> = { todo: 1, in_progress: 1, waiting: 1, done: 2, cancelled: 3 };
const sortDay = (a: Occurrence, b: Occurrence) => ORDER[a.status] - ORDER[b.status] || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.title.localeCompare(b.title);

/** A meeting in a month cell: its start time and title. */
function MeetingChip({ m }: { m: Meeting }) {
  const ui = useUI();
  const { clientById } = useStore();
  const client = m.clientId ? clientById.get(m.clientId)?.name : null;
  return (
    <button onClick={() => ui.openMeeting({ mode: 'edit', id: m.id })} title={`${m.start}–${m.end} ${m.title}${client ? ` · ${client}` : ''}`}
      aria-label={`Meeting ${m.title} at ${m.start}${client ? `, ${client}` : ''}. Open meeting`}
      className="flex w-full min-w-0 items-center gap-1.5 rounded-[5px] px-1.5 text-left text-[12px] leading-[20px] text-ink hover:bg-accent-soft">
      <span className="size-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
      <span className="num shrink-0 text-[11px] text-accent-ink">{m.start}</span>
      <span className="min-w-0 flex-1 truncate">{m.title}</span>
    </button>
  );
}

export function Calendar() {
  const { snap, today, patchOccurrence, calendar, repo } = useStore();
  const ui = useUI();
  const { query } = useRoute();
  // Links can carry anything: unknown views and dates fall back instead of breaking the page.
  const asView = (v: string | null | undefined): View | null => (v === 'month' || v === 'week' || v === 'day' ? v : null);
  const [view, setView] = useState<View>(asView(query.get('view')) ?? asView(snap.workspace.settings.defaultCalendarView) ?? 'month');
  const [cursor, setCursor] = useState<ISODate>(() => { const d = query.get('date'); return d && isISODate(d) ? d : today; });
  const [clients, setClients] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<TaskStatus[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  const [dropTarget, setDropTarget] = useState<ISODate | null>(null);

  const days = view === 'month' ? monthGrid(cursor) : view === 'day' ? [cursor] : Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(cursor), i));
  const first = days[0], last = days[days.length - 1];
  const byDay = useMemo(() => {
    const m = new Map<ISODate, Occurrence[]>();
    for (const o of snap.occurrences) {
      if (o.dueDate < first || o.dueDate > last) continue;
      if (clients.length && !clients.includes(o.clientId)) continue;
      if (statuses.length && !statuses.includes(o.status)) continue;
      if (types.length && !types.includes(o.taskType)) continue;
      const list = m.get(o.dueDate) ?? [];
      list.push(o);
      m.set(o.dueDate, list);
    }
    for (const l of m.values()) l.sort(sortDay);
    return m;
  }, [snap.occurrences, first, last, clients, statuses, types]);
  // Meetings follow the client filter; status and type are about tasks.
  const meetings = useMemo(() => sortMeetings(snap.meetings.filter((m) => m.date >= first && m.date <= last
    && (!clients.length || (m.clientId !== null && clients.includes(m.clientId))))), [snap.meetings, first, last, clients]);
  const meetingsOn = (d: ISODate) => meetings.filter((m) => m.date === d);

  const move = (n: number) => setCursor((c) => (view === 'month' ? addMonths(startOfMonth(c), n) : addDays(c, (view === 'day' ? 1 : 7) * n)));
  const title = view === 'month' ? formatMonth(cursor) : view === 'day' ? formatDayLong(cursor) : (() => {
    const w = isoWeek(first);
    return `Week ${w.week} · ${formatDate(first)} – ${formatDate(last)}`;
  })();
  const unit = view === 'month' ? 'month' : view === 'day' ? 'day' : 'week';

  const onDrop = (e: DragEvent, day: ISODate) => {
    e.preventDefault();
    setDropTarget(null);
    const id = e.dataTransfer.getData('text/ledger-task');
    const task = snap.occurrences.find((o) => o.id === id);
    if (task && task.dueDate !== day) void patchOccurrence(id, { dueDate: day }, `Moved to ${formatDate(day)}`);
  };
  const dropProps = (day: ISODate) => ({
    onDragOver: (e: DragEvent) => { if (e.dataTransfer.types.includes('text/ledger-task')) { e.preventDefault(); setDropTarget(day); } },
    onDragLeave: () => setDropTarget((d) => (d === day ? null : d)),
    onDrop: (e: DragEvent) => onDrop(e, day),
  });
  const month = parts(cursor)[1];
  const MAX = 4;
  // Book on the day in view: today when it is showing, otherwise the first day shown.
  const newMeetingDay = view === 'day' ? cursor : first <= today && today <= last ? today : view === 'month' ? startOfMonth(cursor) : first;
  const viewOptions = [{ value: 'month' as const, label: 'Month' }, { value: 'week' as const, label: 'Week' }, { value: 'day' as const, label: 'Day' }];

  return (
    <Page title="Calendar" actions={repo.meetings && <Button variant="primary" onClick={() => ui.openMeeting({ mode: 'new', date: newMeetingDay })} aria-keyshortcuts="m"><Users /> New meeting</Button>}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => setCursor(today)}>Today</Button>
        <div className="flex">
          <IconButton label={`Previous ${unit}`} onClick={() => move(-1)}><ChevronLeft /></IconButton>
          <IconButton label={`Next ${unit}`} onClick={() => move(1)}><ChevronRight /></IconButton>
        </div>
        <h2 className="mr-2 text-[15px] font-semibold tracking-[-0.01em]" aria-live="polite">{title}</h2>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <FilterMenu label="Client" searchable options={[...snap.clients].sort((a, b) => a.name.localeCompare(b.name)).map((c) => ({ value: c.id, label: c.name }))} selected={clients} onChange={setClients} />
          <FilterMenu label="Status" options={TASK_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))} selected={statuses} onChange={setStatuses} />
          <FilterMenu label="Type" options={TASK_TYPES.map((t) => ({ value: t, label: TYPE_LABEL[t] }))} selected={types} onChange={setTypes} />
          <Segmented label="Calendar view" value={view} onChange={setView} options={viewOptions} />
        </div>
      </div>

      {view !== 'month' ? (
        <TimeGrid days={days} meetings={meetings} today={today} holiday={(d) => holidayName(d, calendar)}
          taskDropTarget={dropTarget} setTaskDropTarget={setDropTarget} onTaskDrop={onDrop}
          taskCell={(d) => (byDay.get(d) ?? []).map((t) => <Chip key={t.id} task={t} today={today} compact={view === 'week'} />)} />
      ) : (
      <div className="overflow-clip rounded-xl border border-line bg-surface">
        <div className="grid grid-cols-7 border-b border-line">
          {days.slice(0, 7).map((d) => (
            <div key={d} className="px-2 py-1.5 text-[11.5px] font-medium text-ink-3">{formatWeekdayShort(d)}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 sm:auto-rows-[minmax(132px,1fr)]">
          {days.map((d, i) => {
            const list = byDay.get(d) ?? [];
            const dayMeetings = meetingsOn(d);
            const openList = list.filter((t) => isOpen(t.status));
            const closed = list.filter((t) => !isOpen(t.status));
            const outside = parts(d)[1] !== month;
            // Meetings first (they happen at a time), then open work; finished work folds into one summary line.
            const room = Math.max(0, MAX - dayMeetings.length);
            const shown = openList.slice(0, openList.length > room ? Math.max(0, room - 1) : room);
            const hidden = openList.length - shown.length;
            const closedWord = closed.every((t) => t.status === 'done') ? 'done' : 'closed';
            const weekend = i % 7 >= 5;
            const holiday = holidayName(d, calendar);
            return (
              <div key={d} {...dropProps(d)}
                onDoubleClick={(e) => { if (e.target === e.currentTarget) ui.openNewTask({ dueDate: d }); }}
                className={cn('group/cell relative flex min-w-0 flex-col gap-0.5 border-r border-b border-line p-1 [&:nth-child(7n)]:border-r-0 max-sm:min-h-16',
                  (weekend || holiday) && 'bg-canvas/50', outside && 'bg-canvas/70', d === today && 'bg-accent-soft/35', dropTarget === d && 'bg-accent-soft ring-2 ring-accent/40 ring-inset')}
                aria-label={`${formatDayLong(d)}${holiday ? `, ${holiday}` : ''}: ${list.length} task${list.length === 1 ? '' : 's'}${dayMeetings.length ? `, ${dayMeetings.length} meeting${dayMeetings.length === 1 ? '' : 's'}` : ''}`}
              >
                <div className="group/day mb-0.5 flex items-center justify-between px-1">
                  <button onClick={() => { setCursor(d); setView('day'); }} aria-label={`Open ${formatDayLong(d)}`}
                    className={cn('tnum flex size-[22px] items-center justify-center rounded-full text-[12px] hover:ring-2 hover:ring-line-strong',
                      d === today ? 'bg-accent font-semibold text-on-accent' : outside ? 'text-ink-3/60' : 'text-ink-2')}>{parts(d)[2]}</button>
                  {holiday && <span className="mr-auto ml-1 truncate text-[11px] text-ink-3" title="Public holiday">{holiday}</span>}
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
                {(dayMeetings.length > 0 || openList.length > 0) && (
                  <button onClick={() => { setCursor(d); setView('day'); }} aria-label={`Open ${formatDayLong(d)}`} className="flex flex-wrap gap-0.5 px-1 sm:hidden">
                    {dayMeetings.slice(0, 4).map((m) => <span key={m.id} className="size-1.5 rounded-full bg-accent" />)}
                    {openList.slice(0, 4).map((t) => <span key={t.id} className={cn('size-1.5 rounded-full', t.dueDate < today ? 'bg-danger' : 'bg-ink-3/60')} />)}
                  </button>
                )}
                <div className="contents max-sm:hidden">
                {dayMeetings.slice(0, MAX).map((m) => <MeetingChip key={m.id} m={m} />)}
                {shown.map((t) => <Chip key={t.id} task={t} today={today} compact />)}
                {(hidden > 0 || closed.length > 0 || dayMeetings.length > MAX) && (
                  <Popover trigger={
                    <button className="flex h-5 max-w-full items-center gap-1 overflow-hidden rounded px-1.5 text-left text-[11.5px] font-medium whitespace-nowrap text-ink-3 hover:bg-hover hover:text-ink">
                      {hidden > 0 ? `+${hidden} more` : closed.length ? <><Check className="size-3 text-ok" strokeWidth={3} />{closed.length} {closedWord}</> : `+${dayMeetings.length - MAX} more`}
                      {hidden > 0 && closed.length > 0 && <span className="font-normal">· {closed.length} {closedWord}</span>}
                    </button>
                  }>
                    <div className="w-72 p-2">
                      <div className="mb-1.5 px-1 text-[12.5px] font-semibold">{formatDayLong(d)}</div>
                      <div className="flex max-h-80 flex-col gap-0.5 overflow-y-auto">
                        {dayMeetings.map((m) => <MeetingChip key={m.id} m={m} />)}
                        {list.map((t) => <Chip key={t.id} task={t} today={today} />)}
                      </div>
                    </div>
                  </Popover>
                )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-4 text-[12px] text-ink-3">
        {repo.meetings && <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-accent" /> Meeting</span>}
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-1 rounded-sm bg-danger" /> Overdue</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-1 rounded-sm bg-accent/70" /> Open</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-1 rounded-sm bg-warn" /> Waiting for client</span>
        <span className="inline-flex items-center gap-1.5"><Check className="size-3 text-ok" strokeWidth={3} /> Done</span>
        <span className="ml-auto">
          {view === 'month'
            ? 'Drag a task to another day to reschedule it. Click a date to see that day by the hour.'
            : 'Click an empty time to book a meeting there; drag a meeting to move it. Drag a task between days in the row at the top.'}
        </span>
      </div>
    </Page>
  );
}
