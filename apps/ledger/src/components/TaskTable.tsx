import { memo } from 'react';
import { Check, Repeat } from 'lucide-react';
import type { ISODate } from '../lib/dates';
import { periodLabel } from '../lib/recurrence';
import type { Client, Occurrence } from '../lib/types';
import { isOpen } from '../lib/types';
import { useStore } from '../data/store';
import { DueDate, PriorityLabel, StatusPicker, Tag } from '../ui/badges';
import { cn } from '../ui/cn';
import { DatePicker } from '../ui/datepicker';
import { useUI } from './ui-state';

export function CompleteToggle({ task }: { task: Occurrence }) {
  const { patchOccurrence } = useStore();
  const done = task.status === 'done';
  return (
    <button
      aria-label={done ? `Reopen “${task.title}”` : `Mark “${task.title}” done`}
      aria-pressed={done}
      onClick={(e) => { e.stopPropagation(); void patchOccurrence(task.id, { status: done ? 'todo' : 'done' }, done ? 'Reopened' : 'Marked done'); }}
      className={cn(
        'group/check flex size-[18px] shrink-0 items-center justify-center rounded-full border-[1.5px] transition-colors',
        done ? 'border-ok bg-ok text-white' : task.status === 'cancelled' ? 'border-line-strong border-dashed' : 'border-line-strong hover:border-ok hover:bg-ok-soft',
      )}
    >
      <Check className={cn('size-3', done ? 'opacity-100' : 'text-ok opacity-0 group-hover/check:opacity-100')} strokeWidth={3} />
    </button>
  );
}

const Row = memo(function Row({ task, client, today, showClient, selected }: { task: Occurrence; client: Client | undefined; today: ISODate; showClient: boolean; selected: boolean }) {
  const ui = useUI();
  const { patchOccurrence } = useStore();
  const open = isOpen(task.status);
  return (
    <tr
      onClick={() => ui.openTask(task.id)}
      data-selected={selected || undefined}
      className="group h-10 cursor-default border-b border-line last:border-b-0 hover:bg-hover/70 data-[selected]:bg-accent-soft/60"
    >
      <td className="w-9 pl-3"><CompleteToggle task={task} /></td>
      <td className="max-w-0 py-1.5 pr-3">
        <div className="flex min-w-0 items-center gap-2">
          <button
            className={cn('truncate text-left text-[13px] focus-visible:underline', !open && 'text-ink-3', task.status === 'cancelled' && 'line-through')}
            onClick={(e) => { e.stopPropagation(); ui.openTask(task.id); }}
          >
            {task.title}
          </button>
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
      <td className="w-32 pr-3" onClick={(e) => e.stopPropagation()}>
        <DatePicker
          value={task.dueDate}
          today={today}
          onChange={(d) => { if (d !== task.dueDate) void patchOccurrence(task.id, { dueDate: d }, 'Due date changed'); }}
          trigger={<button aria-label={`Due ${task.dueDate}. Change due date`} className="-mx-1.5 rounded px-1.5 py-0.5 hover:bg-sunken"><DueDate date={task.dueDate} today={today} open={open} /></button>}
        />
      </td>
      <td className="hidden w-24 pr-3 sm:table-cell"><PriorityLabel priority={task.priority} compact /></td>
      <td className="hidden w-32 pr-3 sm:table-cell" onClick={(e) => e.stopPropagation()}>
        <StatusPicker status={task.status} onChange={(s) => void patchOccurrence(task.id, { status: s }, 'Status updated')} />
      </td>
    </tr>
  );
});

export function TaskTable({ tasks, showClient = true, header = true, limit }: { tasks: Occurrence[]; showClient?: boolean; header?: boolean; limit?: number }) {
  const { clientById, today } = useStore();
  const ui = useUI();
  const shown = limit ? tasks.slice(0, limit) : tasks;
  return (
    <table className="w-full table-fixed border-collapse">
      {header && (
        <thead>
          <tr className="h-8 border-b border-line text-left text-[11.5px] font-medium text-ink-3">
            <th className="w-9 pl-3"><span className="sr-only">Done</span></th>
            <th className="pr-3 font-medium">Task</th>
            {showClient && <th className="hidden w-[24%] pr-3 font-medium md:table-cell">Client</th>}
            <th className="w-32 pr-3 font-medium">Due</th>
            <th className="hidden w-24 pr-3 font-medium sm:table-cell">Priority</th>
            <th className="hidden w-32 pr-3 font-medium sm:table-cell">Status</th>
          </tr>
        </thead>
      )}
      <tbody>
        {shown.map((t) => <Row key={t.id} task={t} client={clientById.get(t.clientId)} today={today} showClient={showClient} selected={ui.taskId === t.id} />)}
      </tbody>
    </table>
  );
}
