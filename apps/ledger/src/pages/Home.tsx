import { useMemo, type ReactNode } from 'react';
import { AlertTriangle, ArrowRight, CalendarCheck, CheckCircle2, Plus, SearchCheck, Sun } from 'lucide-react';
import { useUI } from '../components/ui-state';
import { Page } from '../components/Shell';
import { TaskTable } from '../components/TaskTable';
import { useStore } from '../data/store';
import { addDays, diffDays } from '../lib/dates';
import { formatDate, formatDayLong, greeting } from '../lib/format';
import { needsReview } from '../lib/missing';
import { sortTasks } from '../lib/filters';
import { isOpen } from '../lib/types';
import { Link, useRoute } from '../router';
import { Button } from '../ui/button';
import { cn } from '../ui/cn';
import { QuietLine } from '../ui/states';

const UPCOMING_DAYS = 14;

function Metric({ label, value, to, tone, icon: Icon, hint }: { label: string; value: number; to: string; tone: 'danger' | 'accent' | 'neutral' | 'warn'; icon: typeof Sun; hint: string }) {
  const tones = { danger: 'text-danger', accent: 'text-accent-ink', neutral: 'text-ink', warn: 'text-warn' };
  return (
    <Link to={to} className="group flex flex-col gap-1 rounded-lg border border-line bg-surface px-4 py-3 shadow-soft transition-[border-color,box-shadow] hover:border-line-strong hover:shadow-pop focus-visible:shadow-pop">
      <span className="flex items-center gap-1.5 text-[12px] font-medium text-ink-3">
        <Icon className={cn('size-3.5', value > 0 ? tones[tone] : 'text-ink-3')} />{label}
        <ArrowRight className="ml-auto size-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
      </span>
      <span className={cn('tnum text-[24px] leading-tight font-semibold tracking-[-0.02em]', value > 0 ? tones[tone] : 'text-ink-3')}>{value}</span>
      <span className="text-[11.5px] text-ink-3">{hint}</span>
    </Link>
  );
}

function Section({ title, count, action, children, id }: { title: string; count?: number; action?: ReactNode; children: ReactNode; id: string }) {
  return (
    <section aria-labelledby={id} className="mb-8">
      <div className="mb-2 flex items-baseline gap-2 px-1">
        <h2 id={id} className="text-[13.5px] font-semibold">{title}</h2>
        {count !== undefined && <span className="tnum text-[12.5px] text-ink-3">{count}</span>}
        <div className="ml-auto">{action}</div>
      </div>
      <div className="overflow-hidden rounded-lg border border-line bg-surface shadow-soft">{children}</div>
    </section>
  );
}

export function Home() {
  const { snap, today, clientById, expected, scheduleById } = useStore();
  const ui = useUI();
  const { navigate } = useRoute();
  const open = useMemo(() => snap.occurrences.filter((o) => isOpen(o.status)), [snap.occurrences]);
  const overdue = useMemo(() => sortTasks(open.filter((o) => o.dueDate < today), 'due', clientById), [open, today, clientById]);
  const dueToday = useMemo(() => sortTasks(open.filter((o) => o.dueDate === today), 'priority', clientById), [open, today, clientById]);
  const upcoming = useMemo(() => sortTasks(open.filter((o) => o.dueDate > today && o.dueDate <= addDays(today, UPCOMING_DAYS)), 'due', clientById), [open, today, clientById]);
  const review = needsReview(expected);
  const completedToday = snap.occurrences.filter((o) => o.completedAt && o.completedAt.slice(0, 10) === today).length;
  const name = snap.workspace.settings.displayName?.trim();
  const waiting = open.filter((o) => o.status === 'waiting').length;

  return (
    <Page title="Home">
      <div className="mb-6 flex flex-wrap items-end gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-[22px] leading-tight font-semibold tracking-[-0.02em]">{greeting()}{name ? `, ${name}` : ''}</h2>
          <p className="mt-1 text-[13px] text-ink-3">
            {formatDayLong(today)}
            {completedToday > 0 && <> · {completedToday} done today</>}
            {waiting > 0 && <> · {waiting} waiting for clients</>}
          </p>
        </div>
      </div>

      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Overdue" value={overdue.length} to="/tasks?view=overdue" tone="danger" icon={AlertTriangle} hint={overdue.length ? `Oldest ${diffDays(today, overdue[0].dueDate)} days` : 'Nothing late'} />
        <Metric label="Due today" value={dueToday.length} to="/tasks?view=today" tone="accent" icon={Sun} hint={dueToday.length ? `${dueToday.filter((t) => t.priority === 'urgent' || t.priority === 'high').length} high priority` : 'Clear day'} />
        <Metric label={`Next ${UPCOMING_DAYS} days`} value={upcoming.length} to={`/tasks?status=todo,in_progress,waiting&due=next_14`} tone="neutral" icon={CalendarCheck} hint={upcoming.length ? `Next: ${formatDate(upcoming[0].dueDate)}` : 'Nothing scheduled'} />
        <Metric label="Missing tasks" value={review.length} to="/missing" tone="warn" icon={SearchCheck} hint={review.length ? 'Expected but not found' : 'All periods accounted for'} />
      </div>

      <Section id="h-overdue" title="Overdue" count={overdue.length || undefined}
        action={overdue.length > 8 && <Link to="/tasks?view=overdue" className="text-[12.5px] text-accent hover:underline">See all {overdue.length}</Link>}>
        {overdue.length ? <TaskTable tasks={overdue} limit={8} /> : <QuietLine icon={CheckCircle2}>Nothing overdue. Everything due so far is done or rescheduled.</QuietLine>}
      </Section>

      <Section id="h-today" title="Today" count={dueToday.length || undefined}
        action={<Button size="sm" variant="ghost" onClick={() => ui.openNewTask({ dueDate: today })}><Plus /> Add for today</Button>}>
        {dueToday.length ? <TaskTable tasks={dueToday} /> : <QuietLine icon={Sun}>Nothing due today.{upcoming[0] && <> Next up: {upcoming[0].title}, {formatDate(upcoming[0].dueDate)}.</>}</QuietLine>}
      </Section>

      <Section id="h-upcoming" title="Upcoming deadlines" count={upcoming.length || undefined}
        action={<Link to="/calendar" className="text-[12.5px] text-accent hover:underline">Open calendar</Link>}>
        {upcoming.length ? <TaskTable tasks={upcoming} limit={12} /> : <QuietLine icon={CalendarCheck}>No deadlines in the next {UPCOMING_DAYS} days.</QuietLine>}
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
