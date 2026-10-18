import { useMemo, useState, type ReactNode } from 'react';
import { ArrowRight, CalendarCheck, CheckCircle2, ChevronDown, SearchCheck, Sun } from 'lucide-react';
import { Page } from '../components/Shell';
import { TaskTable } from '../components/TaskTable';
import { useStore } from '../data/store';
import { addDays, diffDays, localISODate } from '../lib/dates';
import { formatDate, formatDayLong, greeting } from '../lib/format';
import { needsReview } from '../lib/missing';
import { sortTasks } from '../lib/filters';
import { isOpen } from '../lib/types';
import { Link, useRoute } from '../router';
import { cn } from '../ui/cn';
import { QuietLine } from '../ui/states';

const UPCOMING_DAYS = 14;

/** One cell of the summary bar: a number that is also a link to the matching list. */
function Metric({ label, value, to, tone, hint }: { label: string; value: number; to: string; tone: 'danger' | 'accent' | 'neutral' | 'warn'; hint: string }) {
  const tones = { danger: 'text-danger', accent: 'text-accent-ink', neutral: 'text-ink', warn: 'text-warn' };
  return (
    <Link to={to} className="group flex min-w-0 flex-col gap-0.5 px-4 py-3 transition-colors hover:bg-hover/60 focus-visible:bg-hover/60 focus-visible:outline-offset-[-2px]">
      <span className="flex items-baseline gap-2">
        <span className={cn('tnum text-[22px] leading-none font-semibold tracking-[-0.02em]', value > 0 ? tones[tone] : 'text-ink-3')}>{value}</span>
        <span className="text-[13px] font-medium text-ink">{label}</span>
        <ArrowRight className="ml-auto size-3.5 shrink-0 self-center text-ink-3 opacity-0 transition-opacity group-hover:opacity-100" />
      </span>
      <span className="truncate text-[12px] text-ink-3">{hint}</span>
    </Link>
  );
}

function Section({ title, count, action, children, id, tone }: { title: string; count?: number; action?: ReactNode; children: ReactNode; id: string; tone?: 'danger' }) {
  return (
    <section aria-labelledby={id} className="mb-7">
      <div className="mb-2 flex h-6 items-center gap-2 px-0.5">
        <h2 id={id} className={cn('text-[13px] font-semibold', tone === 'danger' && count ? 'text-danger' : 'text-ink')}>{title}</h2>
        {count !== undefined && <span className="tnum text-[12.5px] text-ink-3">{count}</span>}
        <div className="ml-auto">{action}</div>
      </div>
      <div className="overflow-clip rounded-lg border border-line bg-surface">{children}</div>
    </section>
  );
}

export function Home() {
  const { snap, today, clientById, expected, scheduleById } = useStore();
  const { navigate } = useRoute();
  const open = useMemo(() => snap.occurrences.filter((o) => isOpen(o.status)), [snap.occurrences]);
  const overdue = useMemo(() => sortTasks(open.filter((o) => o.dueDate < today), 'due', clientById), [open, today, clientById]);
  const dueToday = useMemo(() => sortTasks(open.filter((o) => o.dueDate === today), 'priority', clientById), [open, today, clientById]);
  const upcoming = useMemo(() => sortTasks(open.filter((o) => o.dueDate > today && o.dueDate <= addDays(today, UPCOMING_DAYS)), 'due', clientById), [open, today, clientById]);
  const review = needsReview(expected);
  // Finished today (by local date), including work that was due earlier: it all counts towards today.
  const doneToday = useMemo(() => snap.occurrences
    .filter((o) => o.status === 'done' && o.completedAt && localISODate(new Date(o.completedAt)) === today)
    .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? '')), [snap.occurrences, today]);
  const completedToday = doneToday.length;
  const plannedToday = dueToday.length + doneToday.length;
  const [showAllOverdue, setShowAllOverdue] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const name = snap.workspace.settings.displayName?.trim();
  const waiting = open.filter((o) => o.status === 'waiting').length;

  return (
    <Page title="Home">
      <div className="mb-5 flex flex-wrap items-end gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-[20px] leading-tight font-semibold tracking-[-0.02em]">{greeting()}{name ? `, ${name}` : ''}</h2>
          <p className="mt-1 text-[13px] text-ink-3">
            {formatDayLong(today)}
            {completedToday > 0 && <> · {completedToday} done today</>}
            {waiting > 0 && <> · {waiting} waiting for clients</>}
          </p>
        </div>
      </div>

      <nav aria-label="Summary" className="mb-8 grid grid-cols-2 divide-line overflow-clip rounded-lg border border-line bg-surface max-lg:[&>*:nth-child(-n+2)]:border-b max-lg:[&>*:nth-child(odd)]:border-r lg:grid-cols-4 lg:divide-x">
        <Metric label="Overdue" value={overdue.length} to="/tasks?view=overdue" tone="danger" hint={overdue.length ? `Oldest is ${diffDays(today, overdue[0].dueDate)} days late` : 'Nothing late'} />
        <Metric label="Due today" value={dueToday.length} to="/tasks?view=today" tone="accent" hint={dueToday.length ? `${dueToday.filter((t) => t.priority === 'urgent' || t.priority === 'high').length} high priority` : 'Clear day'} />
        <Metric label={`Next ${UPCOMING_DAYS} days`} value={upcoming.length} to={`/tasks?status=todo,in_progress,waiting&due=next_14`} tone="neutral" hint={upcoming.length ? `Next on ${formatDate(upcoming[0].dueDate)}` : 'Nothing scheduled'} />
        <Metric label="Missing" value={review.length} to="/missing" tone="warn" hint={review.length ? 'Expected tasks not found' : 'All periods accounted for'} />
      </nav>

      <Section id="h-today" title="Today" count={dueToday.length || undefined}
        action={plannedToday > 0 && (
          <div className="flex items-center gap-2.5 text-[12px] text-ink-3" aria-label={`${completedToday} of ${plannedToday} done today`}>
            <span className="tnum">{completedToday} of {plannedToday} done</span>
            <span className="h-1.5 w-28 overflow-hidden rounded-full bg-sunken" aria-hidden>
              <span className="block h-full rounded-full bg-ok transition-[width] duration-500" style={{ width: `${Math.round((completedToday / plannedToday) * 100)}%` }} />
            </span>
          </div>
        )}>
        <TaskTable tasks={dueToday} header={false} addRow={{ dueDate: today }} />
        {!dueToday.length && <QuietLine icon={completedToday ? CheckCircle2 : Sun}>{completedToday ? 'Everything due today is done.' : 'Nothing due today.'}{upcoming[0] && <> Next up: {upcoming[0].title}, {formatDate(upcoming[0].dueDate)}.</>}</QuietLine>}
        {doneToday.length > 0 && (
          <>
            <button onClick={() => setShowDone((v) => !v)} aria-expanded={showDone}
              className="flex w-full items-center gap-2 border-t border-line px-3 py-2 text-left text-[12.5px] text-ink-3 hover:bg-hover/60 hover:text-ink">
              <CheckCircle2 className="size-3.5 text-ok" /> {doneToday.length} finished today
              <ChevronDown className={cn('ml-auto size-3.5 transition-transform', showDone && 'rotate-180')} />
            </button>
            {showDone && <div className="border-t border-line"><TaskTable tasks={doneToday} header={false} /></div>}
          </>
        )}
      </Section>

      <Section id="h-overdue" tone="danger" title="Overdue" count={overdue.length || undefined}
        action={overdue.length > 0 && <Link to="/tasks?view=overdue" className="text-[12.5px] text-accent hover:underline">Open in My Tasks</Link>}>
        {overdue.length ? <TaskTable tasks={overdue} limit={showAllOverdue ? undefined : 5} header={false} /> : <QuietLine icon={CheckCircle2}>Nothing overdue. Everything due so far is done or rescheduled.</QuietLine>}
        {overdue.length > 5 && (
          <button onClick={() => setShowAllOverdue((v) => !v)} className="w-full border-t border-line py-2 text-[12.5px] text-ink-3 hover:bg-hover hover:text-ink">
            {showAllOverdue ? 'Show fewer' : `Show all ${overdue.length}`}
          </button>
        )}
      </Section>

      <Section id="h-upcoming" title="Upcoming deadlines" count={upcoming.length || undefined}
        action={<Link to="/calendar" className="text-[12.5px] text-accent hover:underline">Open calendar</Link>}>
        {upcoming.length ? <TaskTable tasks={upcoming} limit={12} header={false} groupBy="day" /> : <QuietLine icon={CalendarCheck}>No deadlines in the next {UPCOMING_DAYS} days.</QuietLine>}
        {upcoming.length > 12 && (
          <button onClick={() => navigate('/tasks?status=todo,in_progress,waiting&due=next_14')} className="w-full border-t border-line py-2 text-[12.5px] text-ink-3 hover:bg-hover hover:text-ink">
            Show all {upcoming.length}
          </button>
        )}
      </Section>

      <Section id="h-missing" title="Missing tasks to review" count={review.length || undefined}
        action={review.length > 0 && <Link to="/missing" className="text-[12.5px] text-accent hover:underline">Review all</Link>}>
        {review.length ? (
          <ul className="divide-y divide-line">
            {review.slice(0, 5).map((i) => (
              <li key={i.id}>
                <Link to={`/missing?focus=${encodeURIComponent(i.id)}`} className="flex items-center gap-3 px-3 py-2.5 hover:bg-hover/70">
                  <SearchCheck className="size-4 shrink-0 text-warn" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px]">{i.title} <span className="text-ink-3">· {i.periodName}</span></div>
                    <div className="truncate text-[12px] text-ink-3">{clientById.get(i.clientId)?.name} · {scheduleById.get(i.scheduleId)?.autoGenerate ? 'Expected' : 'Check-only'} · due {formatDate(i.period.due)}</div>
                  </div>
                  <ArrowRight className="size-4 text-ink-3" />
                </Link>
              </li>
            ))}
          </ul>
        ) : <QuietLine icon={CheckCircle2}>Every expected recurring task exists or has been reviewed.</QuietLine>}
      </Section>
    </Page>
  );
}
