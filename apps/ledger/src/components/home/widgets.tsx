// The widgets Home can show. Each one fills the cell the dashboard gives it and scrolls inside if it needs to.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, CalendarCheck, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Pin, Sun, Users } from 'lucide-react';
import { useStore } from '../../data/store';
import { addDays, addMonths, diffDays, isoWeek, localISODate, monthGrid, parts, startOfMonth, startOfWeek, type ISODate } from '../../lib/dates';
import { sortTasks } from '../../lib/filters';
import { formatDate, formatDayLong, formatDue, formatMonth, formatWeekdayShort, greeting } from '../../lib/format';
import { TYPE_LABEL } from '../../lib/labels';
import { needsReview } from '../../lib/missing';
import { isOpen, TASK_TYPES, type Occurrence } from '../../lib/types';
import { UPCOMING_CHOICES, type WidgetItem } from '../../lib/widgets';
import { Link, useRoute } from '../../router';
import { cn } from '../../ui/cn';
import { MenuRadio, Menu } from '../../ui/overlay';
import { QuietLine } from '../../ui/states';
import { ActivityList } from '../ActivityList';
import { QuickAdd } from '../QuickAdd';
import { TaskTable } from '../TaskTable';
import { useUI } from '../ui-state';

export interface WidgetProps { item: WidgetItem; update: (patch: Partial<WidgetItem>) => void }

/** The card most widgets sit in: a header with title, count and an action, and a body that scrolls. */
function Frame({ title, count, action, children, tone, padded }: { title: string; count?: ReactNode; action?: ReactNode; children: ReactNode; tone?: 'danger'; padded?: boolean }) {
  return (
    <section aria-label={title} className="flex h-full min-h-0 flex-col overflow-clip rounded-xl border border-line bg-surface">
      <header className="flex h-[50px] shrink-0 items-center gap-2.5 border-b border-line px-[18px]">
        <h2 className={cn('truncate text-[15px] font-semibold tracking-[-0.01em]', tone === 'danger' ? 'text-danger' : 'text-ink')}>{title}</h2>
        {count !== undefined && <span className="num shrink-0 text-[12px] text-ink-3">{count}</span>}
        <div className="ml-auto shrink-0">{action}</div>
      </header>
      <div className={cn('@container min-h-0 flex-1 overflow-y-auto', padded && 'px-[18px] py-3.5')}>{children}</div>
    </section>
  );
}

const linkCls = 'text-[12.5px] text-accent hover:underline';

function useOpenTasks() {
  const { snap } = useStore();
  return useMemo(() => snap.occurrences.filter((o) => isOpen(o.status)), [snap.occurrences]);
}

function useDoneToday() {
  const { snap, today } = useStore();
  // Finished today (by local date), including work that was due earlier: it all counts towards today.
  return useMemo(() => snap.occurrences
    .filter((o) => o.status === 'done' && o.completedAt && localISODate(new Date(o.completedAt)) === today)
    .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? '')), [snap.occurrences, today]);
}

/** A count inside the summary sentence that is also a link to the matching list. */
function Count({ n, label, to, tone }: { n: number; label: string; to: string; tone: 'danger' | 'accent' | 'warn' | 'neutral' }) {
  const tones = { danger: 'text-danger', accent: 'text-accent-ink', warn: 'text-warn', neutral: 'text-ink' };
  return (
    <Link to={to} className={cn('font-medium underline decoration-current/25 underline-offset-[3px] hover:decoration-current', n > 0 ? tones[tone] : 'text-ink-3')}>
      <span className="tnum">{n}</span> {label}
    </Link>
  );
}

function DayRing({ done, planned }: { done: number; planned: number }) {
  const r = 21, c = 2 * Math.PI * r;
  return (
    <div className="flex shrink-0 items-center gap-3.5 rounded-xl border border-line bg-surface py-3 pr-5 pl-3" role="img" aria-label={`${done} of ${planned} done today`}>
      <svg width="52" height="52" viewBox="0 0 52 52" aria-hidden>
        <circle cx="26" cy="26" r={r} fill="none" stroke="var(--c-sunken)" strokeWidth="6" />
        <circle cx="26" cy="26" r={r} fill="none" stroke="var(--c-ok)" strokeWidth="6" strokeLinecap="round" transform="rotate(-90 26 26)"
          strokeDasharray={`${(planned ? done / planned : 0) * c} ${c}`} className="transition-[stroke-dasharray] duration-500" />
      </svg>
      <div className="flex flex-col">
        <span className="num text-[20px] leading-tight font-medium">{done}<span className="text-ink-3">/{planned}</span></span>
        <span className="text-[12px] text-ink-3">done today</span>
      </div>
    </div>
  );
}

export function GreetingWidget() {
  const { snap, today, expected } = useStore();
  const open = useOpenTasks();
  const doneToday = useDoneToday();
  const dueToday = open.filter((o) => o.dueDate === today);
  const overdue = open.filter((o) => o.dueDate < today).length;
  const upcoming = open.filter((o) => o.dueDate > today && o.dueDate <= addDays(today, 14)).length;
  const review = needsReview(expected).length;
  const urgent = dueToday.filter((t) => t.priority === 'urgent' || t.priority === 'high').length;
  const planned = dueToday.length + doneToday.length;
  const name = snap.workspace.settings.displayName?.trim();
  return (
    <section className="flex h-full flex-wrap items-center gap-6">
      <div className="flex min-w-0 flex-[1_1_360px] flex-col gap-1.5">
        <span className="num text-[11.5px] tracking-[0.08em] text-ink-3 uppercase">{formatDayLong(today)} · Week {isoWeek(today).week}</span>
        <h1 className="text-[32px] leading-[1.1] font-semibold tracking-[-0.025em]">{greeting()}{name ? `, ${name}` : ''}</h1>
        <nav aria-label="Summary" className="mt-1 text-[14.5px] text-ink-2">
          <Count n={dueToday.length} label="due today" to="/tasks?view=today" tone="accent" />,{' '}
          <Count n={overdue} label="overdue" to="/tasks?view=overdue" tone="danger" />,{' '}
          <Count n={upcoming} label="in the next 14 days" to="/tasks?status=todo,in_progress,waiting&due=next_14" tone="neutral" /> and{' '}
          <Count n={review} label="missing to review" to="/missing" tone="warn" />.
          {urgent > 0 && <> Start with the {urgent} high-priority task{urgent === 1 ? '' : 's'} due today.</>}
        </nav>
      </div>
      {planned > 0 && <DayRing done={doneToday.length} planned={planned} />}
    </section>
  );
}

export function QuickAddWidget() {
  return (
    <div className="flex h-full flex-col gap-2 overflow-hidden">
      <QuickAdd />
      <p className="px-1 text-[12px] text-ink-3">
        Type <span className="num text-ink-2">@</span> for a client, a date like <span className="num text-ink-2">fri</span> or <span className="num text-ink-2">15.11</span>,
        {' '}<span className="num text-ink-2">!</span> or <span className="num text-ink-2">!!</span> for priority and <span className="num text-ink-2">#</span> for tags. Enter adds it.
      </p>
    </div>
  );
}

export function TodayWidget() {
  const { today, clientById } = useStore();
  const open = useOpenTasks();
  const doneToday = useDoneToday();
  const dueToday = useMemo(() => sortTasks(open.filter((o) => o.dueDate === today), 'priority', clientById), [open, today, clientById]);
  const [showDone, setShowDone] = useState(false);
  return (
    <Frame title="Today" count={dueToday.length ? `${dueToday.length} open` : undefined} action={<Link to="/tasks?view=today" className={linkCls}>Open in My Tasks</Link>}>
      <TaskTable tasks={dueToday} header={false} stacked addRow={{ dueDate: today }} />
      {!dueToday.length && <QuietLine icon={doneToday.length ? CheckCircle2 : Sun}>{doneToday.length ? 'Everything due today is done.' : 'Nothing due today.'}</QuietLine>}
      {doneToday.length > 0 && (
        <>
          <button onClick={() => setShowDone((v) => !v)} aria-expanded={showDone}
            className="flex h-10 w-full items-center gap-2 border-t border-line px-[18px] text-left text-[12.5px] text-ink-3 hover:bg-hover/60 hover:text-ink">
            <CheckCircle2 className="size-3.5 text-ok" /> <span className="tnum">{doneToday.length}</span> finished today
            <ChevronDown className={cn('ml-auto size-3.5 transition-transform', showDone && 'rotate-180')} />
          </button>
          {showDone && <div className="border-t border-line"><TaskTable tasks={doneToday} header={false} stacked /></div>}
        </>
      )}
    </Frame>
  );
}

export function OverdueWidget() {
  const { today, clientById } = useStore();
  const open = useOpenTasks();
  const overdue = useMemo(() => sortTasks(open.filter((o) => o.dueDate < today), 'due', clientById), [open, today, clientById]);
  return (
    <Frame title="Overdue" tone={overdue.length ? 'danger' : undefined} count={overdue.length || undefined}
      action={overdue.length > 0 && <Link to="/tasks?view=overdue" className={linkCls}>Review all</Link>}>
      {overdue.length ? <TaskTable tasks={overdue} header={false} stacked /> : <QuietLine icon={CheckCircle2}>Nothing overdue. Everything due so far is done or rescheduled.</QuietLine>}
    </Frame>
  );
}

export function UpcomingWidget({ item, update }: WidgetProps) {
  const { today, clientById } = useStore();
  const open = useOpenTasks();
  const days = item.days ?? 14;
  const list = useMemo(() => sortTasks(open.filter((o) => o.dueDate > today && o.dueDate <= addDays(today, days)), 'due', clientById), [open, today, days, clientById]);
  return (
    <Frame title={`Next ${days} days`} count={list.length || undefined} action={
      <Menu label="How far ahead" align="end" trigger={<button className="inline-flex items-center gap-1 text-[12.5px] text-ink-2 hover:text-ink">{days} days <ChevronDown className="size-3.5" /></button>}>
        <MenuRadio value={String(days)} onChange={(v) => update({ days: Number(v) })} options={UPCOMING_CHOICES.map((d) => ({ value: String(d), label: `Next ${d} days` }))} />
      </Menu>
    }>
      {list.length ? <TaskTable tasks={list} header={false} stacked groupBy="day" collapsible={false} /> : <QuietLine icon={CalendarCheck}>No deadlines in the next {days} days.</QuietLine>}
    </Frame>
  );
}

export function WeekWidget() {
  const { today } = useStore();
  const open = useOpenTasks();
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(today, i);
    return { d, n: open.filter((o) => o.dueDate === d).length };
  });
  const max = Math.max(1, ...week.map((w) => w.n));
  return (
    <Frame title="This week" padded>
      <ul className="flex flex-col gap-2.5">
        {week.map(({ d, n }) => (
          <li key={d}>
            <Link to={`/calendar?view=week&date=${d}`} className="group flex items-center gap-2.5" aria-label={`${formatDate(d)}: ${n} due`}>
              <span className={cn('num w-11 text-[12px]', d === today ? 'font-medium text-accent-ink' : 'text-ink-3')}>{d === today ? 'Today' : formatWeekdayShort(d)}</span>
              <span className="h-2 flex-1 overflow-hidden rounded-full bg-sunken">
                <span className="block h-full rounded-full bg-accent transition-[width] duration-500 group-hover:bg-accent-hover" style={{ width: `${(n / max) * 100}%` }} />
              </span>
              <span className="num w-6 text-right text-[12px]">{n}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Frame>
  );
}

export function WaitingWidget() {
  const { today, clientById } = useStore();
  const ui = useUI();
  const open = useOpenTasks();
  // Most overdue first: what is furthest past its deadline is what to chase.
  const waiting = useMemo(() => open.filter((o) => o.status === 'waiting').sort((a, b) => a.dueDate.localeCompare(b.dueDate)), [open]);
  return (
    <Frame title="Waiting on clients" count={waiting.length} padded
      action={waiting.length > 0 && <Link to="/tasks?view=waiting" className={linkCls}>All</Link>}>
      {waiting.length ? (
        <ul className="-mx-2 flex flex-col">
          {waiting.map((t) => {
            const late = diffDays(today, t.dueDate);
            return (
              <li key={t.id}>
                <button onClick={() => ui.openTask(t.id)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-hover">
                  <span className="min-w-0 flex-1 truncate">{t.title} <span className="text-ink-3">· {clientById.get(t.clientId)?.name}</span></span>
                  <span className={cn('num shrink-0 text-[12px]', late > 0 ? 'text-danger' : 'text-ink-3')} title={`Due ${formatDate(t.dueDate)}`}>{late > 0 ? `${late}d late` : formatDue(t.dueDate, today)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : <p className="text-[13px] text-ink-3">Nothing is waiting on a client.</p>}
    </Frame>
  );
}

export function MissingWidget() {
  const { expected, clientById, scheduleById } = useStore();
  const review = needsReview(expected);
  if (!review.length) {
    return <Frame title="Missing tasks" padded><QuietLine icon={CalendarCheck}>Every expected recurring task exists or has been reviewed.</QuietLine></Frame>;
  }
  return (
    <section aria-label="Missing tasks" className="flex h-full min-h-0 flex-col gap-2 overflow-y-auto rounded-xl border border-warn/25 bg-warn-soft px-[18px] py-4 text-warn">
      <h2 className="text-[15px] font-semibold tracking-[-0.01em]"><span className="tnum">{review.length}</span> expected task{review.length === 1 ? '' : 's'} missing</h2>
      <ul className="flex flex-col gap-1 text-[13px]">
        {review.map((i) => (
          <li key={i.id} className="truncate">
            <Link to={`/missing?focus=${encodeURIComponent(i.id)}`} className="hover:underline">
              {clientById.get(i.clientId)?.name}: {i.title}, {i.periodName}{scheduleById.get(i.scheduleId)?.autoGenerate ? '' : ' (check-only)'}
            </Link>
          </li>
        ))}
      </ul>
      <Link to="/missing" className="mt-auto inline-flex items-center gap-1 pt-1 text-[13px] font-semibold text-warn hover:underline">Review missing tasks <ArrowRight className="size-3.5" /></Link>
    </section>
  );
}

function weekEnd(today: ISODate) { return addDays(startOfWeek(today), 6); }

export function StatsWidget() {
  const { snap, today } = useStore();
  const open = useOpenTasks();
  const monday = startOfWeek(today);
  const doneWeek = snap.occurrences.filter((o) => o.status === 'done' && o.completedAt && localISODate(new Date(o.completedAt)) >= monday).length;
  const tiles: { label: string; n: number; to: string; tone?: string }[] = [
    { label: 'Open', n: open.length, to: '/tasks?view=open' },
    { label: 'Overdue', n: open.filter((o) => o.dueDate < today).length, to: '/tasks?view=overdue', tone: 'text-danger' },
    { label: 'Due this week', n: open.filter((o) => o.dueDate >= today && o.dueDate <= weekEnd(today)).length, to: '/tasks?view=week', tone: 'text-accent-ink' },
    { label: 'Done this week', n: doneWeek, to: '/tasks?view=completed', tone: 'text-ok' },
  ];
  return (
    <nav aria-label="Key numbers" className="grid h-full grid-cols-2 gap-3 sm:grid-cols-4">
      {tiles.map((t) => (
        <Link key={t.label} to={t.to} className="group flex min-h-[76px] min-w-0 flex-col justify-center gap-1 rounded-xl border border-line bg-surface px-4 transition-colors hover:border-line-strong">
          <span className={cn('num text-[26px] leading-none font-medium', t.n > 0 && t.tone ? t.tone : 'text-ink')}>{t.n}</span>
          <span className="flex items-center gap-1 truncate text-[12.5px] text-ink-3">{t.label}<ArrowRight className="size-3 opacity-0 transition-opacity group-hover:opacity-100" /></span>
        </Link>
      ))}
    </nav>
  );
}

/** Tasks finished in each of the last eight weeks: a single series, so one hue, no legend, the latest value labelled. */
export function ProgressWidget() {
  const { snap, today } = useStore();
  const weeks = useMemo(() => {
    const first = addDays(startOfWeek(today), -7 * 7);
    const rows = Array.from({ length: 8 }, (_, i) => ({ start: addDays(first, i * 7), done: 0, onTime: 0 }));
    for (const o of snap.occurrences) {
      if (o.status !== 'done' || !o.completedAt) continue;
      const d = localISODate(new Date(o.completedAt));
      const i = Math.floor(diffDays(d, first) / 7);
      if (i < 0 || i > 7) continue;
      rows[i].done++;
      if (d <= o.dueDate) rows[i].onTime++;
    }
    return rows;
  }, [snap.occurrences, today]);
  const total = weeks.reduce((n, w) => n + w.done, 0);
  const onTime = weeks.reduce((n, w) => n + w.onTime, 0);
  const max = Math.max(1, ...weeks.map((w) => w.done));
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? 7;
  return (
    <Frame title="Completed per week" padded>
      <div className="flex h-full min-h-[120px] flex-col gap-3">
        <p className="text-[12.5px] text-ink-3">
          <span className="num text-[15px] font-medium text-ink">{total}</span> in 8 weeks
          {total > 0 && <> · <span className="num text-[15px] font-medium text-ink">{Math.round((onTime / total) * 100)}%</span> on time</>}
        </p>
        <div className="relative flex min-h-0 flex-1 items-end gap-1.5 border-b border-line" onMouseLeave={() => setHover(null)}>
          {weeks.map((w, i) => (
            <button key={w.start} type="button" onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
              aria-label={`Week ${isoWeek(w.start).week}: ${w.done} done, ${w.onTime} on time`}
              className="group flex h-full flex-1 items-end focus-visible:outline-offset-1">
              <span className={cn('block w-full rounded-t-[4px] transition-[height,background-color]', i === shown ? 'bg-accent' : 'bg-accent/45 group-hover:bg-accent/70')}
                style={{ height: `${Math.max(w.done ? 4 : 0, (w.done / max) * 100)}%` }} />
            </button>
          ))}
        </div>
        <p className="num -mt-1 flex justify-between text-[11px] text-ink-3" aria-hidden><span>W{isoWeek(weeks[0].start).week}</span><span>W{isoWeek(weeks[7].start).week}</span></p>
        <p className="text-[12px] text-ink-2" aria-live="polite">
          Week {isoWeek(weeks[shown].start).week}{shown === 7 && ' (this week)'}: <span className="num font-medium">{weeks[shown].done}</span> done, <span className="num">{weeks[shown].onTime}</span> on time
        </p>
      </div>
    </Frame>
  );
}

export function AttentionWidget() {
  const { snap, today } = useStore();
  const rows = useMemo(() => {
    const by = new Map<string, { open: number; overdue: number; next: ISODate | null }>();
    for (const o of snap.occurrences) {
      if (!isOpen(o.status)) continue;
      const r = by.get(o.clientId) ?? { open: 0, overdue: 0, next: null };
      r.open++;
      if (o.dueDate < today) r.overdue++;
      else if (!r.next || o.dueDate < r.next) r.next = o.dueDate;
      by.set(o.clientId, r);
    }
    return snap.clients.filter((c) => c.status === 'active' && by.has(c.id))
      .map((c) => ({ c, ...by.get(c.id)! }))
      .sort((a, b) => b.overdue - a.overdue || b.open - a.open || a.c.name.localeCompare(b.c.name));
  }, [snap.occurrences, snap.clients, today]);
  return (
    <Frame title="Clients needing attention" action={<Link to="/clients" className={linkCls}>All clients</Link>}>
      {rows.length ? (
        <ul className="divide-y divide-line/70">
          {rows.map((r) => (
            <li key={r.c.id}>
              <Link to={`/clients/${r.c.id}`} className="flex items-center gap-3 px-[18px] py-2 hover:bg-hover/70">
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{r.c.name}</span>
                {r.overdue > 0 && <span className="num shrink-0 text-[12px] text-danger">{r.overdue} late</span>}
                <span className="num w-14 shrink-0 text-right text-[12px] text-ink-3">{r.open} open</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : <QuietLine icon={Users}>No client has open work.</QuietLine>}
    </Frame>
  );
}

export function PinnedWidget() {
  const { snap, today, clientById } = useStore();
  const pinned = (snap.workspace.settings.pinnedClients ?? []).map((id) => clientById.get(id)).filter((c) => !!c);
  return (
    <Frame title="Pinned clients" count={pinned.length || undefined}>
      {pinned.length ? (
        <ul className="divide-y divide-line/70">
          {pinned.map((c) => {
            const mine = snap.occurrences.filter((o) => o.clientId === c.id && isOpen(o.status));
            const overdue = mine.filter((o) => o.dueDate < today).length;
            const next = mine.filter((o) => o.dueDate >= today).sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
            return (
              <li key={c.id}>
                <Link to={`/clients/${c.id}`} className="flex flex-col gap-0.5 px-[18px] py-2.5 hover:bg-hover/70">
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{c.name}</span>
                    {overdue > 0 && <span className="num text-[12px] text-danger">{overdue} late</span>}
                    <span className="num text-[12px] text-ink-3">{mine.length} open</span>
                  </span>
                  <span className="truncate text-[12px] text-ink-3">{next ? <>Next: {next.title}, <span className="num">{formatDue(next.dueDate, today)}</span></> : 'No upcoming deadline'}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : <QuietLine icon={Pin}>Pin a client from its page (the ··· menu) to keep it here and in the sidebar.</QuietLine>}
    </Frame>
  );
}

export function ActivityWidget() {
  const { snap } = useStore();
  return (
    <Frame title="Recent activity" padded>
      <ActivityList items={snap.activity} empty="Nothing has happened yet." limit={25} />
    </Frame>
  );
}

export function NotesWidget() {
  const { snap, saveSettings } = useStore();
  const saved = snap.workspace.settings.homeNotes ?? '';
  const [text, setText] = useState(saved);
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef(text);
  latest.current = text;
  // Save shortly after typing stops, and on the way out.
  useEffect(() => () => { window.clearTimeout(timer.current); if (latest.current !== (snap.workspace.settings.homeNotes ?? '')) void saveSettings({ homeNotes: latest.current }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const change = (v: string) => {
    setText(v);
    setState('saving');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { void saveSettings({ homeNotes: v }).then(() => setState('saved')); }, 700);
  };
  return (
    <Frame title="Notepad" action={<span className="text-[11.5px] text-ink-3" aria-live="polite">{state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : ''}</span>}>
      <textarea value={text} onChange={(e) => change(e.target.value)} maxLength={2000} aria-label="Notepad"
        placeholder="Notes for today: calls to make, things to remember…"
        className="block h-full min-h-[80px] w-full resize-none bg-transparent px-[18px] py-3 text-[13.5px] leading-relaxed placeholder:text-ink-3 focus:outline-none" />
    </Frame>
  );
}

export function DeadlinesWidget() {
  const { today, clientById } = useStore();
  const open = useOpenTasks();
  const rows = useMemo(() => TASK_TYPES.map((type) => {
    const list = open.filter((o) => o.taskType === type).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    return { type, next: list[0] as Occurrence | undefined, n: list.length };
  }).filter((r) => r.next).sort((a, b) => a.next!.dueDate.localeCompare(b.next!.dueDate)), [open]);
  const ui = useUI();
  return (
    <Frame title="Deadline radar">
      {rows.length ? (
        <ul className="divide-y divide-line/70">
          {rows.map(({ type, next, n }) => (
            <li key={type}>
              <button onClick={() => ui.openTask(next!.id)} className="flex w-full items-center gap-3 px-[18px] py-2 text-left hover:bg-hover/70">
                <span className="w-24 shrink-0 truncate text-[12px] text-ink-2"><span className="rounded-[5px] bg-sunken px-1.5 py-px">{TYPE_LABEL[type]}</span></span>
                <span className="min-w-0 flex-1 truncate text-[13px]">{clientById.get(next!.clientId)?.name}</span>
                <span className={cn('num shrink-0 text-[12px]', next!.dueDate < today ? 'text-danger' : next!.dueDate === today ? 'text-accent-ink' : 'text-ink-2')}>{formatDue(next!.dueDate, today)}</span>
                <span className="num w-8 shrink-0 text-right text-[11.5px] text-ink-3" title={`${n} open`}>{n}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : <QuietLine icon={CalendarCheck}>No open deadlines.</QuietLine>}
    </Frame>
  );
}

export function CalendarWidget() {
  const { today } = useStore();
  const { navigate } = useRoute();
  const open = useOpenTasks();
  const [cursor, setCursor] = useState(() => startOfMonth(today));
  const counts = useMemo(() => {
    const m = new Map<ISODate, number>();
    for (const o of open) m.set(o.dueDate, (m.get(o.dueDate) ?? 0) + 1);
    return m;
  }, [open]);
  const month = parts(cursor)[1];
  return (
    <Frame title={formatMonth(cursor)} padded action={
      <span className="flex items-center gap-0.5">
        <button aria-label="Previous month" onClick={() => setCursor((c) => addMonths(c, -1))} className="rounded p-1 text-ink-3 hover:bg-hover hover:text-ink"><ChevronLeft className="size-4" /></button>
        <button aria-label="Next month" onClick={() => setCursor((c) => addMonths(c, 1))} className="rounded p-1 text-ink-3 hover:bg-hover hover:text-ink"><ChevronRight className="size-4" /></button>
      </span>
    }>
      <div className="grid grid-cols-7 gap-y-1 text-center">
        {monthGrid(cursor).slice(0, 7).map((d) => <span key={d} className="pb-1 text-[11px] text-ink-3">{formatWeekdayShort(d).slice(0, 2)}</span>)}
        {monthGrid(cursor).map((d) => {
          const n = counts.get(d) ?? 0;
          const inMonth = parts(d)[1] === month;
          return (
            <button key={d} onClick={() => navigate(`/calendar?view=week&date=${d}`)} aria-label={`${formatDate(d)}: ${n} due`}
              className={cn('mx-auto flex size-8 flex-col items-center justify-center rounded-lg text-[12px] hover:bg-hover',
                !inMonth && 'text-ink-3/50', d === today && 'bg-accent font-semibold text-on-accent hover:bg-accent-hover')}>
              <span className="num leading-none">{parts(d)[2]}</span>
              <span className={cn('mt-0.5 size-1 rounded-full', n === 0 ? 'bg-transparent' : d === today ? 'bg-on-accent' : d < today ? 'bg-danger' : n >= 3 ? 'bg-accent' : 'bg-accent/45')} />
            </button>
          );
        })}
      </div>
    </Frame>
  );
}
