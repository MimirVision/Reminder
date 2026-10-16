import { useMemo, useState, type DragEvent } from 'react';
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Repeat } from 'lucide-react';
import { FilterMenu } from '../components/FilterMenu';
import { Page } from '../components/Shell';
import { useUI } from '../components/ui-state';
import { useStore } from '../data/store';
import { addDays, addMonths, isoWeek, monthGrid, parts, startOfMonth, startOfWeek, type ISODate } from '../lib/dates';
import { formatDate, formatDayLong, formatMonth, formatWeekdayShort } from '../lib/format';
import { PRIORITY_RANK, STATUS_LABEL, TYPE_LABEL } from '../lib/labels';
import { isOpen, TASK_STATUSES, TASK_TYPES, type Occurrence, type TaskStatus } from '../lib/types';
import { useRoute } from '../router';
import { Button, IconButton } from '../ui/button';
import { cn } from '../ui/cn';
import { Segmented } from '../ui/field';
import { Popover } from '../ui/overlay';

type View = 'month' | 'week';

function Chip({ task, today, compact }: { task: Occurrence; today: ISODate; compact?: boolean }) {
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
        'group flex w-full min-w-0 items-center gap-1.5 rounded-[5px] border-l-2 px-1.5 text-left text-[12px] leading-[20px] transition-colors',
        overdue ? 'border-danger bg-danger-soft text-danger hover:brightness-[0.98]'
          : !open ? 'border-transparent text-ink-3 hover:bg-hover'
          : task.status === 'waiting' ? 'border-warn bg-sunken text-ink hover:bg-hover'
          : 'border-accent/70 bg-sunken text-ink hover:bg-hover',
        open && 'cursor-grab active:cursor-grabbing',
      )}
    >
      {overdue ? <AlertTriangle className="size-3 shrink-0" /> : task.status === 'done' ? <Check className="size-3 shrink-0 text-ok" strokeWidth={3} /> : task.periodKey ? <Repeat className="size-3 shrink-0 text-ink-3" /> : null}
      <span className={cn('min-w-0 flex-1 truncate', task.status === 'cancelled' && 'line-through', task.status === 'done' && 'line-through decoration-ink-3/50')}>
        {task.title}
        {!compact && <span className={cn('ml-1', overdue ? 'text-danger/75' : 'text-ink-3')}>{client}</span>}
      </span>
    </button>
  );
}

const ORDER: Record<TaskStatus, number> = { todo: 1, in_progress: 1, waiting: 1, done: 2, cancelled: 3 };
const sortDay = (a: Occurrence, b: Occurrence) => ORDER[a.status] - ORDER[b.status] || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.title.localeCompare(b.title);

export function Calendar() {
  const { snap, today, patchOccurrence } = useStore();
  const ui = useUI();
  const { query } = useRoute();
  const [view, setView] = useState<View>((query.get('view') as View) || snap.workspace.settings.defaultCalendarView || 'month');
  const [cursor, setCursor] = useState<ISODate>(query.get('date') ?? today);
  const [clients, setClients] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<TaskStatus[]>(['todo', 'in_progress', 'waiting', 'done']);
  const [types, setTypes] = useState<string[]>([]);
  const [dropTarget, setDropTarget] = useState<ISODate | null>(null);

  const days = view === 'month' ? monthGrid(cursor) : Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(cursor), i));
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

  const move = (n: number) => setCursor((c) => (view === 'month' ? addMonths(startOfMonth(c), n) : addDays(c, 7 * n)));
  const title = view === 'month' ? formatMonth(cursor) : (() => {
    const w = isoWeek(first);
    return `Week ${w.week} · ${formatDate(first)} – ${formatDate(last)}`;
  })();

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

  return (
    <Page title="Calendar" wide>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => setCursor(today)}>Today</Button>
        <div className="flex">
          <IconButton label={view === 'month' ? 'Previous month' : 'Previous week'} onClick={() => move(-1)}><ChevronLeft /></IconButton>
          <IconButton label={view === 'month' ? 'Next month' : 'Next week'} onClick={() => move(1)}><ChevronRight /></IconButton>
        </div>
        <h2 className="mr-2 text-[15px] font-semibold tracking-[-0.01em]" aria-live="polite">{title}</h2>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <FilterMenu label="Client" searchable options={[...snap.clients].sort((a, b) => a.name.localeCompare(b.name)).map((c) => ({ value: c.id, label: c.name }))} selected={clients} onChange={setClients} />
          <FilterMenu label="Status" options={TASK_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))} selected={statuses} onChange={setStatuses} />
          <FilterMenu label="Type" options={TASK_TYPES.map((t) => ({ value: t, label: TYPE_LABEL[t] }))} selected={types} onChange={setTypes} />
          <Segmented label="Calendar view" value={view} onChange={setView} options={[{ value: 'month', label: 'Month' }, { value: 'week', label: 'Week' }]} />
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-line bg-surface shadow-soft">
        <div className="grid grid-cols-7 border-b border-line">
          {days.slice(0, 7).map((d) => (
            <div key={d} className="px-2 py-1.5 text-[11.5px] font-medium text-ink-3">
              {formatWeekdayShort(d)}{view === 'week' && <span className={cn('tnum ml-1.5', d === today ? 'text-accent' : 'text-ink-2')}>{parts(d)[2]}</span>}
            </div>
          ))}
        </div>
        <div className={cn('grid grid-cols-7', view === 'month' ? 'auto-rows-[minmax(112px,1fr)]' : 'min-h-[60vh]')}>
          {days.map((d, i) => {
            const list = byDay.get(d) ?? [];
            const outside = view === 'month' && parts(d)[1] !== month;
            const shown = view === 'month' ? list.slice(0, list.length > MAX ? MAX - 1 : MAX) : list;
            const weekend = i % 7 >= 5;
            return (
              <div key={d} {...dropProps(d)}
                onDoubleClick={(e) => { if (e.target === e.currentTarget) ui.openNewTask({ dueDate: d }); }}
                className={cn('relative flex min-w-0 flex-col gap-0.5 border-r border-b border-line p-1 [&:nth-child(7n)]:border-r-0',
                  weekend && 'bg-canvas/50', outside && 'bg-canvas/70', dropTarget === d && 'bg-accent-soft ring-2 ring-accent/40 ring-inset')}
                aria-label={`${formatDayLong(d)}: ${list.length} task${list.length === 1 ? '' : 's'}`}
              >
                {view === 'month' && (
                  <div className="mb-0.5 flex items-center justify-between px-1">
                    <span className={cn('tnum flex size-[22px] items-center justify-center rounded-full text-[12px]',
                      d === today ? 'bg-accent font-semibold text-white' : outside ? 'text-ink-3/60' : 'text-ink-2')}>{parts(d)[2]}</span>
                  </div>
                )}
                {shown.map((t) => <Chip key={t.id} task={t} today={today} compact={view === 'month'} />)}
                {view === 'month' && list.length > shown.length && (
                  <Popover trigger={<button className="rounded px-1.5 text-left text-[11.5px] font-medium text-ink-3 hover:bg-hover hover:text-ink">+{list.length - shown.length} more</button>}>
                    <div className="w-72 p-2">
                      <div className="mb-1.5 px-1 text-[12.5px] font-semibold">{formatDayLong(d)}</div>
                      <div className="flex max-h-80 flex-col gap-0.5 overflow-y-auto">{list.map((t) => <Chip key={t.id} task={t} today={today} />)}</div>
                    </div>
                  </Popover>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-4 text-[12px] text-ink-3">
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-1 rounded-sm bg-danger" /> Overdue</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-1 rounded-sm bg-accent/70" /> Open</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-1 rounded-sm bg-warn" /> Waiting for client</span>
        <span className="inline-flex items-center gap-1.5"><Check className="size-3 text-ok" strokeWidth={3} /> Done</span>
        <span className="ml-auto">Drag an open task to another day to reschedule it. This moves only that task, never its schedule. Double-click a day to add a task.</span>
      </div>
    </Page>
  );
}
