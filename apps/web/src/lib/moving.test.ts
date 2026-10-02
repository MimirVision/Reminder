import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMoveTodos, MOVE_ITEMS, MOVE_GROUPS } from './moving.ts';

test('every item has both languages, a known group and a unique key', () => {
  const keys = new Set<string>();
  for (const i of MOVE_ITEMS) {
    assert.ok(i.en.length > 3 && i.nb.length > 3 && MOVE_GROUPS.includes(i.group), i.key);
    assert.ok(!keys.has(i.key), `duplicate ${i.key}`);
    keys.add(i.key);
  }
});

test('dates count from moving day and never land in the past', () => {
  const r = buildMoveTodos(['folkereg', 'help', 'keys'], '2026-11-10', 'en', '2026-10-05');
  assert.deepEqual(r.map((x) => [x.key, x.due_on]), [['help', '2026-10-06'], ['keys', '2026-11-10'], ['folkereg', '2026-11-11']]);
  assert.equal(buildMoveTodos(['help'], '2026-10-20', 'en', '2026-10-05')[0].due_on, '2026-10-05');
});

test('without a moving day there are no dates, and the text follows the language', () => {
  const r = buildMoveTodos(['folkereg'], null, 'nb', '2026-10-05');
  assert.equal(r[0].due_on, null);
  assert.match(r[0].body, /Folkeregisteret/);
  assert.deepEqual(buildMoveTodos(['nope'], null, 'en', '2026-10-05'), []);
});
