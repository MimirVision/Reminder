import test from 'node:test';
import assert from 'node:assert/strict';
import { matchTodos } from './search.ts';

const todos = [
  { id: 1, body: 'Buy plasters and tape', place_id: 'p1' },
  { id: 2, body: 'Café gift card', place_id: null },
  { id: 3, body: 'Call the plumber', place_id: null, due_on: '2026-10-02' },
  { id: 4, body: 'Paint samples', place_id: 'p2' },
];
const place = (id: string | null) => ({ p1: 'Vitus Apotek', p2: 'Byggmax' } as Record<string, string>)[id ?? ''];

test('every word must match; case and accents are ignored', () => {
  assert.deepEqual(matchTodos(todos, 'plasters tape', place).map((m) => m.id), [1]);
  assert.deepEqual(matchTodos(todos, 'PLASTERS', place).map((m) => m.id), [1]);
  assert.deepEqual(matchTodos(todos, 'cafe', place).map((m) => m.id), [2]);
  assert.deepEqual(matchTodos(todos, 'plasters plumber', place), []);
});

test('the place name and the date words count too', () => {
  assert.deepEqual(matchTodos(todos, 'apotek', place).map((m) => m.id), [1]);
  assert.deepEqual(matchTodos(todos, 'byggmax paint', place).map((m) => m.id), [4]);
  assert.deepEqual(matchTodos(todos, 'friday', place, (m) => (m.due_on ? 'Friday' : '')).map((m) => m.id), [3]);
});

test('an empty search matches nothing (the normal list shows instead)', () => {
  assert.deepEqual(matchTodos(todos, '   ', place), []);
});
