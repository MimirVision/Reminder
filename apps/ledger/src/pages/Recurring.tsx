import { useMemo, useState } from 'react';
import { CalendarX2, Pause, Plus, Repeat, Search, Copy } from 'lucide-react';
import { FilterMenu } from '../components/FilterMenu';
import { Page } from '../components/Shell';
import { useUI } from '../components/ui-state';
import { useStore } from '../data/store';
import { formatDue } from '../lib/format';
import { SCHEDULE_STATUS_LABEL } from '../lib/labels';
import { describeDueRule, describeRecurrence, isPausedOn, recurrenceOf, shortDueRule, upcomingPeriods } from '../lib/recurrence';
import { isOpen, type Schedule, type ScheduleStatus } from '../lib/types';
import { Pill } from '../ui/badges';
import { Button, IconButton } from '../ui/button';
import { cn } from '../ui/cn';
import { CopyScheduleDialog } from '../components/CopySchedule';
import { EmptyState } from '../ui/states';

export function ScheduleList({ schedules, showClient = true, emptyAction }: { schedules: Schedule[]; showClient?: boolean; emptyAction?: () => void }) {
  const { snap, today, clientById, calendar } = useStore();
  const ui = useUI();
  const [copyFrom, setCopyFrom] = useState<Schedule | null>(null);
  const info = useMemo(() => new Map(schedules.map((s) => {
    const pauses = snap.pauses.filter((p) => p.scheduleId === s.id);
    const next = s.status === 'ended' ? undefined : upcomingPeriods(recurrenceOf(s, calendar), today, 6).find((p) => !isPausedOn(p.due, pauses));
    const tasks = snap.occurrences.filter((o) => o.scheduleId === s.id);
    return [s.id, { next, total: tasks.length, open: tasks.filter((o) => isOpen(o.status)).length }];
  })), [schedules, snap.pauses, snap.occurrences, today, calendar]);

  if (!schedules.length) {
    return (
      <div className="rounded-lg border border-line bg-surface">
        <EmptyState icon={Repeat} title="No recurring schedules" body="A schedule describes work that repeats, such as monthly bookkeeping or a two-monthly VAT return. Ledger then creates each period’s task and checks that none are missing."
          action={emptyAction && <Button variant="primary" onClick={emptyAction}><Plus /> New schedule</Button>} />
      </div>
    );
  }
  // Grouped by client: with dozens of schedules, the client is the natural way to scan them.
  const groups: [string, Schedule[]][] = [];
  for (const s of schedules) {
    const last = groups[groups.length - 1];
    if (showClient && last && last[0] === s.clientId) last[1].push(s);
    else groups.push([showClient ? s.clientId : '', [s]]);
  }
  return (
    <div className="overflow-clip rounded-xl border border-line bg-surface">
      <table className="w-full table-fixed border-collapse">
        <thead>
          <tr className="sticky top-[52px] z-10 h-8 border-b border-line bg-surface text-left text-[11.5px] text-ink-3">
            <th className="pl-4 font-medium">Schedule</th>
            <th className="col-lg w-[30%] pr-3 font-medium">Due</th>
            <th className="w-24 pr-3 font-medium sm:w-32">Next due</th>
            <th className="col-sm w-28 pr-3 text-right font-medium">Tasks</th>
            <th className="col-sm w-28 pr-2 font-medium"><span className="sr-only">Status and actions</span></th>
          </tr>
        </thead>
        {groups.map(([clientId, list], gi) => (
          <tbody key={`${clientId}-${gi}`}>
            {showClient && (
              <tr className={cn('h-8 border-b border-line bg-canvas/60', gi > 0 && 'border-t')}>
                <th colSpan={5} scope="rowgroup" className="pl-4 text-left text-[12px] font-semibold text-ink-2">
                  {clientById.get(clientId)?.name}
                  <span className="ml-2 font-normal text-ink-3">{list.length}</span>
                </th>
              </tr>
            )}
            {list.map((s) => {
              const i = info.get(s.id)!;
              return (
                <tr key={s.id} className="group min-h-10 h-10 cursor-default border-b border-line last:border-b-0 hover:bg-hover/70" onClick={() => ui.openSchedule({ mode: 'edit', id: s.id })}>
                  <td className="max-w-0 pr-3 pl-4">
                    {/* One line on wide screens; title over its rhythm on a phone. */}
                    <div className="flex min-w-0 flex-col py-1 sm:flex-row sm:items-baseline sm:gap-2">
                      <button className="truncate text-left text-[13px] font-medium hover:text-accent" onClick={(e) => { e.stopPropagation(); ui.openSchedule({ mode: 'edit', id: s.id }); }}>{s.title}</button>
                      <span className="truncate text-[12px] text-ink-3 sm:shrink-0">{describeRecurrence(s)}{!s.autoGenerate && ' · check only'}{s.status !== 'active' && <span className="sm:hidden"> · {SCHEDULE_STATUS_LABEL[s.status]}</span>}</span>
                    </div>
                  </td>
                  <td className="col-lg max-w-0 truncate pr-3 text-[12.5px] text-ink-2" title={describeDueRule(s.dueRule)}>{shortDueRule(s.dueRule)}</td>
                  <td className="tnum pr-3 text-[12.5px] text-ink-2">{i.next ? formatDue(i.next.due, today) : <span className="text-ink-3">None</span>}</td>
                  <td className="tnum col-sm pr-3 text-right text-[12.5px] text-ink-3">{i.open > 0 && <span className="text-ink-2">{i.open} open · </span>}{i.total}</td>
                  <td className="col-sm pr-2 text-right">
                    <span className="flex items-center justify-end gap-1">
                      {s.status !== 'active' && (
                        <Pill tone={s.status === 'paused' ? 'warn' : 'neutral'}>{s.status === 'paused' ? <Pause /> : <CalendarX2 />}{SCHEDULE_STATUS_LABEL[s.status]}</Pill>
                      )}
                      <IconButton label={`Copy “${s.title}” to other clients`} size="sm" title="Copy to other clients"
                        className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                        onClick={(e) => { e.stopPropagation(); setCopyFrom(s); }}><Copy /></IconButton>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        ))}
      </table>
      {copyFrom && <CopyScheduleDialog schedule={copyFrom} open onOpenChange={(o) => { if (!o) setCopyFrom(null); }} />}
    </div>
  );
}

export function Recurring() {
  const { snap, clientById } = useStore();
  const ui = useUI();
  const [q, setQ] = useState('');
  const [clients, setClients] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<ScheduleStatus[]>(['active', 'paused']);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return snap.schedules
      .filter((x) => (!clients.length || clients.includes(x.clientId)) && (!statuses.length || statuses.includes(x.status)))
      .filter((x) => !s || `${x.title} ${clientById.get(x.clientId)?.name ?? ''}`.toLowerCase().includes(s))
      .sort((a, b) => (clientById.get(a.clientId)?.name ?? '').localeCompare(clientById.get(b.clientId)?.name ?? '') || a.title.localeCompare(b.title));
  }, [snap.schedules, q, clients, statuses, clientById]);

  return (
    <Page title="Recurring Work" actions={<Button onClick={() => ui.openSchedule({ mode: 'new' })}><Plus /> New schedule</Button>}>
      <p className="mb-4 text-[12.5px] text-ink-3">
        Each schedule is a rule that creates one task per period. Editing, pausing or ending one never changes completed work.
      </p>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-3" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search schedules" aria-label="Search schedules"
            className="h-7 w-full rounded-md border border-line-strong bg-surface pr-2 pl-8 text-[12.5px] placeholder:text-ink-3 focus:border-accent focus:ring-3 focus:ring-accent/15 focus:outline-none" />
        </div>
        <FilterMenu label="Client" searchable options={[...snap.clients].sort((a, b) => a.name.localeCompare(b.name)).map((c) => ({ value: c.id, label: c.name }))} selected={clients} onChange={setClients} />
        <FilterMenu label="Status" options={(['active', 'paused', 'ended'] as ScheduleStatus[]).map((s) => ({ value: s, label: SCHEDULE_STATUS_LABEL[s] }))} selected={statuses} onChange={setStatuses} />
        <span className="tnum ml-auto text-[12.5px] text-ink-3">{list.length} schedule{list.length === 1 ? '' : 's'}</span>
      </div>
      <ScheduleList schedules={list} emptyAction={() => ui.openSchedule({ mode: 'new' })} />
    </Page>
  );
}
