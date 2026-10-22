// The month bar on a house job: which months it is about. A seasonal job shows its window; a job that repeats every N months shows the
// months it falls due over the next year, starting from when it is next due. Pure, unit tested.
export type RibbonTask = {
  schedule: 'interval' | 'seasonal';
  interval_months: number | null;
  window_start_month: number | null;
  window_end_month: number | null;
  next_due_at: string; // YYYY-MM-DD
};

/** Twelve flags, January first; null when there is nothing to show. */
export function ribbonMonths(task: RibbonTask): boolean[] | null {
  const out = Array.from({ length: 12 }, () => false);
  if (task.schedule === 'seasonal') {
    const s = task.window_start_month, e = task.window_end_month;
    if (!s || !e) return null;
    for (let m = 1; m <= 12; m++) out[m - 1] = s <= e ? m >= s && m <= e : m >= s || m <= e;
    return out;
  }
  const step = task.interval_months;
  const first = Number(task.next_due_at.slice(5, 7));
  if (!step || step < 1 || !first) return null;
  for (let k = 0; k * step < 12; k++) out[(first - 1 + k * step) % 12] = true;
  return out;
}
