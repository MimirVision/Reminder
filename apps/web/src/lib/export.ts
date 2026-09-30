import type { Lang, T } from '../i18n/core';
import { placeLabel, scheduleLabel, taskNotes, taskTitle } from './labels.ts';

// Export: everything in the household as a readable Markdown file plus raw JSON, so the data outlives the app.
// Self-contained (types only) so it can be unit tested with plain Node (export.test.ts).

export type ExportData = {
  exportedAt: string;
  household: { name: string };
  memories: { id: string; body: string; status: string; place_id: string | null; created_at: string; done_at: string | null; due_on?: string | null; due_time?: string | null }[];
  places: { id: string; name: string; kind: string; category: string | null; lat: number | null; lon: number | null; radius_m: number; address?: string | null }[];
  tasks: { id: string; template_key?: string | null; title: string; notes: string | null; schedule: string; interval_months: number | null; window_start_month: number | null; window_end_month: number | null; last_done_at: string | null; next_due_at: string; active: boolean }[];
  events: { task_id: string; done_at: string; cost_nok: number | null; note: string | null }[];
  facts: { title: string; value: string; category: string; surface_at: string[] }[];
  photos: { memory_id: string; file: string }[];
};

const oneLine = (s: string) => s.replace(/\s*\n\s*/g, ' — ').trim();

export const scheduleText = (t: ExportData['tasks'][number], tr: T) => scheduleLabel(t, tr);

export function buildMarkdown(d: ExportData, t: T, lang: Lang = 'en'): string {
  const placeName = (id: string | null) => { const p = d.places.find((x) => x.id === id); return p ? placeLabel(p, t) : undefined; };
  const out: string[] = [`# ${t('exp.title', { name: d.household.name })}`, '', t('exp.exported', { date: d.exportedAt.slice(0, 10) }), ''];

  const todo = (m: ExportData['memories'][number]) => {
    const place = placeName(m.place_id);
    const photos = d.photos.filter((p) => p.memory_id === m.id).map((p) => ` [photo](${p.file})`).join('');
    const due = m.due_on ? ` (${t('exp.due', { date: `${m.due_on}${m.due_time ? ` ${m.due_time.slice(0, 5)}` : ''}` })})` : '';
    return `- [${m.status === 'done' ? 'x' : ' '}] ${oneLine(m.body) || t('todo.photo')}${place ? ` (${place})` : ''}${due}${photos}`;
  };
  const open = d.memories.filter((m) => m.status === 'inbox' || m.status === 'active');
  const done = d.memories.filter((m) => m.status === 'done');
  out.push(`## ${t('exp.todo')}`, '', ...(open.length ? open.map(todo) : [t('exp.nothingOpen')]), '');
  if (done.length) out.push(`### ${t('exp.done')}`, '', ...done.map(todo), '');

  const facts = d.facts;
  out.push(`## ${t('exp.facts')}`, '');
  if (facts.length === 0) out.push(t('exp.noFacts'), '');
  for (const f of facts) out.push(`- **${f.title}** (${f.category}): ${oneLine(f.value)}${f.surface_at.length ? ` — ${t('exp.shownAt', { shops: f.surface_at.join(', ') })}` : ''}`);
  if (facts.length) out.push('');

  out.push(`## ${t('exp.maintenance')}`, '');
  const tasks = d.tasks.filter((x) => x.active);
  if (tasks.length === 0) out.push(t('exp.noTasks'), '');
  for (const task of tasks) {
    out.push(`### ${taskTitle(task, lang)}`, t('exp.taskLine', { schedule: scheduleText(task, t), last: task.last_done_at ?? t('exp.never'), next: task.next_due_at }));
    const notes = taskNotes(task, lang);
    if (notes) out.push(notes);
    const ev = d.events.filter((x) => x.task_id === task.id).sort((a, b) => b.done_at.localeCompare(a.done_at));
    if (ev.length) out.push('', t('exp.history'), ...ev.map((x) => `- ${x.done_at}${x.cost_nok != null ? ` — ${x.cost_nok} kr` : ''}${x.note ? ` — ${oneLine(x.note)}` : ''}`));
    out.push('');
  }

  out.push(`## ${t('exp.places')}`, '');
  if (d.places.length === 0) out.push(t('exp.noFacts'), '');
  for (const p of d.places) {
    const where = p.kind === 'category' ? t('exp.anyKind', { kind: String(p.category) }) : `${p.address ? `${p.address}; ` : ''}${p.lat}, ${p.lon}`;
    out.push(`- ${placeLabel(p, t)} (${where}, ${p.radius_m} m)`);
  }
  out.push('');
  return out.join('\n');
}
