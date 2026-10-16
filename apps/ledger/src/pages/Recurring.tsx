import { useMemo, useState } from 'react';
import { CalendarX2, Pause, Plus, Repeat, Search } from 'lucide-react';
import { FilterMenu } from '../components/FilterMenu';
import { Page } from '../components/Shell';
import { useUI } from '../components/ui-state';
import { useStore } from '../data/store';
import { formatDue } from '../lib/format';
import { SCHEDULE_STATUS_LABEL, TYPE_LABEL } from '../lib/labels';
import { describeDueRule, describeRecurrence, isPausedOn, recurrenceOf, upcomingPeriods } from '../lib/recurrence';
import { isOpen, type Schedule, type ScheduleStatus } from '../lib/types';
import { Pill } from '../ui/badges';
import { Button } from '../ui/button';
import { EmptyState } from '../ui/states';

export function ScheduleList({ schedules, showClient = true, emptyAction }: { schedules: Schedule[]; showClient?: boolean; emptyAction?: () => void }) {
  const { snap, today, clientById } = useStore();
  const ui = useUI();
  const info = useMemo(() => new Map(schedules.map((s) => {
    const pauses = snap.pauses.filter((p) => p.scheduleId === s.id);
    const next = s.status === 'ended' ? undefined : upcomingPeriods(recurrenceOf(s), today, 6).find((p) => !isPausedOn(p.due, pauses));
    const tasks = snap.occurrences.filter((o) => o.scheduleId === s.id);
    return [s.id, { next, total: tasks.length, open: tasks.filter((o) => isOpen(o.status)).length }];
  })), [schedules, snap.pauses, snap.occurrences, today]);

  if (!schedules.length) {
    return (
      <div className="rounded-lg border border-line bg-surface shadow-soft">
        <EmptyState icon={Repeat} title="No recurring schedules" body="A schedule describes work that repeats, such as monthly bookkeeping or a two-monthly VAT return. Ledger then creates each period’s task and checks that none are missing."
          action={emptyAction && <Button variant="primary" onClick={emptyAction}><Plus /> New schedule</Button>} />
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface shadow-soft">
      <table className="w-full table-fixed border-collapse">
        <thead>
          <tr className="h-8 border-b border-line text-left text-[11.5px] text-ink-3">
            <th className="pl-4 font-medium">Schedule</th>
            {showClient && <th className="hidden w-[22%] pr-3 font-medium md:table-cell">Client</th>}
            <th className="hidden w-[24%] pr-3 font-medium lg:table-cell">Due</th>
            <th className="w-28 pr-3 font-medium">Next due</th>
            <th className="hidden w-24 pr-3 font-medium sm:table-cell">Tasks</th>
            <th className="w-24 pr-4 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {schedules.map((s) => {
            const i = info.get(s.id)!;
            return (
              <tr key={s.id} className="h-12 cursor-default border-b border-line last:border-b-0 hover:bg-hover/70" onClick={() => ui.openSchedule({ mode: 'edit', id: s.id })}>
                <td className="max-w-0 py-1.5 pr-3 pl-4">
                  <button className="block max-w-full truncate text-left text-[13px] font-medium hover:text-accent" onClick={(e) => { e.stopPropagation(); ui.openSchedule({ mode: 'edit', id: s.id }); }}>{s.title}</button>
                  <div className="truncate text-[12px] text-ink-3">{describeRecurrence(s)} · {TYPE_LABEL[s.taskType]}{!s.autoGenerate && ' · check only'}</div>
                </td>
                {showClient && <td className="hidden max-w-0 truncate pr-3 text-[12.5px] text-ink-2 md:table-cell">{clientById.get(s.clientId)?.name}</td>}
                <td className="hidden max-w-0 truncate pr-3 text-[12px] text-ink-3 lg:table-cell" title={describeDueRule(s.dueRule)}>{describeDueRule(s.dueRule)}</td>
                <td className="tnum pr-3 text-[12.5px] text-ink-2">{i.next ? formatDue(i.next.due, today) : <span className="text-ink-3">—</span>}</td>
                <td className="tnum hidden pr-3 text-[12.5px] text-ink-3 sm:table-cell">{i.total}{i.open > 0 && <span> · {i.open} open</span>}</td>
                <td className="pr-4">
                  <Pill tone={s.status === 'active' ? 'ok' : s.status === 'paused' ? 'warn' : 'neutral'}>
                    {s.status === 'paused' ? <Pause /> : s.status === 'ended' ? <CalendarX2 /> : null}{SCHEDULE_STATUS_LABEL[s.status]}
                  </Pill>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
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
      <p className="mb-4 max-w-3xl text-[13px] text-ink-2">
        Schedules are <strong className="font-medium text-ink">rules</strong>; the tasks they create are <strong className="font-medium text-ink">occurrences</strong>, one per period.
        Editing a schedule never rewrites completed tasks, and pausing or ending one keeps all history.
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
