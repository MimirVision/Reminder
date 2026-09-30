import type { MaintenanceTask } from './types';

export type Bucket = 'due' | 'soon' | 'later';

const DAY = 86_400_000;
const ymd = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));

// Deliberately no "overdue": a task is due (now or past its window), coming up soon, or later.
export function bucketFor(task: Pick<MaintenanceTask, 'next_due_at'>, today: string, soonDays = 60): Bucket {
  const days = Math.round((ymd(task.next_due_at) - ymd(today)) / DAY);
  if (days <= 0) return 'due';
  return days <= soonDays ? 'soon' : 'later';
}

export function groupTasks<T extends Pick<MaintenanceTask, 'next_due_at' | 'active'>>(tasks: T[], today: string): Record<Bucket, T[]> {
  const out: Record<Bucket, T[]> = { due: [], soon: [], later: [] };
  for (const t of tasks) if (t.active) out[bucketFor(t, today)].push(t);
  for (const k of Object.keys(out) as Bucket[]) out[k].sort((a, b) => a.next_due_at.localeCompare(b.next_due_at));
  return out;
}
