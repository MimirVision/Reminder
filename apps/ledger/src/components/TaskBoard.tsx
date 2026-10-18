// Board view: the same tasks as the list, in status columns. Drag a card to change its status, the way work moves
// from "to do" to "waiting for client" to "done" through an accountant's day.
import { useState, type DragEvent } from 'react';
import { Repeat } from 'lucide-react';
import { useStore } from '../data/store';
import { STATUS_LABEL, TYPE_LABEL } from '../lib/labels';
import { periodLabel } from '../lib/recurrence';
import { isOpen, type Occurrence, type TaskStatus } from '../lib/types';
import { DueDate, PriorityLabel } from '../ui/badges';
import { cn } from '../ui/cn';
import { QuickAdd } from './QuickAdd';
import { CompleteToggle } from './TaskTable';
import { useUI } from './ui-state';

const COLUMNS: TaskStatus[] = ['todo', 'in_progress', 'waiting', 'done'];
const DOT: Record<TaskStatus, string> = { todo: 'bg-ink-3/60', in_progress: 'bg-accent', waiting: 'bg-warn', done: 'bg-ok', cancelled: 'bg-line-strong' };

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
        'group flex cursor-grab flex-col gap-2 rounded-[10px] border border-line bg-surface p-3 text-left shadow-soft transition-[border-color,box-shadow] hover:border-line-strong hover:shadow-pop active:cursor-grabbing',
        ui.taskId === task.id && 'border-accent/60 ring-2 ring-accent/15',
      )}
    >
      <div className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-ink-3">
        <span className="shrink-0 rounded-[5px] bg-sunken px-1.5 py-px text-ink-2">{TYPE_LABEL[task.taskType]}</span>
        {task.periodKey && <span className="inline-flex min-w-0 items-center gap-1 truncate"><Repeat className="size-3 shrink-0" />{periodLabel(task.periodKey)}</span>}
      </div>
      <div className="flex items-start gap-2">
        <span className="mt-px" onClick={(e) => e.stopPropagation()}><CompleteToggle task={task} /></span>
        <span className={cn('min-w-0 flex-1 text-[13.5px] leading-snug font-semibold', !open && 'font-medium text-ink-3 line-through decoration-ink-3/40')}>{task.title}</span>
      </div>
      <span className="truncate pl-[26px] text-[12.5px] text-ink-2">{clientById.get(task.clientId)?.name}</span>
      <div className="flex items-center gap-2 border-t border-line/70 pt-2">
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
        return (
          <section
            key={status}
            aria-label={STATUS_LABEL[status]}
            onDragOver={(e) => { if (e.dataTransfer.types.includes('text/ledger-task')) { e.preventDefault(); setOver(status); } }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver((s) => (s === status ? null : s)); }}
            onDrop={(e) => drop(e, status)}
            className={cn('flex min-h-48 flex-col rounded-[14px] bg-sunken p-2.5 transition-[background-color,box-shadow]', over === status && 'bg-accent-soft ring-2 ring-accent/30')}
          >
            <header className="flex h-8 items-center gap-2 px-1.5">
              <span className={cn('size-2 rounded-full', DOT[status])} aria-hidden />
              <h3 className="text-[13px] font-semibold">{STATUS_LABEL[status]}</h3>
              <span className="num text-[12px] text-ink-3">{list.length}</span>
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
