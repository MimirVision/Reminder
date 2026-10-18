import { useMemo, useState, type ReactNode } from 'react';
import { ArrowRight, CalendarCheck, CheckCircle2, ChevronDown, Sun } from 'lucide-react';
import { Page } from '../components/Shell';
import { QuickAdd } from '../components/QuickAdd';
import { TaskTable } from '../components/TaskTable';
import { useUI } from '../components/ui-state';
import { useStore } from '../data/store';
import { addDays, diffDays, isoWeek, localISODate } from '../lib/dates';
import { formatDate, formatDayLong, formatDue, formatWeekdayShort, greeting } from '../lib/format';
import { needsReview } from '../lib/missing';
import { sortTasks } from '../lib/filters';
import { isOpen } from '../lib/types';
import { Link } from '../router';
import { cn } from '../ui/cn';
import { QuietLine } from '../ui/states';

const UPCOMING_DAYS = 14;

/** A count inside the summary sentence that is also a link to the matching list. */
function Count({ n, label, to, tone }: { n: number; label: string; to: string; tone: 'danger' | 'accent' | 'warn' | 'neutral' }) {
  const tones = { danger: 'text-danger', accent: 'text-accent-ink', warn: 'text-warn', neutral: 'text-ink' };
  return (
    <Link to={to} className={cn('font-medium underline decoration-current/25 underline-offset-[3px] hover:decoration-current', n > 0 ? tones[tone] : 'text-ink-3')}>
      <span className="tnum">{n}</span> {label}
    </Link>
  );
}

/** Done of planned for today, as a ring. */
function DayRing({ done, planned }: { done: number; planned: number }) {
  const r = 21, c = 2 * Math.PI * r;
  const share = planned ? done / planned : 0;
  return (
    <div className="flex shrink-0 items-center gap-3.5 rounded-xl border border-line bg-surface py-3 pr-5 pl-3" role="img" aria-label={`${done} of ${planned} done today`}>
      <svg width="52" height="52" viewBox="0 0 52 52" aria-hidden>
        <circle cx="26" cy="26" r={r} fill="none" stroke="var(--c-sunken)" strokeWidth="6" />
        <circle cx="26" cy="26" r={r} fill="none" stroke="var(--c-ok)" strokeWidth="6" strokeLinecap="round" transform="rotate(-90 26 26)"
          strokeDasharray={`${share * c} ${c}`} className="transition-[stroke-dasharray] duration-500" />
      </svg>
      <div className="flex flex-col">
        <span className="num text-[20px] leading-tight font-medium">{done}<span className="text-ink-3">/{planned}</span></span>
        <span className="text-[12px] text-ink-3">done today</span>
      </div>
    </div>
  );
}

function Card({ title, count, action, children, id, tone }: { title: string; count?: ReactNode; action?: ReactNode; children: ReactNode; id: string; tone?: 'danger' }) {
  return (
    <section aria-labelledby={id} className="overflow-clip rounded-xl border border-line bg-surface">
      <header className="flex h-[50px] items-center gap-2.5 border-b border-line px-[18px]">
        <h2 id={id} className={cn('text-[15px] font-semibold tracking-[-0.01em]', tone === 'danger' ? 'text-danger' : 'text-ink')}>{title}</h2>
        {count !== undefined && <span className="num text-[12px] text-ink-3">{count}</span>}
        <div className="ml-auto">{action}</div>
      </header>
      {children}
    </section>
  );
}

function Rail({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-line bg-surface px-[18px] py-4">
      <div className="flex items-baseline gap-2">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{title}</h2>
        {count !== undefined && <span className="num text-[12px] text-ink-3">{count}</span>}
      </div>
      {children}
    </section>
  );
}

export function Home() {
  const { snap, today, clientById, expected, scheduleById } = useStore();
  const ui = useUI();
  const open = useMemo(() => snap.occurrences.filter((o) => isOpen(o.status)), [snap.occurrences]);
  const overdue = useMemo(() => sortTasks(open.filter((o) => o.dueDate < today), 'due', clientById), [open, today, clientById]);
  const dueToday = useMemo(() => sortTasks(open.filter((o) => o.dueDate === today), 'priority', clientById), [open, today, clientById]);
  const upcoming = useMemo(() => open.filter((o) => o.dueDate > today && o.dueDate <= addDays(today, UPCOMING_DAYS)), [open, today]);
  const review = needsReview(expected);
  // Finished today (by local date), including work that was due earlier: it all counts towards today.
  const doneToday = useMemo(() => snap.occurrences
    .filter((o) => o.status === 'done' && o.completedAt && localISODate(new Date(o.completedAt)) === today)
    .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? '')), [snap.occurrences, today]);
  const plannedToday = dueToday.length + doneToday.length;
  const [showAllOverdue, setShowAllOverdue] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const name = snap.workspace.settings.displayName?.trim();
  // Most overdue first: what is furthest past its deadline is what to chase.
  const waiting = useMemo(() => open.filter((o) => o.status === 'waiting').sort((a, b) => a.dueDate.localeCompare(b.dueDate)), [open]);
  const week = useMemo(() => Array.from({ length: 7 }, (_, i) => {
    const d = addDays(today, i);
    return { d, n: open.filter((o) => o.dueDate === d).length };
  }), [open, today]);
  const weekMax = Math.max(1, ...week.map((w) => w.n));
  const urgentToday = dueToday.filter((t) => t.priority === 'urgent' || t.priority === 'high').length;

  return (
    <Page title="Home" hideTitle>
      <section className="mb-6 flex flex-wrap items-end gap-6">
        <div className="flex min-w-0 flex-[1_1_360px] flex-col gap-1.5">
          <span className="num text-[11.5px] tracking-[0.08em] text-ink-3 uppercase">{formatDayLong(today)} · Week {isoWeek(today).week}</span>
          <h1 className="text-[32px] leading-[1.1] font-semibold tracking-[-0.025em]">{greeting()}{name ? `, ${name}` : ''}</h1>
          <nav aria-label="Summary" className="mt-1 text-[14.5px] text-ink-2">
            <Count n={dueToday.length} label="due today" to="/tasks?view=today" tone="accent" />,{' '}
            <Count n={overdue.length} label="overdue" to="/tasks?view=overdue" tone="danger" />,{' '}
            <Count n={upcoming.length} label={`in the next ${UPCOMING_DAYS} days`} to="/tasks?status=todo,in_progress,waiting&due=next_14" tone="neutral" /> and{' '}
            <Count n={review.length} label="missing to review" to="/missing" tone="warn" />.
            {urgentToday > 0 && <> Start with the {urgentToday} high-priority task{urgentToday === 1 ? '' : 's'} due today.</>}
          </nav>
        </div>
        {plannedToday > 0 && <DayRing done={doneToday.length} planned={plannedToday} />}
      </section>

      <QuickAdd className="mb-7" />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
          <Card id="h-today" title="Today" count={dueToday.length ? `${dueToday.length} open` : undefined}
            action={<Link to="/tasks?view=today" className="text-[12.5px] text-accent hover:underline">Open in My Tasks</Link>}>
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
          </Card>

          <Card id="h-overdue" tone={overdue.length ? 'danger' : undefined} title="Overdue" count={overdue.length || undefined}
            action={overdue.length > 0 && <Link to="/tasks?view=overdue" className="text-[12.5px] text-accent hover:underline">Review all</Link>}>
            {overdue.length ? <TaskTable tasks={overdue} limit={showAllOverdue ? undefined : 5} header={false} stacked /> : <QuietLine icon={CheckCircle2}>Nothing overdue. Everything due so far is done or rescheduled.</QuietLine>}
            {overdue.length > 5 && (
              <button onClick={() => setShowAllOverdue((v) => !v)} className="h-10 w-full border-t border-line text-[12.5px] text-ink-3 hover:bg-hover hover:text-ink">
                {showAllOverdue ? 'Show fewer' : <>Show all <span className="tnum">{overdue.length}</span></>}
              </button>
            )}
          </Card>
        </div>

        <aside className="flex min-w-0 flex-col gap-6" aria-label="At a glance">
          <Rail title="This week">
            <ul className="flex flex-col gap-2.5">
              {week.map(({ d, n }) => (
                <li key={d}>
                  <Link to={`/calendar?view=week&date=${d}`} className="group flex items-center gap-2.5" aria-label={`${formatDate(d)}: ${n} due`}>
                    <span className={cn('num w-9 text-[12px]', d === today ? 'font-medium text-accent-ink' : 'text-ink-3')}>{d === today ? 'Today' : formatWeekdayShort(d)}</span>
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-sunken">
                      <span className="block h-full rounded-full bg-accent transition-[width] duration-500 group-hover:bg-accent-hover" style={{ width: `${(n / weekMax) * 100}%` }} />
                    </span>
                    <span className="num w-6 text-right text-[12px]">{n}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Rail>

          <Rail title="Waiting on clients" count={waiting.length}>
            {waiting.length ? (
              <ul className="-mx-2 flex flex-col">
                {waiting.slice(0, 5).map((t) => {
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
            {waiting.length > 5 && <Link to="/tasks?view=waiting" className="text-[12.5px] text-accent hover:underline">All <span className="tnum">{waiting.length}</span> waiting</Link>}
          </Rail>

          {review.length > 0 ? (
            <section className="flex flex-col gap-2 rounded-xl border border-warn/25 bg-warn-soft px-[18px] py-4 text-warn">
              <h2 className="text-[15px] font-semibold tracking-[-0.01em]"><span className="tnum">{review.length}</span> expected task{review.length === 1 ? '' : 's'} missing</h2>
              <ul className="flex flex-col gap-1 text-[13px]">
                {review.slice(0, 3).map((i) => (
                  <li key={i.id} className="truncate">
                    <Link to={`/missing?focus=${encodeURIComponent(i.id)}`} className="hover:underline">
                      {clientById.get(i.clientId)?.name}: {i.title}, {i.periodName}{scheduleById.get(i.scheduleId)?.autoGenerate ? '' : ' (check-only)'}
                    </Link>
                  </li>
                ))}
              </ul>
              <Link to="/missing" className="mt-1 inline-flex items-center gap-1 text-[13px] font-semibold text-warn hover:underline">Review missing tasks <ArrowRight className="size-3.5" /></Link>
            </section>
          ) : (
            <Rail title="Missing tasks">
              <QuietLine icon={CalendarCheck}>Every expected recurring task exists or has been reviewed.</QuietLine>
            </Rail>
          )}
        </aside>
      </div>
    </Page>
  );
}
