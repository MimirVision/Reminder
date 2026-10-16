import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpDown, CalendarClock, Check, ChevronDown, Clock, ListChecks, Plus, Search, X } from 'lucide-react';
import { QuickAdd } from '../components/QuickAdd';
import { useTaskActions, type GroupBy } from '../components/TaskTable';
import { DatePicker } from '../ui/datepicker';
import { formatDayShort } from '../lib/format';
import type { ISODate } from '../lib/dates';
import { FilterMenu } from '../components/FilterMenu';
import { Page } from '../components/Shell';
import { TaskTable } from '../components/TaskTable';
import { useUI } from '../components/ui-state';
import { useStore } from '../data/store';
import { applyFilter, BLANK_FILTER, filterToQuery, isFiltered, queryToFilter, SAVED_VIEWS, viewFilter, type DueFilter, type SortKey, type TaskFilter } from '../lib/filters';
import { PRIORITY_LABEL, STATUS_LABEL, TYPE_LABEL } from '../lib/labels';
import { PRIORITIES, TASK_STATUSES, TASK_TYPES } from '../lib/types';
import { useRoute } from '../router';
import { Button } from '../ui/button';
import { cn } from '../ui/cn';
import { Menu, MenuLabel, MenuRadio } from '../ui/overlay';
import { EmptyState } from '../ui/states';

const DUE_OPTIONS: { value: DueFilter; label: string }[] = [
  { value: 'any', label: 'Any date' }, { value: 'overdue', label: 'Overdue' }, { value: 'today', label: 'Today' },
  { value: 'this_week', label: 'This week' }, { value: 'next_14', label: 'Next 14 days' }, { value: 'later', label: 'Later' },
  { value: 'completed_30', label: 'Completed in the last 30 days' },
];
const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'due', label: 'Due date' }, { value: 'priority', label: 'Priority' }, { value: 'client', label: 'Client' }, { value: 'title', label: 'Title' }, { value: 'completed', label: 'Recently completed' },
];

const same = (a: TaskFilter, b: TaskFilter) => filterToQuery(a) === filterToQuery(b);

const GROUP_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: 'none', label: 'No grouping' }, { value: 'day', label: 'Due day' }, { value: 'client', label: 'Client' }, { value: 'status', label: 'Status' },
];
const readGroup = (): GroupBy => { try { return (localStorage.getItem('ledger-group') as GroupBy) || 'none'; } catch { return 'none'; } };

export function Tasks() {
  const { snap, today, clientById } = useStore();
  const ui = useUI();
  const { query, navigate } = useRoute();
  const initial = () => (query.get('view') ? viewFilter(query.get('view')!) : query.toString() ? queryToFilter(query) : viewFilter('open'));
  const [f, setF] = useState<TaskFilter>(initial);
  const searchRef = useRef<HTMLInputElement>(null);
  const [groupBy, setGroupByState] = useState<GroupBy>(readGroup);
  const setGroupBy = (g: GroupBy) => { setGroupByState(g); try { localStorage.setItem('ledger-group', g); } catch { /* ignore */ } };
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const anchor = useRef<string | null>(null);
  const { run } = useStore();
  const actions = useTaskActions();

  // Follow links into this page (from the dashboard metrics, for example).
  const qs = query.toString();
  const lastWritten = useRef('');
  useEffect(() => { if (qs !== lastWritten.current) setF(initial()); }, [qs]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the URL in step, so a reload or the back button returns to the same list.
  useEffect(() => {
    const view = SAVED_VIEWS.find((v) => same(viewFilter(v.id), f));
    const next = view ? `view=${view.id}` : filterToQuery(f);
    lastWritten.current = next;
    if (next !== qs) navigate(`/tasks${next ? `?${next}` : ''}`, { replace: true });
  }, [f]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key === '/' && !(e.target as HTMLElement).closest('input,textarea,select,[contenteditable]')) { e.preventDefault(); searchRef.current?.focus(); }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);

  const tasks = useMemo(() => applyFilter(snap.occurrences, f, today, clientById), [snap.occurrences, f, today, clientById]);
  const activeView = SAVED_VIEWS.find((v) => same(viewFilter(v.id), f));
  // Selection follows the list: anything filtered away is no longer selected.
  useEffect(() => {
    setSelected((s) => { const ids = new Set(tasks.map((t) => t.id)); const n = new Set([...s].filter((id) => ids.has(id))); return n.size === s.size ? s : n; });
  }, [tasks]);
  const selection = {
    selected,
    toggle: (id: string, range: boolean) => setSelected((s) => {
      const n = new Set(s);
      if (range && anchor.current) {
        const ids = tasks.map((t) => t.id);
        const [a, b] = [ids.indexOf(anchor.current), ids.indexOf(id)].sort((x, y) => x - y);
        if (a >= 0) { ids.slice(a, b + 1).forEach((x) => n.add(x)); return n; }
      }
      anchor.current = id;
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    }),
    toggleAll: (ids: string[]) => setSelected((s) => (ids.every((id) => s.has(id)) ? new Set() : new Set(ids))),
  };
  const picked = tasks.filter((t) => selected.has(t.id));
  const bulk = (label: string, patch: (id: string) => Parameters<typeof run>[0]) => {
    const ids = picked.map((t) => t.id);
    void run(async (r) => { for (const id of ids) await patch(id)(r); return ids.length; }, { success: (n) => `${n} task${n === 1 ? '' : 's'} ${label}` })
      .then(() => setSelected(new Set()));
  };
  const bulkMove = (d: ISODate) => bulk(`moved to ${formatDayShort(d)}`, (id) => (r) => r.updateOccurrence(id, { dueDate: d }));
  const patch = (p: Partial<TaskFilter>) => setF((x) => ({ ...x, ...p }));
  const clientOptions = useMemo(() => [...snap.clients].sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => ({ value: c.id, label: c.name, hint: c.status === 'archived' ? 'Archived' : undefined })), [snap.clients]);
  const viewCounts = useMemo(() => Object.fromEntries(SAVED_VIEWS.map((v) => [v.id, applyFilter(snap.occurrences, viewFilter(v.id), today, clientById).length])),
    [snap.occurrences, today, clientById]);

  return (
    <Page title="My Tasks" wide>
      <div role="tablist" aria-label="Saved views" className="-mx-1 mb-4 flex gap-1 overflow-x-auto px-1 pb-1">
        {SAVED_VIEWS.map((v) => (
          <button key={v.id} role="tab" aria-selected={activeView?.id === v.id} onClick={() => setF(viewFilter(v.id))}
            className={cn(
              'flex h-8 shrink-0 items-center gap-1.5 rounded-md px-3 text-[13px] transition-colors',
              activeView?.id === v.id ? 'bg-surface font-medium text-ink shadow-soft ring-1 ring-line' : 'text-ink-2 hover:bg-hover hover:text-ink',
            )}>
            {v.name}
            <span className={cn('tnum text-[11.5px]', v.id === 'overdue' && viewCounts[v.id] ? 'text-danger' : 'text-ink-3')}>{viewCounts[v.id]}</span>
          </button>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-3" />
          <input ref={searchRef} value={f.search} onChange={(e) => patch({ search: e.target.value })} placeholder="Search tasks, clients, tags…" aria-label="Search tasks"
            className="h-7 w-full rounded-md border border-line-strong bg-surface pr-7 pl-8 text-[12.5px] placeholder:text-ink-3 focus:border-accent focus:ring-3 focus:ring-accent/15 focus:outline-none" />
          {f.search && <button aria-label="Clear search" onClick={() => patch({ search: '' })} className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-0.5 text-ink-3 hover:text-ink"><X className="size-3.5" /></button>}
        </div>
        <FilterMenu label="Client" searchable options={clientOptions} selected={f.clients} onChange={(clients) => patch({ clients })} />
        <FilterMenu label="Status" options={TASK_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))} selected={f.statuses} onChange={(statuses) => patch({ statuses })}
          summary={f.statuses.length === 3 && ['todo', 'in_progress', 'waiting'].every((s) => f.statuses.includes(s as never)) ? 'Open' : undefined} />
        <FilterMenu label="Priority" options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))} selected={f.priorities} onChange={(priorities) => patch({ priorities })} />
        <FilterMenu label="Type" options={TASK_TYPES.map((t) => ({ value: t, label: TYPE_LABEL[t] }))} selected={f.types} onChange={(types) => patch({ types })} />
        <Menu label="Due date filter" trigger={
          <button className={cn('inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[12.5px]', f.due !== 'any' ? 'border-accent/40 bg-accent-soft text-accent-ink' : 'border-line-strong bg-surface text-ink-2 hover:bg-hover')}>
            {f.due === 'any' ? 'Due date' : DUE_OPTIONS.find((o) => o.value === f.due)?.label}
            <ChevronDown className="size-3.5 opacity-70" />
          </button>
        }>
          <MenuRadio value={f.due} onChange={(due) => patch({ due })} options={DUE_OPTIONS} />
        </Menu>
        {(isFiltered(f) || f.statuses.length > 0) && !activeView && (
          <Button size="sm" variant="ghost" onClick={() => setF({ ...BLANK_FILTER })}><X /> Clear</Button>
        )}
        <div className="ml-auto flex items-center gap-2">
          <span className="tnum text-[12.5px] text-ink-3" aria-live="polite">{tasks.length} task{tasks.length === 1 ? '' : 's'}</span>
          <Menu align="end" label="Sort and group" trigger={<Button size="sm" variant="ghost"><ArrowUpDown /> {SORT_OPTIONS.find((o) => o.value === f.sort)?.label}{groupBy !== 'none' && ` · grouped by ${({ day: 'day', client: 'client', status: 'status' } as const)[groupBy]}`}</Button>}>
            <MenuLabel>Sort by</MenuLabel>
            <MenuRadio value={f.sort} onChange={(sort) => patch({ sort })} options={SORT_OPTIONS} />
            <MenuLabel>Group by</MenuLabel>
            <MenuRadio value={groupBy} onChange={setGroupBy} options={GROUP_OPTIONS} />
          </Menu>
        </div>
      </div>

      <QuickAdd className="mb-3" />
      <div className="overflow-clip rounded-lg border border-line bg-surface">
        {tasks.length ? <TaskTable tasks={tasks} groupBy={groupBy} selection={selection} /> : (
          <EmptyState icon={ListChecks} title={isFiltered(f) ? 'No tasks match these filters' : activeView?.id === 'overdue' ? 'Nothing overdue' : 'No tasks here'}
            body={isFiltered(f) ? 'Try removing a filter or searching for something else.' : 'Tasks you add, and tasks created by recurring schedules, appear here.'}
            action={isFiltered(f) ? <Button size="sm" onClick={() => setF(viewFilter('open'))}>Show all open tasks</Button> : <Button size="sm" variant="primary" onClick={() => ui.openNewTask()}><Plus /> New task</Button>} />
        )}
      </div>
      <p className="mt-2 hidden text-[11.5px] text-ink-3 md:block">
        Keyboard: ↑↓ move · Enter open · D done · W waiting · T tomorrow · X select (Shift for a range) · / search · N new task
      </p>

      {picked.length > 0 && (
        <div role="toolbar" aria-label="Selected tasks" className="sticky bottom-4 z-20 mx-auto mt-4 flex w-fit animate-toast-in items-center gap-1 rounded-xl bg-ink py-1.5 pr-1.5 pl-4 text-[13px] text-canvas shadow-pop">
          <span className="tnum mr-2 font-medium">{picked.length} selected</span>
          <button className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 hover:bg-white/10" onClick={() => bulk('marked done', (id) => (r) => r.updateOccurrence(id, { status: 'done' }))}><Check className="size-4" /> Done</button>
          <button className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 hover:bg-white/10" onClick={() => bulk('set to waiting', (id) => (r) => r.updateOccurrence(id, { status: 'waiting' }))}><Clock className="size-4" /> Waiting</button>
          <button className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 hover:bg-white/10" onClick={() => bulkMove(actions.tomorrow)}><CalendarClock className="size-4" /> Tomorrow</button>
          <DatePicker value={null} today={today} onChange={bulkMove} trigger={
            <button className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 hover:bg-white/10">Move to… <ChevronDown className="size-3.5" /></button>
          } />
          <button aria-label="Clear selection" className="ml-1 inline-flex size-8 items-center justify-center rounded-lg hover:bg-white/10" onClick={() => setSelected(new Set())}><X className="size-4" /></button>
        </div>
      )}
    </Page>
  );
}
