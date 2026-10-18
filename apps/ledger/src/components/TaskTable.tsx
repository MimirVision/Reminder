import { memo, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { NewTaskDefaults } from './ui-state';
import { CalendarClock, Check, ChevronRight, Clock, CornerDownLeft, MoreHorizontal, Repeat, RotateCcw, Sun } from 'lucide-react';
import { QuickAdd } from './QuickAdd';
import { addDays, weekday, type ISODate } from '../lib/dates';
import { formatDayShort, formatDue } from '../lib/format';
import { PRIORITY_LABEL, STATUS_LABEL } from '../lib/labels';
import { periodLabel } from '../lib/recurrence';
import type { Client, Occurrence, TaskStatus } from '../lib/types';
import { isOpen, PRIORITIES } from '../lib/types';
import { useStore } from '../data/store';
import { DueDate, PriorityLabel, StatusPicker, Tag } from '../ui/badges';
import { cn } from '../ui/cn';
import { DatePicker } from '../ui/datepicker';
import { Menu, MenuItem, MenuSeparator } from '../ui/overlay';
import { useUI } from './ui-state';

export type GroupBy = 'none' | 'day' | 'client' | 'status';

const nextMonday = (today: ISODate) => addDays(today, ((1 - weekday(today) + 7) % 7) || 7);

/** The quick moves people make all day, shared by the row menu and the keyboard. */
export function useTaskActions() {
  const { patchOccurrence, today } = useStore();
  return {
    toggleDone: (t: Occurrence) => patchOccurrence(t.id, { status: t.status === 'done' ? 'todo' : 'done' }, t.status === 'done' ? 'Reopened' : `Done: ${t.title}`),
    waiting: (t: Occurrence) => patchOccurrence(t.id, { status: t.status === 'waiting' ? 'todo' : 'waiting' }, t.status === 'waiting' ? 'No longer waiting' : 'Waiting for client'),
    moveTo: (t: Occurrence, d: ISODate) => (d === t.dueDate ? Promise.resolve(true) : patchOccurrence(t.id, { dueDate: d }, `Moved to ${formatDue(d, today).toLowerCase()}`)),
    tomorrow: addDays(today, 1),
    nextMonday: nextMonday(today),
    nextWeek: addDays(today, 7),
  };
}

export function CompleteToggle({ task }: { task: Occurrence }) {
  const { toggleDone } = useTaskActions();
  const [completing, setCompleting] = useState(false);
  const done = task.status === 'done' || completing;
  return (
    <button
      aria-label={task.status === 'done' ? `Reopen “${task.title}”` : `Mark “${task.title}” done`}
      aria-pressed={task.status === 'done'}
      onClick={(e) => {
        e.stopPropagation();
        if (task.status === 'done') { void toggleDone(task); return; }
        // A short moment to see the tick before the row leaves an open-tasks list.
        setCompleting(true);
        window.setTimeout(() => { void toggleDone(task).finally(() => setCompleting(false)); }, 280);
      }}
      className={cn(
        'group/check flex size-[18px] shrink-0 items-center justify-center rounded-full border-[1.5px] transition-[background-color,border-color,transform] duration-150',
        done ? 'scale-110 border-ok bg-ok text-white' : task.status === 'cancelled' ? 'border-dashed border-line-strong' : 'border-line-strong hover:border-ok hover:bg-ok-soft',
      )}
    >
      <Check className={cn('size-3 transition-opacity', done ? 'opacity-100' : 'text-ok opacity-0 group-hover/check:opacity-100')} strokeWidth={3} />
    </button>
  );
}

function RowMenu({ task }: { task: Occurrence }) {
  const ui = useUI();
  const a = useTaskActions();
  const open = isOpen(task.status);
  return (
    <Menu align="end" label={`Actions for “${task.title}”`} trigger={
      <button onClick={(e) => e.stopPropagation()} aria-label={`Actions for “${task.title}”`}
        className="flex size-7 items-center justify-center rounded-md text-ink-3 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-sunken hover:text-ink data-[state=open]:opacity-100 max-sm:opacity-100">
        <MoreHorizontal className="size-4" />
      </button>
    }>
      <MenuItem shortcut="D" onSelect={() => void a.toggleDone(task)}>{task.status === 'done' ? <><RotateCcw /> Reopen</> : <><Check /> Mark done</>}</MenuItem>
      {open && <MenuItem shortcut="W" onSelect={() => void a.waiting(task)}><Clock /> {task.status === 'waiting' ? 'No longer waiting' : 'Waiting for client'}</MenuItem>}
      {open && <>
        <MenuSeparator />
        <MenuItem shortcut="T" onSelect={() => void a.moveTo(task, a.tomorrow)}><Sun /> Tomorrow</MenuItem>
        <MenuItem onSelect={() => void a.moveTo(task, a.nextMonday)}><CalendarClock /> Next Monday · {formatDayShort(a.nextMonday)}</MenuItem>
        <MenuItem onSelect={() => void a.moveTo(task, addDays(task.dueDate < a.tomorrow ? a.tomorrow : task.dueDate, 7))}><CalendarClock /> One week later</MenuItem>
      </>}
      <MenuSeparator />
      <MenuItem shortcut="↵" onSelect={() => ui.openTask(task.id)}><CornerDownLeft /> Open details</MenuItem>
    </Menu>
  );
}

const Row = memo(function Row({ task, client, today, showClient, current, checked, onCheck }: {
  task: Occurrence; client: Client | undefined; today: ISODate; showClient: boolean; current: boolean;
  checked?: boolean; onCheck?: (id: string, range: boolean) => void;
}) {
  const ui = useUI();
  const { patchOccurrence } = useStore();
  const open = isOpen(task.status);
  return (
    <tr
      tabIndex={0}
      data-task={task.id}
      onClick={(e) => { if (onCheck && (e.metaKey || e.ctrlKey || e.shiftKey)) { onCheck(task.id, e.shiftKey); return; } ui.openTask(task.id); }}
      data-selected={current || checked || undefined}
      aria-selected={checked}
      className="group h-[38px] cursor-default border-b border-line last:border-b-0 outline-none hover:bg-hover/70 focus-visible:bg-accent-soft/40 focus-visible:shadow-[inset_2px_0_0_var(--c-accent)] data-[selected]:bg-accent-soft/60"
    >
      {onCheck && (
        <td className="w-8 pl-3" onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" tabIndex={-1} aria-label={`Select “${task.title}”`} checked={!!checked}
            onChange={(e) => onCheck(task.id, (e.nativeEvent as MouseEvent).shiftKey)}
            className={cn('size-3.5 accent-[var(--c-accent)] transition-opacity', checked ? 'opacity-100' : 'opacity-0 group-hover:opacity-60 hover:!opacity-100')} />
        </td>
      )}
      <td className={cn('w-9', onCheck ? 'pl-1' : 'pl-3')}><CompleteToggle task={task} /></td>
      <td className="max-w-0 py-1.5 pr-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn('truncate text-[13px]', !open && 'text-ink-3', task.status === 'cancelled' && 'line-through')}>{task.title}</span>
          {task.periodKey && (
            <span className="hidden shrink-0 items-center gap-1 text-[11.5px] text-ink-3 sm:inline-flex" title="From a recurring schedule">
              <Repeat className="size-3" />{periodLabel(task.periodKey)}
            </span>
          )}
          <span className="hidden gap-1 xl:flex">{task.tags.slice(0, 2).map((t) => <Tag key={t}>{t}</Tag>)}</span>
        </div>
      </td>
      {showClient && (
        <td className="hidden w-[24%] max-w-0 pr-3 md:table-cell">
          <span className="block truncate text-[12.5px] text-ink-2">{client?.name ?? 'Unknown client'}</span>
        </td>
      )}
      <td className="w-36 pr-3" onClick={(e) => e.stopPropagation()}>
        <DatePicker
          value={task.dueDate}
          today={today}
          onChange={(d) => { if (d !== task.dueDate) void patchOccurrence(task.id, { dueDate: d }, 'Due date changed'); }}
          trigger={<button tabIndex={-1} aria-label={`Due ${task.dueDate}. Change due date`} className="-mx-1.5 rounded px-1.5 py-0.5 hover:bg-sunken"><DueDate date={task.dueDate} today={today} open={open} /></button>}
        />
      </td>
      <td className="hidden w-20 pr-3 sm:table-cell" onClick={(e) => e.stopPropagation()}>
        <Menu label={`Priority: ${PRIORITY_LABEL[task.priority]}. Change priority`} trigger={
          <button tabIndex={-1} className="-mx-1.5 flex h-6 min-w-10 items-center rounded px-1.5 hover:bg-sunken">
            {task.priority === 'normal' ? <span className="text-[12px] text-ink-3/0 group-hover:text-ink-3">Set</span> : <PriorityLabel priority={task.priority} compact />}
          </button>
        }>
          {PRIORITIES.map((p) => <MenuItem key={p} onSelect={() => p !== task.priority && void patchOccurrence(task.id, { priority: p }, `Priority: ${PRIORITY_LABEL[p]}`)}><PriorityLabel priority={p} /></MenuItem>)}
        </Menu>
      </td>
      <td className="hidden w-32 pr-1 sm:table-cell" onClick={(e) => e.stopPropagation()}>
        <StatusPicker status={task.status} onChange={(s) => void patchOccurrence(task.id, { status: s }, 'Status updated')} />
      </td>
      <td className="w-9 pr-2" onClick={(e) => e.stopPropagation()}><RowMenu task={task} /></td>
    </tr>
  );
});

const STATUS_ORDER: TaskStatus[] = ['in_progress', 'todo', 'waiting', 'done', 'cancelled'];

interface Group { key: string; label: ReactNode; tasks: Occurrence[]; adds: (NewTaskDefaults & { status?: TaskStatus }) | null }

function groupTasks(tasks: Occurrence[], by: GroupBy, today: ISODate, clientById: Map<string, Client>): Group[] {
  if (by === 'none') return [{ key: 'all', label: null, tasks, adds: {} }];
  const map = new Map<string, Occurrence[]>();
  const keyOf = (t: Occurrence) => by === 'client' ? t.clientId
    : by === 'status' ? t.status
    : isOpen(t.status) && t.dueDate < today ? 'overdue' : t.dueDate;
  for (const t of tasks) {
    const k = keyOf(t);
    const list = map.get(k) ?? [];
    list.push(t);
    map.set(k, list);
  }
  const keys = [...map.keys()];
  if (by === 'client') keys.sort((a, b) => (clientById.get(a)?.name ?? '').localeCompare(clientById.get(b)?.name ?? ''));
  else if (by === 'status') keys.sort((a, b) => STATUS_ORDER.indexOf(a as TaskStatus) - STATUS_ORDER.indexOf(b as TaskStatus));
  else keys.sort((a, b) => (a === 'overdue' ? -1 : b === 'overdue' ? 1 : a.localeCompare(b)));
  return keys.map((k) => ({
    key: k,
    tasks: map.get(k)!,
    // What a task added inside this group gets: its client, its day, or its status.
    adds: by === 'client' ? { clientId: k }
      : by === 'status' ? (isOpen(k as TaskStatus) ? { status: k as TaskStatus } : null)
      : { dueDate: k === 'overdue' ? today : k },
    label: by === 'client' ? clientById.get(k)?.name ?? 'Unknown client'
      : by === 'status' ? STATUS_LABEL[k as TaskStatus]
      : k === 'overdue' ? <span className="text-danger">Overdue</span>
      : <>{formatDue(k, today)}{k <= addDays(today, 1) && <span className="ml-1.5 font-normal text-ink-3">{formatDayShort(k)}</span>}</>,
  }));
}

/** Arrow keys move between rows; Enter opens; D done, W waiting, T tomorrow; X selects (where selection is on). */
function useRowKeys(tasks: Occurrence[], onCheck?: (id: string, range: boolean) => void) {
  const ui = useUI();
  const a = useTaskActions();
  return (e: KeyboardEvent<HTMLTableSectionElement>) => {
    const row = (e.target as HTMLElement).closest<HTMLTableRowElement>('tr[data-task]');
    if (!row || e.target !== row || e.metaKey || e.ctrlKey || e.altKey) return;
    const task = tasks.find((t) => t.id === row.dataset.task);
    if (!task) return;
    const rows = [...row.closest('table')!.querySelectorAll<HTMLTableRowElement>('tr[data-task]')];
    const i = rows.indexOf(row);
    const key = e.key.toLowerCase();
    if (e.key === 'ArrowDown' || key === 'j') { e.preventDefault(); rows[Math.min(rows.length - 1, i + 1)]?.focus(); }
    else if (e.key === 'ArrowUp' || key === 'k') { e.preventDefault(); rows[Math.max(0, i - 1)]?.focus(); }
    else if (e.key === 'Enter') { e.preventDefault(); ui.openTask(task.id); }
    else if (key === 'd') { e.preventDefault(); (rows[i + 1] ?? rows[i - 1])?.focus(); void a.toggleDone(task); }
    else if (key === 'w' && isOpen(task.status)) { e.preventDefault(); void a.waiting(task); }
    else if (key === 't' && isOpen(task.status)) { e.preventDefault(); void a.moveTo(task, a.tomorrow); }
    else if (key === 'x' && onCheck) { e.preventDefault(); onCheck(task.id, e.shiftKey); }
  };
}

export function TaskTable({ tasks, showClient = true, header = true, limit, groupBy = 'none', selection, addRow, collapsible = true }: {
  tasks: Occurrence[]; showClient?: boolean; header?: boolean; limit?: number; groupBy?: GroupBy;
  /** Show an "Add task" row at the top of each group, pre-filled with these defaults plus the group's own. */
  addRow?: NewTaskDefaults; collapsible?: boolean;
  selection?: { selected: Set<string>; toggle: (id: string, range: boolean) => void; toggleAll: (ids: string[]) => void };
}) {
  const { clientById, today } = useStore();
  const ui = useUI();
  const shown = limit ? tasks.slice(0, limit) : tasks;
  const groups = groupTasks(shown, groupBy, today, clientById);
  const onKey = useRowKeys(shown, selection?.toggle);
  const cols = 6 + (showClient ? 1 : 0) + (selection ? 1 : 0);
  const allChecked = !!selection && shown.length > 0 && shown.every((t) => selection.selected.has(t.id));
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const fold = (k: string) => setFolded((f) => { const n = new Set(f); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  return (
    <table className="w-full table-fixed border-collapse">
      {/* Always rendered: a fixed-layout table takes its column widths from this first row. Without headers it is zero-height and only read by screen readers. */}
      {(
        <thead className={header ? undefined : '[&_tr]:!h-0 [&_tr]:!border-0 [&_th]:!p-0 [&_th>*]:sr-only'}>
          <tr className={cn('h-8 border-b border-line bg-surface text-left text-[11.5px] font-medium text-ink-3 [&>th]:bg-surface', header && 'sticky top-[52px] z-10')}>
            {selection && (
              <th className="w-8 pl-3">
                <input type="checkbox" aria-label="Select all" checked={allChecked} onChange={() => selection.toggleAll(shown.map((t) => t.id))}
                  className={cn('size-3.5 accent-[var(--c-accent)]', !allChecked && selection.selected.size === 0 && 'opacity-50 hover:opacity-100')} />
              </th>
            )}
            <th className={cn('w-9', selection ? 'pl-1' : 'pl-3')}><span className="sr-only">Done</span></th>
            <th className="pr-3 font-medium"><span>Task</span></th>
            {showClient && <th className="hidden w-[24%] pr-3 font-medium md:table-cell"><span>Client</span></th>}
            <th className="w-36 pr-3 font-medium"><span>Due</span></th>
            <th className="hidden w-20 pr-3 font-medium sm:table-cell"><span>Priority</span></th>
            <th className="hidden w-32 pr-1 font-medium sm:table-cell"><span>Status</span></th>
            <th className="w-9 pr-2"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
      )}
      {groups.map((g, gi) => (
        <tbody key={g.key} onKeyDown={onKey}>
          {g.label !== null && (
            <tr className={cn('h-8 border-b border-line bg-canvas/60', gi > 0 && 'border-t')}>
              <th colSpan={cols} scope="rowgroup" className="p-0 text-left text-[12px] font-semibold text-ink-2">
                {collapsible ? (
                  <button onClick={() => fold(g.key)} aria-expanded={!folded.has(g.key)} className="flex h-8 w-full items-center gap-1.5 pl-2.5 text-left hover:text-ink">
                    <ChevronRight className={cn('size-3.5 text-ink-3 transition-transform', !folded.has(g.key) && 'rotate-90')} />
                    {g.label}<span className="ml-1 font-normal text-ink-3">{g.tasks.length}</span>
                  </button>
                ) : <span className="pl-4">{g.label}<span className="ml-2 font-normal text-ink-3">{g.tasks.length}</span></span>}
              </th>
            </tr>
          )}
          {addRow && g.adds && !folded.has(g.key) && (
            <tr className="border-b border-line">
              <td colSpan={cols} className="p-0">
                <QuickAdd variant="row" clientId={g.adds.clientId ?? addRow.clientId} dueDate={g.adds.dueDate ?? addRow.dueDate} status={g.adds.status} />
              </td>
            </tr>
          )}
          {!folded.has(g.key) && g.tasks.map((t) => (
            <Row key={t.id} task={t} client={clientById.get(t.clientId)} today={today} showClient={showClient} current={ui.taskId === t.id}
              checked={selection?.selected.has(t.id)} onCheck={selection?.toggle} />
          ))}
        </tbody>
      ))}
    </table>
  );
}
