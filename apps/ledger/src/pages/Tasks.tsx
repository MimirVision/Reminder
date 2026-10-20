import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpDown, BookmarkPlus, CalendarClock, Check, ChevronDown, Clock, ListChecks, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { useTaskActions, type GroupBy } from '../components/TaskTable';
import { TaskBoard } from '../components/TaskBoard';
import { Field, Input, Segmented } from '../ui/field';
import { useToast } from '../ui/toast';
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
import { Dialog, Menu, MenuItem, MenuLabel, MenuRadio } from '../ui/overlay';
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
// Grouped by due day unless the person chose otherwise: Overdue, Today, Tomorrow… matches how the day is planned.
const readGroup = (): GroupBy => { try { return (localStorage.getItem('ledger-group') as GroupBy) || 'day'; } catch { return 'day'; } };

export function Tasks() {
  const { snap, today, clientById } = useStore();
  const ui = useUI();
  const { query, navigate } = useRoute();
  const initial = () => (query.get('view') ? viewFilter(query.get('view')!) : query.toString() ? queryToFilter(query) : viewFilter('open'));
  const [f, setF] = useState<TaskFilter>(initial);
  const searchRef = useRef<HTMLInputElement>(null);
  const [groupBy, setGroupByState] = useState<GroupBy>(readGroup);
  const [layout, setLayoutState] = useState<'list' | 'board'>(() => { try { return localStorage.getItem('ledger-layout') === 'board' ? 'board' : 'list'; } catch { return 'list'; } });
  const setLayout = (l: 'list' | 'board') => { setLayoutState(l); try { localStorage.setItem('ledger-layout', l); } catch { /* ignore */ } };
  const setGroupBy = (g: GroupBy) => { setGroupByState(g); try { localStorage.setItem('ledger-group', g); } catch { /* ignore */ } };
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const anchor = useRef<string | null>(null);
  const { run, saveSettings } = useStore();
  const toast = useToast();
  const [naming, setNaming] = useState<null | { id?: string; name: string }>(null);
  const saveView = () => {
    const name = naming?.name.trim().slice(0, 40);
    if (!naming || !name) return;
    const views = snap.workspace.settings.savedViews ?? [];
    if (views.length >= 12 && !naming.id) { toast.show('Up to 12 views of your own.', { tone: 'error' }); return; }
    const next = naming.id ? views.map((v) => (v.id === naming.id ? { ...v, name } : v)) : [...views, { id: crypto.randomUUID().slice(0, 8), name, query: filterToQuery(f) }];
    void saveSettings({ savedViews: next }).then((ok) => ok && toast.show(naming.id ? 'View renamed' : `Saved “${name}”`));
    setNaming(null);
  };
  const deleteView = (id: string) => {
    const views = snap.workspace.settings.savedViews ?? [];
    const gone = views.find((v) => v.id === id);
    void saveSettings({ savedViews: views.filter((v) => v.id !== id) }).then((ok) => ok && toast.show(`Deleted “${gone?.name}”`, {
      undo: () => void saveSettings({ savedViews: views }),
    }));
  };
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
      if (e.key === '/' && !document.querySelector('[role=dialog]') && !(e.target as HTMLElement).closest('input,textarea,select,[contenteditable]')) { e.preventDefault(); searchRef.current?.focus(); }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);

  const tasks = useMemo(() => applyFilter(snap.occurrences, f, today, clientById), [snap.occurrences, f, today, clientById]);
  const activeView = SAVED_VIEWS.find((v) => same(viewFilter(v.id), f));
  const mine = snap.workspace.settings.savedViews ?? [];
  const activeMine = activeView ? undefined : mine.find((v) => same(queryToFilter(new URLSearchParams(v.query)), f));
  // Selection follows the list: anything filtered away is no longer selected.
  useEffect(() => {
    setSelected((s) => { const ids = new Set(tasks.map((t) => t.id)); const n = new Set([...s].filter((id) => ids.has(id))); return n.size === s.size ? s : n; });
  }, [tasks]);
  const selection = {
    selected,
    toggle: (id: string, range: boolean) => setSelected((s) => {
      const n = new Set(s);
      if (range && anchor.current) {
        // The order on screen (grouping changes it), and only rows that are showing (not in folded groups).
        const ids = [...document.querySelectorAll<HTMLElement>('tbody tr[data-task]')].map((r) => r.dataset.task!);
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
  const ownCounts = useMemo(() => Object.fromEntries((snap.workspace.settings.savedViews ?? []).map((v) => [v.id, applyFilter(snap.occurrences, queryToFilter(new URLSearchParams(v.query)), today, clientById).length])),
    [snap.occurrences, snap.workspace.settings.savedViews, today, clientById]);
  const viewCounts = useMemo(() => Object.fromEntries(SAVED_VIEWS.map((v) => [v.id, applyFilter(snap.occurrences, viewFilter(v.id), today, clientById).length])),
    [snap.occurrences, today, clientById]);

  return (
    <Page title="My Tasks" titleExtra={
      <Segmented label="Layout" value={layout} onChange={setLayout} options={[{ value: 'list', label: 'List' }, { value: 'board', label: 'Board' }]} />
    }>
      <div role="tablist" aria-label="Saved views" className="-mx-4 mb-4 flex gap-6 overflow-x-auto border-b border-line px-4 md:-mx-8 md:px-8">
        {SAVED_VIEWS.map((v) => (
          <button key={v.id} role="tab" aria-selected={activeView?.id === v.id} onClick={() => setF(viewFilter(v.id))}
            className={cn(
              '-mb-px flex shrink-0 items-center gap-1.5 border-b-2 pt-1 pb-2.5 text-[13.5px] transition-colors',
              activeView?.id === v.id ? 'border-accent font-semibold text-ink' : 'border-transparent text-ink-2 hover:border-line-strong hover:text-ink',
            )}>
            {v.name}
            <span className={cn('num text-[11.5px]', v.id === 'overdue' && viewCounts[v.id] ? 'text-danger' : 'text-ink-3')}>{viewCounts[v.id]}</span>
          </button>
        ))}
        {mine.length > 0 && <span aria-hidden className="my-2 w-px shrink-0 bg-line" />}
        {mine.map((v) => {
          const on = activeMine?.id === v.id;
          return (
            <div key={v.id} className={cn('group -mb-px flex shrink-0 items-center border-b-2', on ? 'border-accent' : 'border-transparent hover:border-line-strong')}>
              <button role="tab" aria-selected={on} onClick={() => setF(queryToFilter(new URLSearchParams(v.query)))}
                className={cn('flex items-center gap-1.5 pt-1 pb-2.5 text-[13.5px] transition-colors', on ? 'font-semibold text-ink' : 'text-ink-2 hover:text-ink')}>
                {v.name}<span className="num text-[11.5px] text-ink-3">{ownCounts[v.id]}</span>
              </button>
              <Menu align="end" label={`Options for ${v.name}`} trigger={
                <button aria-label={`Options for ${v.name}`} className="mb-1.5 ml-0.5 flex size-5 items-center justify-center rounded text-ink-3 opacity-0 group-hover:opacity-100 hover:bg-hover hover:text-ink focus-visible:opacity-100 data-[state=open]:opacity-100">
                  <ChevronDown className="size-3.5" />
                </button>
              }>
                <MenuItem onSelect={() => setNaming({ id: v.id, name: v.name })}><Pencil /> Rename</MenuItem>
                <MenuItem danger onSelect={() => deleteView(v.id)}><Trash2 /> Delete view</MenuItem>
              </Menu>
            </div>
          );
        })}
        {!activeView && !activeMine && (isFiltered(f) || f.statuses.length > 0) && (
          <button onClick={() => setNaming({ name: '' })} className="-mb-px flex shrink-0 items-center gap-1 border-b-2 border-transparent pt-1 pb-2.5 text-[13px] text-accent hover:text-accent-hover">
            <BookmarkPlus className="size-3.5" /> Save view
          </button>
        )}
      </div>
      <Dialog open={naming !== null} onOpenChange={(o) => !o && setNaming(null)} title={naming?.id ? 'Rename view' : 'Save this view'}
        description={naming?.id ? undefined : 'Keeps these filters and sorting as a tab of its own, on every device.'}
        width="max-w-sm" footer={<><Button onClick={() => setNaming(null)}>Cancel</Button><Button variant="primary" disabled={!naming?.name.trim()} onClick={saveView}>{naming?.id ? 'Rename' : 'Save view'}</Button></>}>
        <form onSubmit={(e) => { e.preventDefault(); saveView(); }}>
          <Field label="Name">{(p) => <Input {...p} autoFocus maxLength={40} placeholder="e.g. Payroll this week" value={naming?.name ?? ''} onChange={(e) => setNaming((n) => n && { ...n, name: e.target.value })} />}</Field>
        </form>
      </Dialog>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-3" />
          <input ref={searchRef} value={f.search} onChange={(e) => patch({ search: e.target.value })} placeholder="Search tasks, clients, tags…" aria-label="Search tasks"
            className="h-8 w-full rounded-lg border border-line bg-surface pr-7 pl-8 text-[13px] placeholder:text-ink-3 focus:border-accent focus:ring-3 focus:ring-accent/15 focus:outline-none" />
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

      {layout === 'board' ? <TaskBoard tasks={tasks} /> : <div className="overflow-clip rounded-xl border border-line bg-surface">
        {tasks.length ? <TaskTable tasks={tasks} groupBy={groupBy} selection={selection} addRow={{}} /> : (
          <EmptyState icon={ListChecks} title={isFiltered(f) ? 'No tasks match these filters' : activeView?.id === 'overdue' ? 'Nothing overdue' : 'No tasks here'}
            body={isFiltered(f) ? 'Try removing a filter or searching for something else.' : 'Tasks you add, and tasks created by recurring schedules, appear here.'}
            action={isFiltered(f) ? <Button size="sm" onClick={() => setF(viewFilter('open'))}>Show all open tasks</Button> : <Button size="sm" variant="primary" onClick={() => ui.openNewTask()}><Plus /> New task</Button>} />
        )}
      </div>}
      <p className={cn('mt-2 hidden text-[11.5px] text-ink-3', layout === 'list' && 'md:block')}>
        Keyboard: ↑↓ move · Enter open · D done · W waiting · T tomorrow · X select (Shift for a range) · / search · N new task · ? all shortcuts
      </p>

      {layout === 'list' && picked.length > 0 && (
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
