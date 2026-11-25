import { useEffect, useMemo, useState, type DragEvent } from 'react';
import { Check, ChevronLeft, ChevronRight, Clock, Users } from 'lucide-react';
import { AgendaView } from '../components/calendar/AgendaView';
import { TaskChip, sortDay } from '../components/calendar/chips';
import { ClientsView } from '../components/calendar/ClientsView';
import { MonthView } from '../components/calendar/MonthView';
import { YearView } from '../components/calendar/YearView';
import { FilterMenu } from '../components/FilterMenu';
import { Page } from '../components/Shell';
import { TimeGrid } from '../components/TimeGrid';
import { useUI } from '../components/ui-state';
import { useStore } from '../data/store';
import { addDays, addMonths, endOfMonth, isoWeek, isISODate, monthGrid, parts, startOfMonth, startOfWeek, type ISODate } from '../lib/dates';
import { formatDate, formatDayLong, formatMonth } from '../lib/format';
import { holidayName } from '../lib/holidays';
import { GROUPS, GROUP_COLOR, GROUP_LABEL, groupOf } from '../lib/insights';
import { STATUS_LABEL, TYPE_LABEL } from '../lib/labels';
import { sortMeetings } from '../lib/meetings';
import { TASK_STATUSES, TASK_TYPES, type Occurrence, type TaskStatus } from '../lib/types';
import { useRoute } from '../router';
import { Button, IconButton } from '../ui/button';
import { cn } from '../ui/cn';
import { Segmented, Select } from '../ui/field';

export type CalendarView = 'year' | 'month' | 'week' | 'day' | 'agenda' | 'clients';
const VIEWS: { value: CalendarView; label: string }[] = [
  { value: 'year', label: 'Year' }, { value: 'month', label: 'Month' }, { value: 'week', label: 'Week' }, { value: 'day', label: 'Day' },
  { value: 'agenda', label: 'Agenda' }, { value: 'clients', label: 'Clients' },
];
const asView = (v: string | null | undefined): CalendarView | null => (VIEWS.some((x) => x.value === v) ? v as CalendarView : null);

const WORKWEEK_KEY = 'ledger-calendar-workweek';
const readWorkweek = () => { try { return localStorage.getItem(WORKWEEK_KEY) === '1'; } catch { return false; } };

export function Calendar() {
  const { snap, today, patchOccurrence, calendar, repo } = useStore();
  const ui = useUI();
  const { query } = useRoute();
  // Links can carry anything: unknown views and dates fall back instead of breaking the page.
  const [view, setView] = useState<CalendarView>(asView(query.get('view')) ?? asView(snap.workspace.settings.defaultCalendarView) ?? 'month');
  const [cursor, setCursor] = useState<ISODate>(() => { const d = query.get('date'); return d && isISODate(d) ? d : today; });
  // A link followed while the calendar is already open (a meeting notification, a chart's day) moves it there too.
  const qView = asView(query.get('view')), qDate = query.get('date');
  useEffect(() => {
    if (qView) setView(qView);
    if (qDate && isISODate(qDate)) setCursor(qDate);
  }, [qView, qDate]);
  const [clients, setClients] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<TaskStatus[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  const [dropTarget, setDropTarget] = useState<ISODate | null>(null);
  // The week view can leave out the weekend, to give the working days more room. Remembered on this device.
  const [workweek, setWorkweek] = useState(readWorkweek);
  const toggleWorkweek = () => setWorkweek((w) => { try { localStorage.setItem(WORKWEEK_KEY, w ? '0' : '1'); } catch { /* ignore */ } return !w; });

  const [y, m] = parts(cursor);
  const days = useMemo<ISODate[]>(() => {
    const span = (from: ISODate, to: ISODate) => { const out: ISODate[] = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; };
    if (view === 'year') return span(`${y}-01-01`, `${y}-12-31`);
    if (view === 'month') return monthGrid(cursor);
    if (view === 'agenda' || view === 'clients') return span(startOfMonth(cursor), endOfMonth(cursor));
    if (view === 'day') return [cursor];
    return Array.from({ length: workweek ? 5 : 7 }, (_, i) => addDays(startOfWeek(cursor), i));
  }, [view, cursor, y, workweek]);
  const first = days[0], last = days[days.length - 1];

  const byDay = useMemo(() => {
    const out = new Map<ISODate, Occurrence[]>();
    for (const o of snap.occurrences) {
      if (o.dueDate < first || o.dueDate > last) continue;
      if (clients.length && !clients.includes(o.clientId)) continue;
      if (statuses.length && !statuses.includes(o.status)) continue;
      if (types.length && !types.includes(o.taskType)) continue;
      const list = out.get(o.dueDate) ?? [];
      list.push(o);
      out.set(o.dueDate, list);
    }
    for (const l of out.values()) l.sort(sortDay);
    return out;
  }, [snap.occurrences, first, last, clients, statuses, types]);
  // Meetings follow the client filter; status and type are about tasks.
  const meetings = useMemo(() => sortMeetings(snap.meetings.filter((x) => x.date >= first && x.date <= last
    && (!clients.length || (x.clientId !== null && clients.includes(x.clientId))))), [snap.meetings, first, last, clients]);
  const meetingsOn = (d: ISODate) => meetings.filter((x) => x.date === d);
  // Time set aside for tasks on the days shown (the same client filter as the tasks).
  const blocks = useMemo(() => snap.occurrences.filter((o) => o.plannedOn && o.plannedOn >= first && o.plannedOn <= last && o.status !== 'cancelled'
    && (!clients.length || clients.includes(o.clientId))), [snap.occurrences, first, last, clients]);
  const blocksOn = (d: ISODate) => blocks.filter((b) => b.plannedOn === d);

  const unit: 'year' | 'month' | 'week' | 'day' = view === 'year' ? 'year' : view === 'week' ? 'week' : view === 'day' ? 'day' : 'month';
  const move = (n: number) => setCursor((c) => (unit === 'year' ? `${parts(c)[0] + n}-01-01` : unit === 'month' ? addMonths(startOfMonth(c), n) : addDays(c, (unit === 'day' ? 1 : 7) * n)));
  const title = unit === 'year' ? String(y) : unit === 'month' ? formatMonth(cursor) : unit === 'day' ? formatDayLong(cursor) : (() => {
    const w = isoWeek(first);
    return `Week ${w.week} · ${formatDate(first)} – ${formatDate(last)}`;
  })();
  const openDay = (d: ISODate) => { setCursor(d); setView('day'); };

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
  // Book on the day in view: today when it is showing, otherwise the first day shown.
  const newMeetingDay = view === 'day' ? cursor : first <= today && today <= last ? today : view === 'month' ? startOfMonth(cursor) : first;
  // The legend names only the types on screen.
  const shownGroups = useMemo(() => {
    const present = new Set([...byDay.values()].flat().map((o) => groupOf(o.taskType)));
    return GROUPS.filter((g) => present.has(g));
  }, [byDay]);

  return (
    <Page title="Calendar" wide actions={repo.meetings && <Button variant="primary" onClick={() => ui.openMeeting({ mode: 'new', date: newMeetingDay })} aria-keyshortcuts="m"><Users /> New meeting</Button>}>
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
          {view === 'week' && (
            <button type="button" aria-pressed={workweek} onClick={toggleWorkweek} title="Show only Monday to Friday"
              className={cn('h-8 rounded-md border px-2.5 text-[12.5px] transition-colors', workweek ? 'border-accent/50 bg-accent-soft text-accent-ink' : 'border-line-strong text-ink-2 hover:bg-hover')}>
              Mon–Fri
            </button>
          )}
          <div className="hidden md:block"><Segmented label="Calendar view" value={view} onChange={setView} options={VIEWS} /></div>
          <Select className="w-32 md:hidden" aria-label="Calendar view" value={view} onChange={(e) => setView(e.target.value as CalendarView)}>
            {VIEWS.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
          </Select>
        </div>
      </div>

      {/* A new view or period arrives with a short rise; moving through days and weeks doesn't flicker. */}
      <div key={unit === 'day' || unit === 'week' ? view : `${view}-${first}`} className="animate-rise-in">
        {view === 'week' || view === 'day' ? (
          <TimeGrid days={days} meetings={meetings} today={today} holiday={(d) => holidayName(d, calendar)}
            blocks={blocks} onPlan={repo.flow ? (id, day, start, end) => void patchOccurrence(id, { plannedOn: day, plannedStart: start, plannedEnd: end }, `Time set aside: ${formatDayLong(day)}, ${start}–${end}`) : undefined}
            taskDropTarget={dropTarget} setTaskDropTarget={setDropTarget} onTaskDrop={onDrop}
            taskCell={(d) => (byDay.get(d) ?? []).map((t) => <TaskChip key={t.id} task={t} today={today} compact={view === 'week'} />)} />
        ) : view === 'month' ? (
          <MonthView days={days} month={m} today={today} byDay={byDay} meetingsOn={meetingsOn} dropTarget={dropTarget} dropProps={dropProps}
            openDay={openDay} openWeek={(d) => { setCursor(d); setView('week'); }} />
        ) : view === 'agenda' ? (
          <AgendaView days={days} today={today} byDay={byDay} meetingsOn={meetingsOn} blocksOn={blocksOn} />
        ) : view === 'year' ? (
          <YearView year={y} today={today} byDay={byDay} openDay={openDay} openMonth={(d) => { setCursor(d); setView('month'); }} />
        ) : (
          <ClientsView days={days} today={today} byDay={byDay} />
        )}
      </div>

      {view !== 'year' && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-ink-3">
          {shownGroups.map((g) => <span key={g} className="inline-flex items-center gap-1.5"><span className="h-3 w-[3px] rounded-sm" style={{ background: GROUP_COLOR[g] }} /> {GROUP_LABEL[g]}</span>)}
          {shownGroups.length > 0 && <span className="h-3 w-px bg-line-strong" aria-hidden />}
          {repo.meetings && <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-accent" /> Meeting</span>}
          <span className="inline-flex items-center gap-1.5"><span className="h-3 w-[3px] rounded-sm bg-danger" /> Overdue</span>
          <span className="inline-flex items-center gap-1.5"><Clock className="size-3 text-warn" /> Waiting for client</span>
          <span className="inline-flex items-center gap-1.5"><Check className="size-3 text-ok" strokeWidth={3} /> Done</span>
          <span className="ml-auto max-w-xl text-right">
            {view === 'month' ? 'Drag a task to another day to move it. Click a date for that day by the hour, a week number for the week.'
              : view === 'clients' ? 'Each dot is a task, in its type’s colour. Click one to see that client’s day.'
              : view === 'agenda' ? 'Tick tasks off right here. Click anything to open it.'
              : 'Click an empty time to book a meeting there; drag a meeting to move it. Drag a task between days in the row at the top, or down into the hours to set time aside for it.'}
          </span>
        </div>
      )}
    </Page>
  );
}
