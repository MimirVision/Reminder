import type { MaintenanceTask } from './types.ts';

export type Bucket = 'due' | 'soon' | 'later';

const DAY = 86_400_000;
const ymd = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));

// Deliberately no "overdue": a task is due (now or past its window), coming up soon, or later.
export function bucketFor(task: Pick<MaintenanceTask, 'next_due_at'>, today: string, soonDays = 60): Bucket {
  const days = Math.round((ymd(task.next_due_at) - ymd(today)) / DAY);
  if (days <= 0) return 'due';
  return days <= soonDays ? 'soon' : 'later';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function scheduleLabel(t: Pick<MaintenanceTask, 'schedule' | 'interval_months' | 'window_start_month' | 'window_end_month'>): string {
  if (t.schedule === 'seasonal' && t.window_start_month && t.window_end_month) {
    const a = MONTHS[t.window_start_month - 1];
    const b = MONTHS[t.window_end_month - 1];
    return a === b ? `every ${a}` : `every ${a}–${b}`;
  }
  const n = t.interval_months ?? 12;
  if (n % 12 === 0) return n === 12 ? 'every year' : `every ${n / 12} years`;
  return n === 1 ? 'every month' : `every ${n} months`;
}

export function groupTasks<T extends Pick<MaintenanceTask, 'next_due_at' | 'active'>>(tasks: T[], today: string): Record<Bucket, T[]> {
  const out: Record<Bucket, T[]> = { due: [], soon: [], later: [] };
  for (const t of tasks) if (t.active) out[bucketFor(t, today)].push(t);
  for (const k of Object.keys(out) as Bucket[]) out[k].sort((a, b) => a.next_due_at.localeCompare(b.next_due_at));
  return out;
}
