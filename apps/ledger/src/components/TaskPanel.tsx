import { useEffect, useRef, useState } from 'react';
import { CalendarDays, Check, CircleSlash, History, MoreHorizontal, Repeat, RotateCcw, Trash2, X, ChevronDown, ChevronUp, Copy, Mail, Clock3 } from 'lucide-react';
import { useStore } from '../data/store';
import { addDays, diffDays, localISODate, minutesNow, weekday, type ISODate } from '../lib/dates';
import { fromMinutes, isTime, toMinutes } from '../lib/meetings';
import { formatDate, formatDayLong, formatTimestamp, relativeDue } from '../lib/format';
import { PRIORITY_LABEL, TYPE_LABEL } from '../lib/labels';
import { describeRecurrence, periodLabel, taskPeriod } from '../lib/recurrence';
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
import { ReminderPicker } from './Notifications';
import { outstanding } from './ClientDocuments';
import { RequestDocumentsDialog } from './RequestDocuments';
import { chainOf, possibleSteps, waitingOn } from '../lib/chains';
import { notifySettings } from '../lib/reminders';
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
  const [asking, setAsking] = useState(false);
  useEffect(() => setTitle(task.title), [task.title]);
  useEffect(() => setNotes(task.description), [task.description]);
  // By value: a reload brings a new array with the same tags, which must not wipe what is being typed.
  const savedTags = task.tags.join(', ');
  useEffect(() => setTags(savedTags), [savedTags]);

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
        {client && isOpen(task.status) && outstanding(client).length > 0 && (
          <button type="button" onClick={() => setAsking(true)} className="mt-0.5 ml-3 inline-flex items-center gap-1 text-[12.5px] text-accent hover:underline">
            <Mail className="size-3.5" /> Request {outstanding(client).length} missing document{outstanding(client).length === 1 ? '' : 's'}
          </button>
        )}
        {asking && client && <RequestDocumentsDialog client={client} task={task} open onOpenChange={setAsking} />}

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
          {isOpen(task.status) && (
            <Row label="Notify">
              <ReminderPicker kind="days" value={task.notifyDays} disabled={!repo.notify}
                inherited={schedule?.notifyDays ?? notifySettings(snap.workspace.settings.notifications).taskDays}
                inheritedFrom={schedule?.notifyDays ? 'its schedule' : 'Settings'}
                onChange={(v) => void patchOccurrence(task.id, { notifyDays: v }, v === null ? 'Using the default notifications' : 'Notifications saved')} />
            </Row>
          )}
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
          {repo.flow && (isOpen(task.status) || task.plannedOn) && <Row label="Time"><PlannedTime task={task} /></Row>}
          {repo.flow && <Row label="Steps"><Steps task={task} /></Row>}
          {!schedule && taskPeriod(task) && <Row label="Period"><span className="text-[13px] text-ink-2">{taskPeriod(task)}</span></Row>}
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

/**
 * The chain a task is part of (lønnsgrunnlag → lønnskjøring → A-melding), and which step it comes after. A step that
 * comes after an open one isn't ready yet; finishing a step says which ones are ready next.
 */
function Steps({ task }: { task: Occurrence }) {
  const { snap, today, patchOccurrence } = useStore();
  const ui = useUI();
  const byId = new Map(snap.occurrences.map((o) => [o.id, o]));
  const chain = chainOf(task, snap.occurrences);
  const options = possibleSteps(task, snap.occurrences);
  const before = task.afterId ? byId.get(task.afterId) : undefined;
  const blocked = isOpen(task.status) ? waitingOn(task, byId) : null;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {chain.length > 1 && (
        <ol className="flex flex-col" aria-label="Steps in order">
          {chain.map((s, i) => {
            const here = s.id === task.id;
            const done = s.status === 'done', cancelled = s.status === 'cancelled';
            return (
              <li key={s.id} className="relative flex min-w-0 items-center gap-2 py-1 pl-0.5">
                {/* The line joining the steps. */}
                {i < chain.length - 1 && <span aria-hidden className="absolute top-[18px] bottom-[-6px] left-[8px] w-px bg-line-strong" />}
                <span aria-hidden className={cn('relative z-[1] flex size-[15px] shrink-0 items-center justify-center rounded-full border-[1.5px] bg-surface',
                  done ? 'border-ok bg-ok text-white' : cancelled ? 'border-dashed border-line-strong' : here ? 'border-accent' : 'border-line-strong')}>
                  {done && <Check className="size-2.5" strokeWidth={3.5} />}
                </span>
                {here ? <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{s.title}</span>
                  : <button type="button" onClick={() => ui.openTask(s.id)} className={cn('min-w-0 flex-1 truncate text-left text-[13px] hover:text-accent hover:underline', done || cancelled ? 'text-ink-3' : 'text-ink-2')}>{s.title}</button>}
                <span className={cn('num shrink-0 text-[11.5px]', isOpen(s.status) && s.dueDate < today ? 'text-danger' : 'text-ink-3')}>{formatDate(s.dueDate)}</span>
              </li>
            );
          })}
        </ol>
      )}
      {blocked && <p className="text-[12px] text-warn">Waiting for “{blocked.title}” to be done first.</p>}
      <label className="flex min-w-0 items-center gap-2 text-[12.5px] text-ink-3">
        <span className="shrink-0">Comes after</span>
        <Select className="min-w-0 flex-1" aria-label="Comes after" value={task.afterId ?? ''}
          onChange={(e) => void patchOccurrence(task.id, { afterId: e.target.value || null }, e.target.value ? 'Linked as the next step' : 'No longer comes after another step')}>
          <option value="">Nothing: it can start any time</option>
          {before && !options.some((o) => o.id === before.id) && <option value={before.id}>{before.title}</option>}
          {options.map((o) => <option key={o.id} value={o.id}>{o.title} · {formatDate(o.dueDate)}{isOpen(o.status) ? '' : ' (done)'}</option>)}
        </Select>
      </label>
    </div>
  );
}

/** Time set aside for the task in the calendar: set it, move it, or clear it (the same as dragging it in the calendar). */
function PlannedTime({ task }: { task: Occurrence }) {
  const { today, patchOccurrence } = useStore();
  const set = (p: Pick<Occurrence, 'plannedOn' | 'plannedStart' | 'plannedEnd'>, msg: string) => void patchOccurrence(task.id, p, msg);
  if (!task.plannedOn || !task.plannedStart || !task.plannedEnd) {
    // The next half hour within working hours, today (or on the due date if that is later and today is past it).
    const nowMin = minutesNow();
    const start = Math.min(Math.max(Math.ceil((nowMin + 1) / 30) * 30, 8 * 60), 16 * 60);
    const day = nowMin >= 16 * 60 ? addDays(today, 1) : today;
    return (
      <button type="button" onClick={() => set({ plannedOn: day, plannedStart: fromMinutes(start), plannedEnd: fromMinutes(start + 60) }, 'Time set aside. Move it in the calendar or here.')}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-dashed border-line-strong px-2.5 text-[13px] text-ink-2 hover:border-accent/50 hover:bg-accent-soft/40 hover:text-ink">
        <Clock3 className="size-4 text-ink-3" /> Set aside time…
      </button>
    );
  }
  const len = toMinutes(task.plannedEnd) - toMinutes(task.plannedStart);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <DatePicker value={task.plannedOn} today={today} onChange={(d) => d !== task.plannedOn && set({ plannedOn: d, plannedStart: task.plannedStart, plannedEnd: task.plannedEnd }, `Moved to ${formatDayLong(d)}`)} trigger={
        <button className="flex h-8 items-center gap-2 rounded-md border border-line-strong bg-surface px-2.5 text-[13px] hover:bg-hover">
          <Clock3 className="size-4 text-ink-3" /><span className="tnum">{formatDayLong(task.plannedOn)}</span>
        </button>
      } />
      <span className="w-[104px]"><Input type="time" step={900} aria-label="Starts" defaultValue={task.plannedStart} key={`s${task.plannedStart}`}
        onBlur={(e) => {
          const v = e.target.value;
          if (!isTime(v) || v === task.plannedStart) return;
          // Moving the start keeps the length.
          set({ plannedOn: task.plannedOn, plannedStart: v, plannedEnd: fromMinutes(Math.min(toMinutes(v) + len, 23 * 60 + 59)) }, `Starts at ${v}`);
        }} /></span>
      <span className="text-ink-3">–</span>
      <span className="w-[104px]"><Input type="time" step={900} aria-label="Ends" defaultValue={task.plannedEnd} key={`e${task.plannedEnd}`}
        onBlur={(e) => { const v = e.target.value; if (isTime(v) && v !== task.plannedEnd && v > task.plannedStart!) set({ plannedOn: task.plannedOn, plannedStart: task.plannedStart, plannedEnd: v }, `Ends at ${v}`); }} /></span>
      <button type="button" onClick={() => set({ plannedOn: null, plannedStart: null, plannedEnd: null }, 'Time no longer set aside')}
        className="h-8 rounded-md px-2 text-[12.5px] text-ink-3 hover:bg-hover hover:text-danger">Clear</button>
    </div>
  );
}

