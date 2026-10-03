import test from 'node:test';
import assert from 'node:assert/strict';
import { addItem, addMany, cleanChecklist, progress, removeItem, renameItem, toggleItem } from './checklist.ts';

test('add, tick, rename and remove', () => {
  let l = addItem([], '  tent ');
  l = addItem(l, '');
  assert.deepEqual(l.map((i) => i.text), ['tent']);
  l = addMany(l, 'stove, sleeping bags\nlamp');
  assert.deepEqual(l.map((i) => i.text), ['tent', 'stove', 'sleeping bags', 'lamp']);
  l = toggleItem(l, l[1].id);
  assert.deepEqual(progress(l), { done: 1, total: 4 });
  l = renameItem(l, l[0].id, 'big tent');
  assert.equal(l[0].text, 'big tent');
  l = renameItem(l, l[0].id, '   ');
  assert.equal(l.length, 3, 'an emptied item disappears');
  l = removeItem(l, l[0].id);
  assert.equal(l.length, 2);
});

test('bad data from the database becomes an empty or clean list', () => {
  assert.deepEqual(cleanChecklist(null), []);
  assert.deepEqual(cleanChecklist({ a: 1 }), []);
  assert.deepEqual(cleanChecklist([{ id: 'a', text: 'x', done: false }, { id: 3 }, null, 'x']), [{ id: 'a', text: 'x', done: false }]);
  assert.deepEqual(progress(undefined), { done: 0, total: 0 });
});

test('a list stops at 100 items', () => {
  const l = addMany([], Array.from({ length: 150 }, (_, i) => `item ${i}`).join('\n'));
  assert.equal(l.length, 100);
});
