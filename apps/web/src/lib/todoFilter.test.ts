import test from 'node:test';
import assert from 'node:assert/strict';
import { activeCount, applyFilter, noFilter } from './todoFilter.ts';

const m = (id: string, o: object = {}) => ({ id, assignee_id: null as string | null, priority: 0 as 0 | 1 | 2 | 3, tags: [] as string[], ...o });
const list = [m('any'), m('me', { assignee_id: 'u1', priority: 2 }), m('her', { assignee_id: 'u2', tags: ['kids'] }), m('hi', { priority: 3, tags: ['work', 'kids'] })];
const ids = (l: { id: string }[]) => l.map((x) => x.id);

test('no filter keeps everything', () => { assert.equal(activeCount(noFilter()), 0); assert.equal(applyFilter(list, noFilter(), 'u1', 'u2'), list); });
test('for me keeps mine and anyone\'s', () => assert.deepEqual(ids(applyFilter(list, { ...noFilter(), who: 'mine' }, 'u1', 'u2')), ['any', 'me', 'hi']));
test('for partner', () => assert.deepEqual(ids(applyFilter(list, { ...noFilter(), who: 'theirs' }, 'u1', 'u2')), ['any', 'her', 'hi']));
test('person filter is ignored with no partner', () => assert.equal(applyFilter(list, { ...noFilter(), who: 'theirs' }, 'u1', null).length, 4));
test('minimum priority', () => assert.deepEqual(ids(applyFilter(list, { ...noFilter(), minPriority: 2 }, 'u1', 'u2')), ['me', 'hi']));
test('tag, combined with the others', () => {
  assert.deepEqual(ids(applyFilter(list, { ...noFilter(), tag: 'kids' }, 'u1', 'u2')), ['her', 'hi']);
  const f = { who: 'mine' as const, minPriority: 3 as const, tag: 'kids' };
  assert.equal(activeCount(f), 3);
  assert.deepEqual(ids(applyFilter(list, f, 'u1', 'u2')), ['hi']);
});
