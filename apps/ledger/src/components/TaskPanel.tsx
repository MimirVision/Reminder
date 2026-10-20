import { useEffect, useRef, useState } from 'react';
import { CalendarDays, Check, CircleSlash, History, MoreHorizontal, Repeat, RotateCcw, Trash2, X, ChevronDown, ChevronUp, Copy } from 'lucide-react';
import { useStore } from '../data/store';
import { addDays, diffDays, localISODate, weekday, type ISODate } from '../lib/dates';
import { formatDate, formatDayLong, formatTimestamp, relativeDue } from '../lib/format';
import { PRIORITY_LABEL, TYPE_LABEL } from '../lib/labels';
import { describeRecurrence, periodLabel } from '../lib/recurrence';
import { PRIORITIES, TASK_TYPES, isOpen, type Occurrence } from '../lib/types';
import { StatusPicker } from '../ui/badges';
import { cn } from '../ui/cn';
import { Button, IconButton } from '../ui/button';
import { DatePicker } from '../ui/datepicker';
import { Input, Select, Textarea } from '../ui/field';
import { Confirm, Menu, MenuItem, Sheet, SheetClose } from '../ui/overlay';
import { ActivityList } from './ActivityList';
import { useTaskActions } from './TaskTable';
import { ChecklistEditor, progressOf } from './Checklist';
import { useUI } from './ui-state';
import { Link } from '../router';

export function TaskPanel() {
  const ui = useUI();
  const { snap } = useStore();
  const task = snap.occurrences.find((o) => o.id === ui.taskId);
  return (
    <Sheet open={!!ui.taskId} onOpenChange={(o) => !o && ui.openTask(null)} title={task?.title ?? 'Task'}>
      {task ? <TaskDetail key={task.id} task={task} /> : ui.taskId ? <Gone /> : null}
    </Sheet>
  );
}

function Gone() {
  const ui = useUI();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-ink-3">
      <p>This task no longer exists.</p>
      <Button onClick={() => ui.openTask(null)}>Close</Button>
    </div>
  );
}

/** "today", "1 day", "12 days": how long a task has been with the client. */
export function waitedDays(since: string, today: ISODate): string {
  const n = Math.max(0, diffDays(today, localISODate(new Date(since))));
  return n === 0 ? 'since today' : `${n} day${n === 1 ? '' : 's'}`;
}

/** Previous and next task in the list behind the panel (the rows on screen), with J and K. */
function Neighbours({ id }: { id: string }) {
  const ui = useUI();
  const step = (d: 1 | -1) => {
    const ids = [...document.querySelectorAll<HTMLElement>('tr[data-task]')].map((r) => r.dataset.task!);
    const i = ids.indexOf(id);
    const next = i < 0 ? undefined : ids[i + d];
    if (next) {
      ui.openTask(next);
      document.querySelector(`tr[data-task="${next}"]`)?.scrollIntoView({ block: 'nearest' });
    }
  };
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement).closest('input,textarea,select,[contenteditable],[role=menu]')) return;
      if (e.key === 'j' || e.key === 'k') { e.preventDefault(); step(e.key === 'j' ? 1 : -1); }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  });
  const ids = typeof document === 'undefined' ? [] : [...document.querySelectorAll<HTMLElement>('tr[data-task]')].map((r) => r.dataset.task!);
  const i = ids.indexOf(id);
  if (i < 0) return null;
  return (
    <div className="flex items-center">
      <IconButton label="Previous task (K)" disabled={i === 0} onClick={() => step(-1)}><ChevronUp /></IconButton>
      <IconButton label="Next task (J)" disabled={i === ids.length - 1} onClick={() => step(1)}><ChevronDown /></IconButton>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[112px_1fr] items-center gap-3 py-1.5">
      <div className="text-[12.5px] text-ink-3">{label}</div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function TaskDetail({ task }: { task: Occurrence }) {
  const ui = useUI();
  const { snap, today, clientById, scheduleById, patchOccurrence, run, repo } = useStore();
  const actions = useTaskActions();
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.description);
  const [tags, setTags] = useState(task.tags.join(', '));
  const [confirm, setConfirm] = useState<'delete' | 'cancel' | null>(null);
  useEffect(() => setTitle(task.title), [task.title]);
  useEffect(() => setNotes(task.description), [task.description]);
  useEffect(() => setTags(task.tags.join(', ')), [task.tags]);

  const schedule = task.scheduleId ? scheduleById.get(task.scheduleId) : undefined;
  const client = clientById.get(task.clientId);
  const moved = task.scheduledDueDate && task.scheduledDueDate !== task.dueDate;
  const activeClients = snap.clients.filter((c) => c.status === 'active' || c.id === task.clientId);
  const history = snap.activity.filter((a) => a.entityId === task.id);

  const saveTitle = () => {
    const t = title.trim();
    if (!t) { setTitle(task.title); return; }
    if (t !== task.title) void patchOccurrence(task.id, { title: t }, 'Saved');
  };
  const saveTags = () => {
    const list = [...new Set(tags.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean))].slice(0, 20);
    if (list.join(',') !== task.tags.join(',')) void patchOccurrence(task.id, { tags: list }, 'Saved');
  };
  const saveNotes = () => { if (notes !== task.description) void patchOccurrence(task.id, { description: notes }, 'Notes saved'); };
  // Closing the panel (Escape, the X, another task) never loses what was typed: anything unsaved is saved on the way out.
  const latest = useRef({ saveTitle, saveTags, saveNotes });
  latest.current = { saveTitle, saveTags, saveNotes };
  useEffect(() => () => { latest.current.saveTitle(); latest.current.saveNotes(); latest.current.saveTags(); }, []);

  return (
    <>
      <div className="flex h-[52px] shrink-0 items-center gap-2 border-b border-line px-4">
        <StatusPicker status={task.status} short={false} onChange={(s) => void patchOccurrence(task.id, { status: s }, 'Status updated')} />
        <div className="flex-1" />
        <Neighbours id={task.id} />
        {isOpen(task.status)
          ? <Button size="sm" variant="primary" onClick={() => void patchOccurrence(task.id, { status: 'done' }, 'Marked done')}><Check /> Mark done</Button>
          : <Button size="sm" onClick={() => void patchOccurrence(task.id, { status: 'todo' }, 'Reopened')}><RotateCcw /> Reopen</Button>}
        <Menu align="end" label="More actions" trigger={<IconButton label="More actions"><MoreHorizontal /></IconButton>}>
          <MenuItem onSelect={() => void actions.duplicate(task)}><Copy /> Duplicate</MenuItem>
          {task.scheduleId ? (
            <MenuItem onSelect={() => setConfirm('cancel')} disabled={task.status === 'cancelled'}><CircleSlash /> Cancel this occurrence</MenuItem>
          ) : (
            <MenuItem danger onSelect={() => setConfirm('delete')}><Trash2 /> Delete task</MenuItem>
          )}
        </Menu>
        <SheetClose asChild><IconButton label="Close panel"><X /></IconButton></SheetClose>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <label htmlFor="task-title" className="sr-only">Title</label>
        <textarea
          id="task-title"
          value={title}
          rows={1}
          onChange={(e) => setTitle(e.target.value.replace(/\n/g, ''))}
          onBlur={saveTitle}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); } }}
          maxLength={200}
          className="-mx-1.5 w-[calc(100%+12px)] resize-none rounded-md px-1.5 py-1 text-[18px] leading-snug font-semibold tracking-[-0.015em] [field-sizing:content] hover:bg-hover focus:bg-surface focus:ring-2 focus:ring-accent/20 focus:outline-none"
        />
        {client && (
          <Link to={`/clients/${client.id}`} onClick={() => ui.openTask(null)} className="mt-0.5 inline-block text-[13px] text-ink-2 hover:text-accent hover:underline">
            {client.name}{client.reference && <span className="text-ink-3"> · {client.reference}</span>}
          </Link>
        )}

        <div className="mt-5 border-t border-line pt-3">
          <Row label="Due">
            <div className="flex flex-wrap items-center gap-2">
              <DatePicker value={task.dueDate} today={today} onChange={(d) => d !== task.dueDate && void patchOccurrence(task.id, { dueDate: d }, `Due ${formatDate(d)}`)} trigger={
                <button className="flex h-8 items-center gap-2 rounded-md border border-line-strong bg-surface px-2.5 text-[13px] hover:bg-hover">
                  <CalendarDays className="size-4 text-ink-3" />
                  <span className="tnum">{formatDayLong(task.dueDate)}</span>
                </button>
              } />
              {isOpen(task.status) && (
                <span className={cn('text-[12.5px]', task.dueDate < today ? 'font-medium text-danger' : task.dueDate === today ? 'font-medium text-accent-ink' : 'text-ink-3')}>
                  {relativeDue(task.dueDate, today).replace(/^./, (c) => c.toUpperCase())}
                </span>
              )}
            </div>
            {isOpen(task.status) && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {([['Today', today], ['Tomorrow', addDays(today, 1)], ['Next Monday', addDays(today, ((1 - weekday(today) + 7) % 7) || 7)], ['+1 week', addDays(task.dueDate < today ? today : task.dueDate, 7)]] as const).map(([label, d]) => (
                  <button key={label} disabled={d === task.dueDate} onClick={() => void patchOccurrence(task.id, { dueDate: d }, `Due ${formatDate(d)}`)}
                    className="h-6 rounded-md border border-line px-2 text-[12px] text-ink-2 hover:border-line-strong hover:bg-hover hover:text-ink disabled:opacity-40">
                    {label}
                  </button>
                ))}
              </div>
            )}
            {moved && (
              <div className="mt-1.5 flex items-center gap-2 text-[12px] text-ink-3">
                Moved from {formatDate(task.scheduledDueDate!)}. The schedule is unchanged.
                <button className="inline-flex items-center gap-1 text-accent hover:underline" onClick={() => void patchOccurrence(task.id, { dueDate: task.scheduledDueDate! }, 'Back on the scheduled date')}>
                  <RotateCcw className="size-3" /> Reset
                </button>
              </div>
            )}
          </Row>
          <Row label="Priority">
            <Select className="w-40" aria-label="Priority" value={task.priority} onChange={(e) => void patchOccurrence(task.id, { priority: e.target.value as Occurrence['priority'] }, 'Saved')}>
              {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
            </Select>
          </Row>
          <Row label="Type">
            <Select className="w-40" aria-label="Type" value={task.taskType} onChange={(e) => void patchOccurrence(task.id, { taskType: e.target.value as Occurrence['taskType'] }, 'Saved')}>
              {TASK_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
            </Select>
          </Row>
          {!task.scheduleId && (
            <Row label="Client">
              <Select aria-label="Client" value={task.clientId} onChange={(e) => void patchOccurrence(task.id, { clientId: e.target.value }, 'Saved')}>
                {activeClients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Row>
          )}
          <Row label="Tags">
            <Input aria-label="Tags, separated by commas" placeholder="receipts, year-end" value={tags} onChange={(e) => setTags(e.target.value)} onBlur={saveTags}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
          </Row>
          {schedule && (
            <Row label="Recurring">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
                <span className="inline-flex items-center gap-1.5 text-ink-2"><Repeat className="size-3.5 text-ink-3" />{periodLabel(task.periodKey!)}</span>
                <span className="text-ink-3">· {describeRecurrence(schedule)}</span>
                <button className="text-accent hover:underline" onClick={() => ui.openSchedule({ mode: 'edit', id: schedule.id })}>Open schedule</button>
              </div>
            </Row>
          )}
          {task.status === 'waiting' && task.waitingSince && (
            <Row label="Waiting since">
              <span className="text-[13px] text-ink-2"><span className="num">{formatTimestamp(task.waitingSince)}</span>
                <span className="text-ink-3"> · {waitedDays(task.waitingSince, today)}</span></span>
            </Row>
          )}
          {task.completedAt && <Row label="Completed"><span className="tnum text-[13px] text-ink-2">{formatTimestamp(task.completedAt)}</span></Row>}
        </div>

        {repo.current && (
          <div className="mt-5">
            <ChecklistEditor items={task.checklist} onChange={(checklist) => void patchOccurrence(task.id, { checklist })} />
            {isOpen(task.status) && progressOf(task.checklist).complete && (
              <div className="mt-2 flex items-center gap-2 rounded-lg bg-ok-soft px-3 py-2 text-[12.5px] text-ok">
                <Check className="size-4" /> Every step is ticked.
                <button className="ml-auto font-medium underline-offset-2 hover:underline" onClick={() => void patchOccurrence(task.id, { status: 'done' }, 'Marked done')}>Mark the task done</button>
              </div>
            )}
          </div>
        )}

        <div className="mt-4">
          <label htmlFor="task-notes" className="mb-1.5 block text-[12.5px] font-medium text-ink-2">Notes</label>
          <Textarea id="task-notes" rows={5} maxLength={10000} placeholder="Add notes, what you’re waiting for, links…" value={notes}
            onChange={(e) => setNotes(e.target.value)} onBlur={saveNotes} />
        </div>

        <div className="mt-6">
          <h3 className="mb-2 flex items-center gap-1.5 text-[12.5px] font-medium text-ink-2"><History className="size-3.5" /> History</h3>
          <ActivityList items={history} empty="No changes yet." />
        </div>
      </div>

      <Confirm open={confirm === 'delete'} onOpenChange={(o) => !o && setConfirm(null)} title="Delete this task?" confirmLabel="Delete task"
        body={<>“{task.title}” will be removed. This can’t be undone.</>}
        onConfirm={async () => { const ok = await run(async (r) => { await r.deleteOccurrence(task.id); return true; }, { success: 'Task deleted' }); if (ok) ui.openTask(null); }} />
      <Confirm open={confirm === 'cancel'} onOpenChange={(o) => !o && setConfirm(null)} title="Cancel this occurrence?" confirmLabel="Cancel occurrence" tone="primary"
        body={<>The task for {periodLabel(task.periodKey ?? '')} is kept as cancelled, so the period stays accounted for and is not reported missing. The schedule itself is not changed.</>}
        onConfirm={() => patchOccurrence(task.id, { status: 'cancelled' }, 'Occurrence cancelled')} />
    </>
  );
}
