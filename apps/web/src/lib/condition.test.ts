import test from 'node:test';
import assert from 'node:assert/strict';
import { CONDITION_SEED } from './conditionSeed.ts';
import { costLabel, defaultFilter, filterItems, groupByArea, summarize, todoFromItem, todoPriority, type ConditionItem } from './condition.ts';

const asItems = (): ConditionItem[] => CONDITION_SEED.map((s, i) => ({
  id: `id${i}`, household_id: 'h', source: 's', source_key: s.key, area: s.area, part: s.part, tg: s.tg, when_kind: s.when, what: s.what, action: s.action,
  cost_min: s.cost_min ?? null, cost_max: s.cost_max ?? null, page: s.page ?? null, status: 'open', notes: null, memory_id: null, done_at: null, created_at: '2026-10-22',
}));

test('the report in the app has what the report has: 2 TG3, 22 TG2, 5 safety notes, 1 legality note', () => {
  const n = (tg: string) => CONDITION_SEED.filter((s) => s.tg === tg).length;
  assert.deepEqual([n('TG3'), n('TG2'), n('HMS'), n('LOV')], [2, 22, 5, 1]);
  assert.equal(new Set(CONDITION_SEED.map((s) => s.key)).size, CONDITION_SEED.length, 'keys are unique');
  for (const s of CONDITION_SEED) { assert.ok(s.part && s.what && s.action, s.key); assert.ok((s.page ?? 0) >= 49 && (s.page ?? 0) <= 64, `${s.key} page`); }
  assert.deepEqual(CONDITION_SEED.filter((s) => s.cost_min != null).map((s) => s.key), ['tomt-stottemur', 'vaatrom-vaskerom'], 'only the two TG3 items have the report\'s cost band');
});

test('filter: open only by default, by grade, by urgency, most serious first', () => {
  const items = asItems();
  const open = filterItems(items, defaultFilter());
  assert.equal(open.length, 30);
  assert.deepEqual(open.slice(0, 2).map((i) => i.tg), ['TG3', 'TG3']);
  assert.equal(filterItems(items, { ...defaultFilter(), tg: 'TG2' }).length, 22);
  assert.ok(filterItems(items, { ...defaultFilter(), when: 'now' }).every((i) => i.when_kind === 'now'));
  items[0].status = 'done';
  assert.equal(filterItems(items, defaultFilter()).length, 29);
  assert.equal(filterItems(items, { ...defaultFilter(), showDone: true }).length, 30);
});

test('grouping by part of the house keeps a fixed order and drops empty groups', () => {
  const g = groupByArea(asItems());
  assert.deepEqual(g.map((x) => x.area), ['plot', 'exterior', 'interior', 'wet', 'kitchen', 'technical', 'hms', 'legal']);
  assert.equal(g.reduce((n, x) => n + x.items.length, 0), 30);
  assert.deepEqual(groupByArea(asItems().filter((i) => i.area === 'wet')).map((x) => x.area), ['wet']);
});

test('summary counts open items per grade and adds up the report\'s cost bands', () => {
  const s = summarize(asItems());
  assert.deepEqual([s.byTg.TG3.open, s.byTg.TG2.open, s.byTg.HMS.open], [2, 22, 5]);
  assert.deepEqual(s.costOpen, { min: 40000, max: 200000 });
  const items = asItems(); items[0].status = 'done'; items[0].done_at = 'x';
  const s2 = summarize(items);
  assert.equal(s2.done, 1); assert.equal(s2.open, 29); assert.equal(s2.costOpen.max, 100000);
});

test('a to-do made from a finding', () => {
  const wall = asItems()[0];
  assert.equal(todoPriority(wall), 3);
  assert.equal(todoPriority({ tg: 'TG2', when_kind: 'plan' }), 2);
  assert.equal(todoPriority({ tg: 'TG2', when_kind: 'watch' }), 1);
  const t = todoFromItem(wall);
  assert.equal(t.body, 'Forstøtningsmurer (støttemur mot parkering)');
  assert.ok(t.notes.startsWith('TG3.') && t.notes.includes('Tiltak:') && t.notes.includes('20 000–100 000 kr'));
  assert.deepEqual(t.tags, ['tilstandsrapport', 'tg3']);
});

test('cost labels', () => {
  assert.equal(costLabel(20000, 100000), '20 000–100 000 kr');
  assert.equal(costLabel(null, null), '');
  assert.equal(costLabel(5000, 5000), '5 000 kr');
});
