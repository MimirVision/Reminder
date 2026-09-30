import test from 'node:test';
import assert from 'node:assert/strict';
import { dictionaries, makeT } from '../i18n/core.ts';
import houseNb from '../i18n/houseTasks.nb.json' with { type: 'json' };
import { categoryName, placeLabel, recurringLabel, scheduleLabel, taskNotes, taskTitle } from './labels.ts';

const en = makeT('en');
const nb = makeT('nb');

test('category places are shown in the reader\'s language, specific places keep their name', () => {
  const cat = { name: 'Any pharmacy (apotek)', kind: 'category', category: 'pharmacy' };
  assert.equal(placeLabel(cat, en), 'Any pharmacy (apotek)');
  assert.equal(placeLabel(cat, nb), 'Alle apotek');
  assert.equal(placeLabel({ name: 'IKEA Furuset', kind: 'fixed', category: 'hardware' }, nb), 'IKEA Furuset');
  assert.equal(placeLabel({ name: 'Odd', kind: 'category', category: 'unknown' }, nb), 'Odd');
  assert.equal(categoryName('paint', nb), 'Alle malingforretninger');
});

test('schedules read naturally in both languages', () => {
  const seasonal = { schedule: 'seasonal', window_start_month: 9, window_end_month: 10 };
  assert.equal(scheduleLabel(seasonal, en), 'every year, Sep–Oct');
  assert.equal(scheduleLabel(seasonal, nb), 'hvert år, sep–okt');
  assert.equal(scheduleLabel({ schedule: 'seasonal', window_start_month: 5, window_end_month: 5 }, en), 'every year, May');
  assert.equal(scheduleLabel({ schedule: 'interval', interval_months: 3 }, nb), 'hver 3. måned');
  assert.equal(scheduleLabel({ schedule: 'interval', interval_months: 12 }, nb), 'hvert år');
  assert.equal(scheduleLabel({ schedule: 'interval', interval_months: 24 }, en), 'every 2 years');
  assert.equal(scheduleLabel({ schedule: 'interval', interval_months: 1 }, en), 'every month');
  assert.equal(recurringLabel({ schedule: 'interval', interval_months: 6 }, nb), 'hver 6. måned');
  assert.equal(recurringLabel({ schedule: 'seasonal', window_start: 4, window_end: 5 }, en), 'every year, Apr–May');
});

test('the starter house calendar is translated, your own tasks are not touched', () => {
  const t = { template_key: 'gutters_autumn', title: 'Clean gutters and downpipes (takrenner)', notes: 'Before first frost.' };
  assert.equal(taskTitle(t, 'en'), t.title);
  assert.equal(taskTitle(t, 'nb'), 'Rens takrenner og nedløpsrør');
  assert.match(taskNotes(t, 'nb') ?? '', /frost/);
  assert.equal(taskTitle({ template_key: null, title: 'Oil the terrace' }, 'nb'), 'Oil the terrace');
  assert.equal(taskTitle({ template_key: 'made_up', title: 'X' }, 'nb'), 'X');
  assert.equal(taskNotes({ template_key: null, notes: null }, 'nb'), null);
});

test('every template key in the database migration has a Norwegian translation', async () => {
  const { readFileSync } = await import('node:fs');
  const sql = readFileSync(new URL('../../../../supabase/migrations/0003_maintenance.sql', import.meta.url), 'utf8');
  const keys = [...sql.matchAll(/\('([a-z_]+)',\s*(?:null|'has_[a-z_]+'),\s*'/g)].map((m) => m[1]);
  assert.ok(keys.length >= 20, `found ${keys.length} template keys`);
  for (const k of keys) {
    const tr = (houseNb as Record<string, { title: string; notes: string }>)[k];
    assert.ok(tr && tr.title && tr.notes, `missing Norwegian text for template task ${k}`);
  }
  assert.equal(Object.keys(houseNb).length, keys.length, 'no stale translations');
  void dictionaries;
});
