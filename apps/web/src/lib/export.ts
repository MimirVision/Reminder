// Export: everything in the household as a readable Markdown file plus raw JSON, so the data outlives the app.
// Self-contained (types only) so it can be unit tested with plain Node (export.test.ts).

export type ExportData = {
  exportedAt: string;
  household: { name: string };
  memories: { id: string; body: string; status: string; place_id: string | null; created_at: string; done_at: string | null }[];
  places: { id: string; name: string; kind: string; category: string | null; lat: number | null; lon: number | null; radius_m: number }[];
  tasks: { id: string; title: string; notes: string | null; schedule: string; interval_months: number | null; window_start_month: number | null; window_end_month: number | null; last_done_at: string | null; next_due_at: string; active: boolean }[];
  events: { task_id: string; done_at: string; cost_nok: number | null; note: string | null }[];
  facts: { title: string; value: string; category: string; surface_at: string[] }[];
  photos: { memory_id: string; file: string }[];
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const oneLine = (s: string) => s.replace(/\s*\n\s*/g, ' — ').trim();

export function scheduleText(t: ExportData['tasks'][number]): string {
  if (t.schedule === 'seasonal' && t.window_start_month && t.window_end_month) {
    const a = MONTHS[t.window_start_month - 1], b = MONTHS[t.window_end_month - 1];
    return `every year, ${a === b ? a : `${a}–${b}`}`;
  }
  const n = t.interval_months ?? 12;
  return n % 12 === 0 ? (n === 12 ? 'every year' : `every ${n / 12} years`) : `every ${n} months`;
}

export function buildMarkdown(d: ExportData): string {
  const placeName = (id: string | null) => d.places.find((p) => p.id === id)?.name;
  const out: string[] = [`# ${d.household.name}: Home Memory export`, '', `Exported ${d.exportedAt.slice(0, 10)}.`, ''];

  const todo = (m: ExportData['memories'][number]) => {
    const place = placeName(m.place_id);
    const photos = d.photos.filter((p) => p.memory_id === m.id).map((p) => ` [photo](${p.file})`).join('');
    return `- [${m.status === 'done' ? 'x' : ' '}] ${oneLine(m.body) || '(photo)'}${place ? ` (${place})` : ''}${photos}`;
  };
  const open = d.memories.filter((m) => m.status === 'inbox' || m.status === 'active');
  const done = d.memories.filter((m) => m.status === 'done');
  out.push('## To-do', '', ...(open.length ? open.map(todo) : ['Nothing open.']), '');
  if (done.length) out.push('### Done', '', ...done.map(todo), '');

  const facts = d.facts;
  out.push('## Facts', '');
  if (facts.length === 0) out.push('None saved.', '');
  for (const f of facts) out.push(`- **${f.title}** (${f.category}): ${oneLine(f.value)}${f.surface_at.length ? ` — shown at ${f.surface_at.join(', ')}` : ''}`);
  if (facts.length) out.push('');

  out.push('## House maintenance', '');
  const tasks = d.tasks.filter((t) => t.active);
  if (tasks.length === 0) out.push('No tasks.', '');
  for (const t of tasks) {
    out.push(`### ${t.title}`, `${scheduleText(t)}. Last done: ${t.last_done_at ?? 'never'}. Next due: ${t.next_due_at}.`);
    if (t.notes) out.push(t.notes);
    const ev = d.events.filter((e) => e.task_id === t.id).sort((a, b) => b.done_at.localeCompare(a.done_at));
    if (ev.length) out.push('', 'History:', ...ev.map((e) => `- ${e.done_at}${e.cost_nok != null ? ` — ${e.cost_nok} kr` : ''}${e.note ? ` — ${oneLine(e.note)}` : ''}`));
    out.push('');
  }

  out.push('## Places', '');
  if (d.places.length === 0) out.push('None saved.', '');
  for (const p of d.places) {
    out.push(`- ${p.name} (${p.kind === 'category' ? `any ${p.category}` : `${p.lat}, ${p.lon}`}, ${p.radius_m} m)`);
  }
  out.push('');
  return out.join('\n');
}
