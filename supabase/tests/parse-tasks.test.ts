import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUserMessage, parseTasksWith, SCHEMA, validate, type PlaceInfo } from '../functions/parse-tasks/logic.ts';

const places: PlaceInfo[] = [
  { id: 'p-work', name: 'Jobb', kind: 'fixed', category: null },
  { id: 'p-ph', name: 'Any pharmacy', kind: 'category', category: 'pharmacy' },
];
const today = '2026-10-01';
const t = (o: object) => ({ title: 'x', place_id: '', category: 'none', due_on: '', due_time: '', repeat: 'none', assignee: 'none', leaving: false, ...o });

test('a good answer becomes safe to-dos', () => {
  const r = validate({ tasks: [t({ title: ' Pick up parcel ', place_id: 'p-work', leaving: true }), t({ title: 'Do taxes', due_on: '2026-10-01', due_time: '21:00', assignee: 'partner' })] }, places, today);
  assert.deepEqual(r[0], { title: 'Pick up parcel', due_on: null, due_time: null, repeat_rule: null, placeId: 'p-work', category: null, leaving: true, assignee: null });
  assert.deepEqual([r[1].due_on, r[1].due_time, r[1].assignee], ['2026-10-01', '21:00', 'partner']);
});

test('unknown ids, categories, dates and times are dropped, not trusted', () => {
  const [r] = validate({ tasks: [t({ place_id: 'made-up', category: 'casino', due_on: '2026-02-30', due_time: '25:99', repeat: 'hourly', assignee: 'boss', leaving: true })] }, places, today);
  assert.deepEqual([r.placeId, r.category, r.due_on, r.due_time, r.repeat_rule, r.assignee, r.leaving], [null, null, null, null, null, null, false]);
});

test('a category is kept only when no saved place was chosen; repeat and time need a date', () => {
  assert.equal(validate({ tasks: [t({ category: 'hardware' })] }, places, today)[0].category, 'hardware');
  assert.equal(validate({ tasks: [t({ category: 'hardware', place_id: 'p-ph' })] }, places, today)[0].category, null);
  const r = validate({ tasks: [t({ repeat: 'weekly', due_time: '10:00' })] }, places, today)[0];
  assert.deepEqual([r.repeat_rule, r.due_time], [null, null]);
});

test('dates far in the past are ignored; empty titles and junk are skipped; at most 15', () => {
  assert.equal(validate({ tasks: [t({ due_on: '2020-01-01' })] }, places, today)[0].due_on, null);
  assert.deepEqual(validate({ tasks: [t({ title: '  ' }), null, 'x', 3] }, places, today), []);
  for (const junk of [null, 'x', {}, { tasks: 'no' }]) assert.deepEqual(validate(junk, places, today), []);
  assert.equal(validate({ tasks: Array.from({ length: 40 }, () => t({})) }, places, today).length, 15);
});

test('parseTasksWith: fake model, bad JSON and refusals give an empty list', async () => {
  const ok = await parseTasksWith('hei', { today, weekday: 'Thursday', lang: 'nb', partner: null, places }, async () => JSON.stringify({ tasks: [t({ title: 'Ring' })] }));
  assert.equal(ok.length, 1);
  assert.deepEqual(await parseTasksWith('hei', { today, weekday: 'Thursday', lang: 'en', partner: null, places }, async () => 'not json'), []);
  assert.deepEqual(await parseTasksWith('hei', { today, weekday: 'Thursday', lang: 'en', partner: null, places }, async () => null), []);
  assert.deepEqual(await parseTasksWith('   ', { today, weekday: 'Thursday', lang: 'en', partner: null, places }, async () => { throw new Error('no call'); }), []);
});

test('the prompt carries today, the places and the partner; the schema matches validate', () => {
  const m = buildUserMessage('hi', { today, weekday: 'Thursday', lang: 'nb', partner: 'Kari', places });
  assert.match(m, /2026-10-01 \(Thursday\)/);
  assert.match(m, /Norwegian/);
  assert.match(m, /Kari/);
  assert.match(m, /id=p-work/);
  assert.deepEqual([...SCHEMA.properties.tasks.items.required].sort(), ['assignee', 'category', 'due_on', 'due_time', 'leaving', 'place_id', 'repeat', 'title']);
});
