import test from 'node:test';
import assert from 'node:assert/strict';
import { bottom, clampItem, compact, COLS, defaultLayout, hidePanel, normalizeLayout, overlaps, place, PANELS, showPanel, type Item } from './dashLayout.ts';

const noOverlap = (items: Item[]) => items.every((a, i) => items.every((b, j) => i === j || !overlaps(a, b)));

test('the default layout has every panel and nothing overlaps', () => {
  const l = defaultLayout();
  assert.deepEqual(l.items.map((i) => i.id).sort(), [...PANELS].sort());
  assert.ok(noOverlap(l.items));
  assert.ok(l.items.every((i) => i.x + i.w <= COLS));
});

test('moving a panel onto another pushes that one down, and nothing overlaps', () => {
  const l = defaultLayout();
  const next = place(l.items, { id: 'weather', x: 6, y: 0, w: 6, h: 12 }); // onto the week board
  assert.ok(noOverlap(next));
  const week = next.find((i) => i.id === 'week') as Item;
  assert.ok(week.y >= 12, 'week was pushed below');
  assert.deepEqual(next.map((i) => i.id), l.items.map((i) => i.id), 'order of the list is kept');
});

test('random moves and resizes never leave an overlap or leave the grid', () => {
  let items = defaultLayout().items;
  let seed = 7;
  const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  for (let k = 0; k < 300; k++) {
    const id = PANELS[rnd(PANELS.length)];
    items = place(items, { id, x: rnd(30) - 3, y: rnd(40) - 3, w: 1 + rnd(26), h: 1 + rnd(20) });
    assert.ok(noOverlap(items), `overlap after step ${k}`);
    assert.ok(items.every((i) => i.x >= 0 && i.y >= 0 && i.x + i.w <= COLS));
  }
});

test('a panel never gets smaller than its minimum or wider than the grid', () => {
  const c = clampItem({ id: 'cal', x: 22, y: -2, w: 1, h: 1 });
  assert.deepEqual(c, { id: 'cal', x: 19, y: 0, w: 5, h: 9 });
  assert.equal(clampItem({ id: 'week', x: 0, y: 0, w: 99, h: 8 }).w, COLS);
});

test('tidy up slides panels up without overlap', () => {
  const t = compact([{ id: 'today', x: 0, y: 10, w: 6, h: 6 }, { id: 'week', x: 0, y: 30, w: 6, h: 6 }, { id: 'map', x: 8, y: 5, w: 6, h: 6 }]);
  assert.deepEqual(t.map((i) => i.y), [0, 6, 0]);
});

test('hiding and showing a panel', () => {
  const l = hidePanel(defaultLayout(), 'map');
  assert.equal(l.items.some((i) => i.id === 'map'), false);
  assert.deepEqual(l.hidden, ['map']);
  const back = showPanel(l, 'map');
  assert.deepEqual(back.items.find((i) => i.id === 'map'), { id: 'map', x: 18, y: 0, w: 6, h: 16 }, 'returns to its place when that is free');
  assert.deepEqual(back.hidden, []);
  const crowded = showPanel(hidePanel(defaultLayout(), 'map'), 'map'); // free again
  assert.ok(noOverlap(crowded.items));
  const blocked = showPanel({ items: [{ id: 'week', x: 0, y: 0, w: 24, h: 10 }], hidden: ['map'] }, 'map');
  assert.equal((blocked.items.find((i) => i.id === 'map') as Item).y, 10, 'goes below when its place is taken');
});

test('a saved layout is made safe', () => {
  assert.deepEqual(normalizeLayout(null), defaultLayout());
  assert.deepEqual(normalizeLayout('nope'), defaultLayout());
  const l = normalizeLayout({ items: [{ id: 'today', x: -5, y: 0, w: 2, h: 2 }, { id: 'ghost', x: 0, y: 0, w: 4, h: 4 }, { id: 'today', x: 3, y: 3, w: 6, h: 6 }, { id: 'week', x: 'a', y: 0, w: 4, h: 4 }], hidden: ['map', 'zzz'] });
  assert.ok(noOverlap(l.items));
  assert.deepEqual(l.hidden, ['map']);
  assert.ok(!l.items.some((i) => i.id === 'ghost' || i.id === 'map'));
  assert.deepEqual(l.items.find((i) => i.id === 'today'), { id: 'today', x: 0, y: 0, w: 4, h: 6 });
  for (const id of PANELS) if (id !== 'map') assert.ok(l.items.some((i) => i.id === id), `${id} is shown`);
  assert.ok(bottom(l.items) > 0);
});
