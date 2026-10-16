import { addDays, startOfWeek, type ISODate } from './dates';
import { PRIORITY_RANK } from './labels';
import type { Client, Occurrence, Priority, TaskStatus, TaskType } from './types';
import { isOpen } from './types';

export type DueFilter = 'any' | 'overdue' | 'today' | 'this_week' | 'next_14' | 'later' | 'completed_30';
export type SortKey = 'due' | 'priority' | 'client' | 'title' | 'completed';

export interface TaskFilter {
  search: string;
  clients: string[];
  statuses: TaskStatus[];
  priorities: Priority[];
  types: TaskType[];
  due: DueFilter;
  sort: SortKey;
}

export const BLANK_FILTER: TaskFilter = { search: '', clients: [], statuses: [], priorities: [], types: [], due: 'any', sort: 'due' };

export interface SavedView { id: string; name: string; filter: Partial<TaskFilter> }

const OPEN: TaskStatus[] = ['todo', 'in_progress', 'waiting'];

export const SAVED_VIEWS: SavedView[] = [
  { id: 'open', name: 'All open tasks', filter: { statuses: OPEN } },
  { id: 'today', name: 'Due today', filter: { statuses: OPEN, due: 'today' } },
  { id: 'overdue', name: 'Overdue', filter: { statuses: OPEN, due: 'overdue' } },
  { id: 'week', name: 'Due this week', filter: { statuses: OPEN, due: 'this_week' } },
  { id: 'waiting', name: 'Waiting for client', filter: { statuses: ['waiting'] } },
  { id: 'high', name: 'High priority', filter: { statuses: OPEN, priorities: ['urgent', 'high'], sort: 'priority' } },
  { id: 'completed', name: 'Completed recently', filter: { statuses: ['done'], due: 'completed_30', sort: 'completed' } },
];

export function viewFilter(id: string): TaskFilter {
  const v = SAVED_VIEWS.find((x) => x.id === id) ?? SAVED_VIEWS[0];
  return { ...BLANK_FILTER, ...v.filter };
}

export function matchesDue(o: Occurrence, due: DueFilter, today: ISODate): boolean {
  switch (due) {
    case 'any': return true;
    case 'overdue': return isOpen(o.status) && o.dueDate < today;
    case 'today': return o.dueDate === today;
    case 'this_week': { const s = startOfWeek(today); return o.dueDate >= s && o.dueDate <= addDays(s, 6); }
    case 'next_14': return o.dueDate >= today && o.dueDate <= addDays(today, 14);
    case 'later': return o.dueDate > addDays(today, 14);
    case 'completed_30': return !!o.completedAt && o.completedAt.slice(0, 10) >= addDays(today, -30);
  }
}

export function applyFilter(tasks: Occurrence[], f: TaskFilter, today: ISODate, clientById: Map<string, Client>): Occurrence[] {
  const q = f.search.trim().toLowerCase();
  const out = tasks.filter((o) => {
    if (f.clients.length && !f.clients.includes(o.clientId)) return false;
    if (f.statuses.length && !f.statuses.includes(o.status)) return false;
    if (f.priorities.length && !f.priorities.includes(o.priority)) return false;
    if (f.types.length && !f.types.includes(o.taskType)) return false;
    if (!matchesDue(o, f.due, today)) return false;
    if (q) {
      const c = clientById.get(o.clientId);
      const hay = `${o.title} ${o.description} ${o.tags.join(' ')} ${c?.name ?? ''} ${c?.reference ?? ''}`.toLowerCase();
      if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
    }
    return true;
  });
  return sortTasks(out, f.sort, clientById);
}

export function sortTasks(tasks: Occurrence[], sort: SortKey, clientById: Map<string, Client>): Occurrence[] {
  const name = (o: Occurrence) => clientById.get(o.clientId)?.name ?? '';
  const byDue = (a: Occurrence, b: Occurrence) => a.dueDate.localeCompare(b.dueDate) || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || name(a).localeCompare(name(b)) || a.title.localeCompare(b.title);
  const cmp: Record<SortKey, (a: Occurrence, b: Occurrence) => number> = {
    due: byDue,
    priority: (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || byDue(a, b),
    client: (a, b) => name(a).localeCompare(name(b)) || byDue(a, b),
    title: (a, b) => a.title.localeCompare(b.title) || byDue(a, b),
    completed: (a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? '') || byDue(a, b),
  };
  return [...tasks].sort(cmp[sort]);
}

export function isFiltered(f: TaskFilter): boolean {
  return Boolean(f.search || f.clients.length || f.priorities.length || f.types.length || f.due !== 'any');
}

/** Filters as URL query parameters, so a filtered list can be bookmarked, shared with yourself, or restored. */
export function filterToQuery(f: TaskFilter): string {
  const p = new URLSearchParams();
  if (f.search) p.set('q', f.search);
  if (f.clients.length) p.set('client', f.clients.join(','));
  if (f.statuses.length) p.set('status', f.statuses.join(','));
  if (f.priorities.length) p.set('priority', f.priorities.join(','));
  if (f.types.length) p.set('type', f.types.join(','));
  if (f.due !== 'any') p.set('due', f.due);
  if (f.sort !== 'due') p.set('sort', f.sort);
  return p.toString();
}

export function queryToFilter(q: URLSearchParams): TaskFilter {
  const list = <T extends string>(k: string) => (q.get(k)?.split(',').filter(Boolean) ?? []) as T[];
  return {
    search: q.get('q') ?? '',
    clients: list('client'), statuses: list('status'), priorities: list('priority'), types: list('type'),
    due: (q.get('due') as DueFilter) ?? 'any', sort: (q.get('sort') as SortKey) ?? 'due',
  };
}
