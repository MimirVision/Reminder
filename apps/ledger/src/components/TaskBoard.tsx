// Board view: the same tasks as the list, in status columns. Drag a card to change its status, the way work moves
// from "to do" to "waiting for client" to "done" through an accountant's day.
import { useState, type DragEvent } from 'react';
import { Repeat } from 'lucide-react';
import { useStore } from '../data/store';
import { STATUS_LABEL } from '../lib/labels';
import { periodLabel } from '../lib/recurrence';
import { isOpen, type Occurrence, type TaskStatus } from '../lib/types';
import { DueDate, PriorityLabel, STATUS_ICON } from '../ui/badges';
import { cn } from '../ui/cn';
import { QuickAdd } from './QuickAdd';
import { CompleteToggle } from './TaskTable';
import { useUI } from './ui-state';

const COLUMNS: TaskStatus[] = ['todo', 'in_progress', 'waiting', 'done'];
const TONE: Record<TaskStatus, string> = { todo: 'text-ink-2', in_progress: 'text-info', waiting: 'text-warn', done: 'text-ok', cancelled: 'text-ink-3' };

function Card({ task }: { task: Occurrence }) {
  const ui = useUI();
  const { clientById, today } = useStore();
  const open = isOpen(task.status);
  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      onDragStart={(e) => { e.dataTransfer.setData('text/ledger-task', task.id); e.dataTransfer.effectAllowed = 'move'; }}
      onClick={() => ui.openTask(task.id)}
      onKeyDown={(e) => { if (e.key === 'Enter') ui.openTask(task.id); }}
      className={cn(
        'group flex cursor-grab flex-col gap-1.5 rounded-lg border border-line bg-surface p-2.5 text-left transition-[border-color,box-shadow] hover:border-line-strong hover:shadow-pop active:cursor-grabbing',
        ui.taskId === task.id && 'border-accent/60 ring-2 ring-accent/15',
      )}
    >
      <div className="flex items-start gap-2">
        <span className="mt-px" onClick={(e) => e.stopPropagation()}><CompleteToggle task={task} /></span>
        <span className={cn('min-w-0 flex-1 text-[13px] leading-snug font-medium', !open && 'text-ink-3 line-through decoration-ink-3/40')}>{task.title}</span>
      </div>
      <div className="flex min-w-0 items-center gap-1.5 pl-[26px] text-[12px] text-ink-2">
        <span className="truncate">{clientById.get(task.clientId)?.name}</span>
        {task.periodKey && <span className="inline-flex shrink-0 items-center gap-1 text-[11.5px] text-ink-3"><Repeat className="size-3" />{periodLabel(task.periodKey)}</span>}
      </div>
      <div className="flex items-center gap-2 pl-[26px]">
        <DueDate date={task.dueDate} today={today} open={open} />
        <span className="ml-auto"><PriorityLabel priority={task.priority} compact /></span>
      </div>
    </div>
  );
}

export function TaskBoard({ tasks }: { tasks: Occurrence[] }) {
  const { patchOccurrence } = useStore();
  const [over, setOver] = useState<TaskStatus | null>(null);

  const drop = (e: DragEvent, status: TaskStatus) => {
    e.preventDefault();
    setOver(null);
    const id = e.dataTransfer.getData('text/ledger-task');
    const t = tasks.find((x) => x.id === id);
    if (t && t.status !== status) void patchOccurrence(id, { status }, `${STATUS_LABEL[status]}: ${t.title}`);
  };

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
      {COLUMNS.map((status) => {
        const list = tasks.filter((t) => t.status === status);
        const Icon = STATUS_ICON[status];
        return (
          <section
            key={status}
            aria-label={STATUS_LABEL[status]}
            onDragOver={(e) => { if (e.dataTransfer.types.includes('text/ledger-task')) { e.preventDefault(); setOver(status); } }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver((s) => (s === status ? null : s)); }}
            onDrop={(e) => drop(e, status)}
            className={cn('flex min-h-48 flex-col rounded-xl bg-sunken/70 p-2 transition-[background-color,box-shadow]', over === status && 'bg-accent-soft ring-2 ring-accent/30')}
          >
            <header className="flex h-8 items-center gap-2 px-1.5">
              <Icon className={cn('size-4', TONE[status])} strokeWidth={2.2} />
              <h3 className="text-[12.5px] font-semibold">{STATUS_LABEL[status]}</h3>
              <span className="tnum text-[12px] text-ink-3">{list.length}</span>
            </header>
            {status !== 'done' && (
              <div className="mb-2 overflow-clip rounded-lg border border-dashed border-line-strong bg-surface/60">
                <QuickAdd variant="row" status={status} />
              </div>
            )}
            <div className="flex flex-col gap-2">
              {list.map((t) => <Card key={t.id} task={t} />)}
              {!list.length && (
                <p className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-[12px] text-ink-3">
                  {status === 'done' ? 'Drag a task here to finish it.' : 'Nothing here.'}
                </p>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
