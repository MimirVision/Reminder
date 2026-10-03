// The morning briefing: one notification a day at a time you choose, "3 things today", planned for the coming days. Pure, unit tested.
export type BriefItem = { id: string; body: string; status: string; due_on: string | null; due_time: string | null };
export type Briefing = { at: Date; day: string; count: number; late: number; titles: string[] };

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** For each of the next `days` days whose briefing time is still ahead and that has something due: the count and the first titles.
 *  Today's briefing also counts what is overdue. `time` is "HH:MM". */
export function planBriefings(items: BriefItem[], now: Date, time: string, days = 7, titleCount = 3): Briefing[] {
  const [h, m] = time.split(':').map(Number);
  const open = items.filter((i) => i.due_on && (i.status === 'active' || i.status === 'inbox'));
  const out: Briefing[] = [];
  for (let k = 0; k < days; k++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + k, h || 0, m || 0, 0, 0);
    if (day.getTime() <= now.getTime()) continue;
    const d = iso(day);
    const late = k === 0 ? open.filter((i) => (i.due_on as string) < d).length : 0;
    const today = open.filter((i) => i.due_on === d).sort((a, b) => (a.due_time ?? '99:99').localeCompare(b.due_time ?? '99:99'));
    if (today.length + late === 0) continue;
    out.push({ at: day, day: d, count: today.length + late, late, titles: today.slice(0, titleCount).map((i) => i.body.split('\n')[0].trim()) });
  }
  return out;
}
