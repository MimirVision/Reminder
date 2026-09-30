import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMarkdown as build, scheduleText as sched, type ExportData } from './export.ts';
import { makeT } from '../i18n/core.ts';

const en = makeT('en');
const buildMarkdown = (d: ExportData) => build(d, en);
const scheduleText = (x: ExportData['tasks'][number]) => sched(x, en);

const data: ExportData = {
  exportedAt: '2026-09-30T10:00:00Z',
  household: { name: 'Home' },
  places: [{ id: 'p1', name: 'Any pharmacy', kind: 'category', category: 'pharmacy', lat: null, lon: null, radius_m: 150 }, { id: 'p2', name: 'Cabin', kind: 'fixed', category: null, lat: 60.1, lon: 10.2, radius_m: 250 }],
  memories: [
    { id: 'm1', body: 'Buy plasters\nand tape', status: 'active', place_id: 'p1', created_at: '', done_at: null },
    { id: 'm2', body: '', status: 'inbox', place_id: null, created_at: '', done_at: null },
    { id: 'm3', body: 'Order stain', status: 'done', place_id: null, created_at: '', done_at: '2026-09-01' },
    { id: 'm4', body: 'dismissed one', status: 'dismissed', place_id: null, created_at: '', done_at: null },
  ],
  tasks: [
    { id: 't1', title: 'Clean gutters', notes: 'Check brackets.', schedule: 'seasonal', interval_months: null, window_start_month: 9, window_end_month: 10, last_done_at: '2025-10-05', next_due_at: '2026-09-01', active: true },
    { id: 't2', title: 'Old task', notes: null, schedule: 'interval', interval_months: 24, window_start_month: null, window_end_month: null, last_done_at: null, next_due_at: '2027-01-01', active: false },
  ],
  events: [{ task_id: 't1', done_at: '2025-10-05', cost_nok: 450, note: 'front only' }, { task_id: 't1', done_at: '2024-10-01', cost_nok: null, note: null }],
  facts: [{ title: 'Water shutoff', value: 'Under the sink\nleft valve', category: 'emergency', surface_at: [] }, { title: 'Bulbs', value: 'E27', category: 'appliance', surface_at: ['hardware'] }],
  photos: [{ memory_id: 'm1', file: 'photos/m1-1.jpg' }],
};

test('markdown lists open to-dos, done ones, and hides dismissed', () => {
  const md = buildMarkdown(data);
  assert.match(md, /^# Home: Home Memory export/);
  assert.match(md, /- \[ \] Buy plasters — and tape \(Any pharmacy \(apotek\)\) \[photo\]\(photos\/m1-1\.jpg\)/);
  assert.match(md, /- \[ \] \(photo\)/);
  assert.match(md, /### Done\n\n- \[x\] Order stain/);
  assert.doesNotMatch(md, /dismissed one/);
});

test('markdown has facts, maintenance with history (newest first), and places', () => {
  const md = buildMarkdown(data);
  assert.match(md, /- \*\*Water shutoff\*\* \(emergency\): Under the sink — left valve/);
  assert.match(md, /shown at hardware/);
  assert.match(md, /### Clean gutters\nevery year, Sep–Oct\. Last done: 2025-10-05\. Next due: 2026-09-01\./);
  assert.ok(md.indexOf('2025-10-05 — 450 kr — front only') < md.indexOf('- 2024-10-01'), 'history newest first');
  assert.doesNotMatch(md, /Old task/, 'retired tasks are left out');
  assert.match(md, /- Any pharmacy \(apotek\) \(any pharmacy, 150 m\)/);
  assert.match(md, /- Cabin \(60\.1, 10\.2, 250 m\)/);
});

test('schedule text', () => {
  const t = (over: object) => ({ id: '', title: '', notes: null, schedule: 'interval', interval_months: 3, window_start_month: null, window_end_month: null, last_done_at: null, next_due_at: '', active: true, ...over }) as ExportData['tasks'][number];
  assert.equal(scheduleText(t({})), 'every 3 months');
  assert.equal(scheduleText(t({ interval_months: 12 })), 'every year');
  assert.equal(scheduleText(t({ interval_months: 60 })), 'every 5 years');
  assert.equal(scheduleText(t({ schedule: 'seasonal', window_start_month: 5, window_end_month: 5 })), 'every year, May');
});

test('empty household still exports cleanly', () => {
  const md = buildMarkdown({ ...data, memories: [], tasks: [], events: [], facts: [], places: [], photos: [] });
  assert.match(md, /Nothing open\./);
  assert.match(md, /No tasks\./);
});

test('the export can be written in Norwegian, including the house template', () => {
  const md = build({ ...data, tasks: [{ ...data.tasks[0], template_key: 'gutters_autumn' }] }, makeT('nb'), 'nb');
  assert.match(md, /Eksportert 2026-09-30\./);
  assert.match(md, /### Rens takrenner og nedløpsrør/);
  assert.match(md, /hvert år, Sep–Okt|hvert år, sep–okt/i);
  assert.match(md, /Sist gjort: 2025-10-05/);
});

test('dated to-dos show their date', () => {
  const md = buildMarkdown({ ...data, memories: [{ ...data.memories[0], due_on: '2026-10-03', due_time: '18:00:00' }] });
  assert.match(md, /\(due 2026-10-03 18:00\)/);
});
