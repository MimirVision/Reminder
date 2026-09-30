import test from 'node:test';
import assert from 'node:assert/strict';
import { clean, SCHEMA, system } from '../functions/read-label/logic.ts';

const ok = { readable: true, title: 'Bedroom paint (Jotun Lady)', value: 'NCS S0502-Y\nMatt', category: 'paint', surface_at: ['paint'] };

test('a readable label becomes a fact', () => {
  assert.deepEqual(clean(ok), { title: 'Bedroom paint (Jotun Lady)', value: 'NCS S0502-Y\nMatt', category: 'paint', surface_at: ['paint'] });
});

test('unreadable photos and junk give nothing', () => {
  for (const junk of [null, 'x', 3, {}, { ...ok, readable: false }, { ...ok, title: '   ' }, { ...ok, readable: 'yes' }]) assert.equal(clean(junk), null);
});

test('enums and sizes are enforced', () => {
  const r = clean({ ...ok, category: 'weapons', surface_at: ['paint', 'paint', 'casino', 5], title: 't'.repeat(500), value: 'v'.repeat(5000) });
  assert.equal(r?.category, 'other');
  assert.deepEqual(r?.surface_at, ['paint']);
  assert.equal(r?.title.length, 120);
  assert.equal(r?.value.length, 800);
});

test('the prompt is in the reader language and the schema matches what clean expects', () => {
  assert.match(system('nb'), /Norwegian/);
  assert.match(system('en'), /English/);
  assert.deepEqual([...SCHEMA.required].sort(), ['category', 'readable', 'surface_at', 'title', 'value']);
});
