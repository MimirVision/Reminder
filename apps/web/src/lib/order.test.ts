import test from 'node:test';
import assert from 'node:assert/strict';
import { moveStep } from './order.ts';
import { agendaFor, countsByDay } from './agenda.ts';

test('moving down numbers the group and returns what changed', () => {
  const r = moveStep([{ id: 'a' }, { id: 'b' }, { id: 'c' }], 'a', 1)!;
  assert.deepEqual(r, [{ id: 'b', sort_order: 1024 }, { id: 'a', sort_order: 2048 }, { id: 'c', sort_order: 3072 }]);
});
test('only the changed ones are returned once numbered', () => {
  const r = moveStep([{ id: 'a', sort_order: 1024 }, { id: 'b', sort_order: 2048 }, { id: 'c', sort_order: 3072 }], 'c', -1)!;
  assert.deepEqual(r, [{ id: 'c', sort_order: 2048 }, { id: 'b', sort_order: 3072 }]);
});
test('the ends do not move further', () => {
  assert.equal(moveStep([{ id: 'a' }, { id: 'b' }], 'a', -1), null);
  assert.equal(moveStep([{ id: 'a' }, { id: 'b' }], 'b', 1), null);
  assert.equal(moveStep([{ id: 'a' }], 'zz', 1), null);
});

const d = (o: object) => ({ due_on: null as string | null, due_time: null as string | null, pinned: false, priority: 0 as 0 | 1 | 2 | 3, ...o });
test('counts per day with the highest priority', () => {
  const c = countsByDay([d({ due_on: '2026-10-05', priority: 1 }), d({ due_on: '2026-10-05', priority: 3 }), d({ due_on: '2026-10-06' }), d({})]);
  assert.deepEqual([...c], [['2026-10-05', { count: 2, top: 3 }], ['2026-10-06', { count: 1, top: 0 }]]);
});
test('a day\'s agenda: by time first', () => {
  const l = [d({ id: 'x', due_on: '2026-10-05' }), d({ id: 'late', due_on: '2026-10-05', due_time: '18:00' }), d({ id: 'early', due_on: '2026-10-05', due_time: '08:00' }), d({ id: 'other', due_on: '2026-10-06' })];
  assert.deepEqual(agendaFor(l, '2026-10-05').map((x) => (x as { id: string }).id), ['early', 'late', 'x']);
});
