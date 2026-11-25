// What the calendar's views are made of: a task chip (its type's colour, the client, overdue / waiting / done at a
// glance), a meeting chip, and a group chip for the same task due for several clients on one day
// ("Bokføring og regnskapsarbeid ×4"), which opens to show each client.
import { AlertTriangle, Check, Clock, Link2 } from 'lucide-react';
import { useStore } from '../../data/store';
import type { ISODate } from '../../lib/dates';
import { typeColor } from '../../lib/insights';
import { PRIORITY_RANK, STATUS_LABEL } from '../../lib/labels';
import { isOpen, type Meeting, type Occurrence, type TaskStatus } from '../../lib/types';
import { cn } from '../../ui/cn';
import { Popover } from '../../ui/overlay';
import { useUI } from '../ui-state';

const ORDER: Record<TaskStatus, number> = { todo: 1, in_progress: 1, waiting: 1, done: 2, cancelled: 3 };
/** Open before finished, then by priority, then by title (so the same tasks sit together). */
export const sortDay = (a: Occurrence, b: Occurrence) => ORDER[a.status] - ORDER[b.status] || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.title.localeCompare(b.title);

/** "Fjordlys Regnskap AS" → "Fjordlys Regnskap": room is short in a calendar cell. */
export const shortName = (name: string) => name.replace(/\s+(AS|ASA|ENK|DA|ANS|SA|BA|NUF)$/i, '');

export function TaskChip({ task, today, compact, stacked, hideClient }: { task: Occurrence; today: ISODate; compact?: boolean; stacked?: boolean; hideClient?: boolean }) {
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
      onClick={(e) => { e.stopPropagation(); ui.openTask(task.id); }}
      title={`${task.title} · ${client} · ${state}`}
      aria-label={`${task.title}, ${client}, ${state}. Open task`}
      // The left edge is the task's type (VAT, payroll, …); overdue tints the whole chip.
      style={{ borderLeftColor: overdue ? undefined : typeColor(task.taskType) }}
      className={cn(
        'group flex w-full min-w-0 shrink-0 gap-1.5 rounded-[5px] border-l-[3px] px-1.5 text-left text-[12px] transition-colors',
        stacked ? 'items-start py-1 leading-[16px]' : 'items-center leading-[20px]',
        overdue ? 'border-danger bg-danger-soft text-danger hover:brightness-[0.98]'
          : !open ? 'bg-transparent text-ink-3 opacity-70 hover:bg-hover'
          : 'bg-sunken text-ink hover:bg-hover',
        open && 'cursor-grab active:cursor-grabbing',
      )}
    >
      {overdue ? <AlertTriangle className={cn('size-3 shrink-0', stacked && 'mt-0.5')} />
        : task.status === 'done' ? <Check className={cn('size-3 shrink-0 text-ok', stacked && 'mt-0.5')} strokeWidth={3} />
        : task.status === 'waiting' ? <Clock className={cn('size-3 shrink-0 text-warn', stacked && 'mt-0.5')} />
        : task.afterId ? <Link2 className={cn('size-3 shrink-0 text-ink-3', stacked && 'mt-0.5')} /> : null}
      {stacked ? (
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={cn('line-clamp-2 font-medium', task.status === 'cancelled' && 'line-through')}>{task.title}</span>
          {!hideClient && <span className={cn('truncate text-[11.5px]', overdue ? 'text-danger/75' : 'text-ink-3')}>{client}</span>}
        </span>
      ) : (
        <span className={cn('min-w-0 flex-1 truncate', task.status === 'cancelled' && 'line-through', task.status === 'done' && 'line-through decoration-ink-3/50')}>
          {task.title}
          {!hideClient && <span className={cn('ml-1', overdue ? 'text-danger/75' : 'text-ink-3')}>{compact ? shortName(client) : client}</span>}
        </span>
      )}
    </button>
  );
}

/** The same task for several clients on one day, as one chip that opens to the list of clients. */
export function GroupChip({ tasks, today }: { tasks: Occurrence[]; today: ISODate }) {
  const { clientById } = useStore();
  const t = tasks[0];
  const overdue = tasks.filter((x) => isOpen(x.status) && x.dueDate < today).length;
  return (
    <Popover trigger={
      <button onClick={(e) => e.stopPropagation()} aria-label={`${t.title} for ${tasks.length} clients${overdue ? `, ${overdue} overdue` : ''}. Show them`}
        style={{ borderLeftColor: overdue ? undefined : typeColor(t.taskType) }}
        className={cn('flex w-full min-w-0 shrink-0 items-center gap-1.5 rounded-[5px] border-l-[3px] px-1.5 text-left text-[12px] leading-[20px] transition-colors',
          overdue ? 'border-danger bg-danger-soft text-danger' : 'bg-sunken text-ink hover:bg-hover')}>
        {overdue > 0 && <AlertTriangle className="size-3 shrink-0" />}
        <span className="min-w-0 flex-1 truncate">{t.title}</span>
        <span className="num shrink-0 rounded-full bg-surface px-1.5 text-[11px] leading-[16px] font-medium text-ink-2 shadow-soft">×{tasks.length}</span>
      </button>
    }>
      <div className="w-80 p-2">
        <p className="mb-1.5 px-1 text-[12.5px] font-semibold">{t.title} <span className="font-normal text-ink-3">· {tasks.length} clients</span></p>
        <div className="flex max-h-80 flex-col gap-0.5 overflow-y-auto">
          {[...tasks].sort((a, b) => (clientById.get(a.clientId)?.name ?? '').localeCompare(clientById.get(b.clientId)?.name ?? '', 'nb'))
            .map((x) => <TaskChip key={x.id} task={x} today={today} />)}
        </div>
      </div>
    </Popover>
  );
}

/** Splits a day's tasks into single ones and groups of the same open task for several clients. */
export function groupDay(list: Occurrence[]): (Occurrence | Occurrence[])[] {
  const out: (Occurrence | Occurrence[])[] = [];
  const by = new Map<string, Occurrence[]>();
  for (const t of list) {
    if (!isOpen(t.status)) { out.push(t); continue; }
    const k = t.title.trim().toLowerCase();
    if (!by.has(k)) { by.set(k, []); out.push(by.get(k)!); }
    by.get(k)!.push(t);
  }
  return out.map((x) => (Array.isArray(x) && x.length === 1 ? x[0] : x));
}

export function MeetingChip({ m }: { m: Meeting }) {
  const ui = useUI();
  const { clientById } = useStore();
  const client = m.clientId ? clientById.get(m.clientId)?.name : null;
  return (
    <button onClick={(e) => { e.stopPropagation(); ui.openMeeting({ mode: 'edit', id: m.id }); }} title={`${m.start}–${m.end} ${m.title}${client ? ` · ${client}` : ''}`}
      aria-label={`Meeting ${m.title} at ${m.start}${client ? `, ${client}` : ''}. Open meeting`}
      className="flex w-full min-w-0 shrink-0 items-center gap-1.5 rounded-[5px] px-1.5 text-left text-[12px] leading-[20px] text-ink hover:bg-accent-soft">
      <span className="size-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
      <span className="num shrink-0 text-[11px] text-accent-ink">{m.start}</span>
      <span className="min-w-0 flex-1 truncate">{m.title}</span>
    </button>
  );
}
