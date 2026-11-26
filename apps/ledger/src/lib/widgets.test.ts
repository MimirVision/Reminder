import { describe, expect, it } from 'vitest';
import {
  addWidget, canAdd, DEFAULT_LAYOUT, DEFAULT_WIDE_LAYOUT, fit, minWidth, moveTo, normalizeLayout, nudge, overlaps, removeWidget, resizeTo, rowsUsed, settle,
  SPEC, WIDE_COLS, WIDGETS, type WidgetItem,
} from './widgets';

const at = (list: WidgetItem[], id: string) => { const x = list.find((i) => i.id === id)!; return [x.x, x.y, x.w, x.h]; };
/** No two widgets overlap, none sticks out of the grid, and none has free space right above it. */
function sound(list: WidgetItem[], cols = 12) {
  for (const a of list) {
    expect(a.x).toBeGreaterThanOrEqual(0);
    expect(a.x + a.w).toBeLessThanOrEqual(cols);
    for (const b of list) if (a !== b) expect(overlaps(a, b), `${a.id} overlaps ${b.id}`).toBe(false);
    if (a.y > 0) expect(list.some((b) => b !== a && overlaps({ ...a, y: a.y - 1 }, b)), `${a.id} could rise`).toBe(true);
  }
}

describe('home layout', () => {
  it('starts with a layout that fills its rows', () => {
    expect(normalizeLayout(undefined)).toEqual(DEFAULT_LAYOUT);
    expect(normalizeLayout('nonsense')).toEqual(DEFAULT_LAYOUT);
    sound(DEFAULT_LAYOUT);
    expect(at(DEFAULT_LAYOUT, 'today')).toEqual([0, 4, 8, 6]);
    expect(at(DEFAULT_LAYOUT, 'agenda')).toEqual([8, 4, 4, 6]);
    expect(at(DEFAULT_LAYOUT, 'workload')).toEqual([8, 16, 4, 4]);
  });

  it('keeps an empty layout empty: removing everything is a choice', () => {
    expect(normalizeLayout([])).toEqual([]);
  });

  it('drops unknown widgets and duplicates, clamps sizes, and settles overlaps', () => {
    const out = normalizeLayout([
      { id: 'a', type: 'today', x: 0, y: 0, w: 40, h: 1 },
      { id: 'a', type: 'week', x: 0, y: 0, w: 4, h: 4 },
      { id: 'b', type: 'teleporter', x: 0, y: 0, w: 4, h: 4 },
      { id: 'c', type: 'today', x: 0, y: 0, w: 6, h: 6 },
      null,
      { id: 'd', type: 'upcoming', x: 0, y: 0, w: 8, h: 6, days: 99 },
    ]);
    expect(out.map((x) => x.id)).toEqual(['a', 'd']);
    expect(at(out, 'a')).toEqual([0, 0, 12, SPEC.today.minH]);
    expect(at(out, 'd')).toEqual([0, SPEC.today.minH, 8, 6]);
    expect(out[1].days).toBe(14);
  });

  it('gives a layout saved before widgets had places a place in reading order, without holes', () => {
    // Half, third, half: the old flow left a hole after the third; packing fills it.
    const out = normalizeLayout([
      { id: 'a', type: 'today', w: 6, h: 4 }, { id: 'b', type: 'week', w: 4, h: 4 }, { id: 'c', type: 'overdue', w: 6, h: 4 }, { id: 'd', type: 'notes', w: 2, h: 4 },
    ]);
    expect(out.map((x) => [x.id, x.x, x.y])).toEqual([['a', 0, 0], ['b', 6, 0], ['c', 0, 4], ['d', 6, 4]]);
    sound(out);
  });

  it('removing a widget lets only the ones below it move up; nothing beside it shifts', () => {
    const after = removeWidget(DEFAULT_LAYOUT, 'deadlines');
    for (const it of after) if (it.id !== 'workload') expect(at(after, it.id)).toEqual(at(DEFAULT_LAYOUT, it.id));
    sound(after);
    const noAgenda = removeWidget(DEFAULT_LAYOUT, 'agenda');
    expect(at(noAgenda, 'today')).toEqual(at(DEFAULT_LAYOUT, 'today'));
    expect(at(noAgenda, 'waiting')[1]).toBe(4); // it rises into the space the agenda left
    expect(at(noAgenda, 'overdue')).toEqual(at(DEFAULT_LAYOUT, 'overdue'));
    sound(noAgenda);
  });

  it('moves a widget to where it is dropped, pushing what is there down', () => {
    const next = moveTo(DEFAULT_LAYOUT, 'week', 0, 4);
    expect(at(next, 'week')).toEqual([0, 4, 4, 4]);
    expect(at(next, 'today')).toEqual([0, 8, 8, 6]);
    expect(at(next, 'agenda')).toEqual(at(DEFAULT_LAYOUT, 'agenda'));
    sound(next);
    // Dropped below everything with nothing in between: it settles up against what is above.
    const low = moveTo(DEFAULT_LAYOUT, 'week', 0, 60);
    expect(at(low, 'week')[1]).toBe(rowsUsed(removeWidget(DEFAULT_LAYOUT, 'week').filter((x) => x.x < 4)));
    sound(low);
  });

  it('resizes in place and makes room', () => {
    const next = resizeTo(DEFAULT_LAYOUT, 'today', 12, 6);
    expect(at(next, 'today')).toEqual([0, 4, 12, 6]);
    expect(at(next, 'agenda')[1]).toBeGreaterThanOrEqual(10);
    sound(next);
    expect(at(resizeTo(DEFAULT_LAYOUT, 'week', 1, 99), 'week')).toEqual([0, 16, SPEC.week.minW, SPEC.week.maxH]);
  });

  it('steps with the keyboard: sideways by a column, up and down past the neighbour', () => {
    expect(at(nudge(DEFAULT_LAYOUT, 'deadlines', -1, 0), 'deadlines')).toEqual([3, 16, 4, 4]);
    const up = nudge(DEFAULT_LAYOUT, 'week', 0, -1);
    expect(at(up, 'week')[1]).toBeLessThan(16);
    sound(up);
    const down = nudge(up, 'week', 0, 1);
    expect(at(down, 'week')[1]).toBeGreaterThan(at(up, 'week')[1]);
    expect(nudge(DEFAULT_LAYOUT, 'greeting', 0, -1)).toBe(DEFAULT_LAYOUT);
  });

  it('adds a widget in the first free space big enough, else at the bottom', () => {
    const gap = removeWidget(DEFAULT_LAYOUT, 'week');
    expect(at(addWidget(gap, 'notes'), 'notes')).toEqual([0, 16, 4, 4]);
    expect(at(addWidget(DEFAULT_LAYOUT, 'notes'), 'notes')).toEqual([0, 20, 4, 4]);
    expect(canAdd(DEFAULT_LAYOUT, 'today')).toBe(false);
    expect(addWidget(DEFAULT_LAYOUT, 'today')).toBe(DEFAULT_LAYOUT);
    const twice = addWidget(addWidget(DEFAULT_LAYOUT, 'upcoming'), 'upcoming');
    expect(twice.filter((x) => x.type === 'upcoming').map((x) => x.id)).toEqual(['upcoming', 'upcoming-2']);
    sound(twice);
  });

  it('fits sizes to each widget’s limits', () => {
    const it = DEFAULT_LAYOUT.find((x) => x.type === 'week')!;
    expect(fit(it, 1, 99)).toMatchObject({ w: SPEC.week.minW, h: SPEC.week.maxH });
    expect(fit({ ...it, x: 10 }, 6, 4).x).toBe(6); // widened at the right edge: it moves left to stay inside
  });

  it('survives random editing without overlaps or holes', () => {
    let list = DEFAULT_LAYOUT;
    let seed = 7;
    const rnd = (n: number) => { seed = (seed * 16807) % 2147483647; return seed % n; };
    for (let i = 0; i < 300; i++) {
      const id = list[rnd(list.length)]?.id;
      const op = rnd(5);
      if (!id) break;
      if (op === 0) list = moveTo(list, id, rnd(14) - 1, rnd(30));
      else if (op === 1) list = resizeTo(list, id, rnd(13), rnd(10));
      else if (op === 2) list = nudge(list, id, rnd(3) - 1, rnd(3) - 1);
      else if (op === 3 && list.length > 4) list = removeWidget(list, id);
      else list = addWidget(list, WIDGETS[rnd(WIDGETS.length)].type);
      sound(list);
    }
  });

  it('describes every widget with sizes inside the grid', () => {
    for (const w of WIDGETS) {
      expect(w.minW).toBeLessThanOrEqual(w.w);
      expect(w.w).toBeLessThanOrEqual(12);
      expect(w.minH).toBeLessThanOrEqual(w.h);
      expect(w.h).toBeLessThanOrEqual(w.maxH);
    }
  });
});

describe('wide-screen layout', () => {
  it('has its own default on 24 columns, every row filled', () => {
    expect(normalizeLayout(undefined, WIDE_COLS)).toEqual(DEFAULT_WIDE_LAYOUT);
    // Every widget keeps the width it was given (none is forced wider by its minimum), in five bands.
    for (const x of DEFAULT_WIDE_LAYOUT) expect(x.w, x.id).toBeGreaterThanOrEqual(minWidth(x.type, WIDE_COLS));
    expect([...new Set(DEFAULT_WIDE_LAYOUT.map((x) => x.y))]).toEqual([0, 2, 8, 13, 18]);
    sound(DEFAULT_WIDE_LAYOUT, WIDE_COLS);
    const rows = new Map<number, number>();
    for (const x of DEFAULT_WIDE_LAYOUT) rows.set(x.y, (rows.get(x.y) ?? 0) + x.w);
    expect([...rows.values()].every((w) => w === WIDE_COLS)).toBe(true);
  });

  it('scales sizes to the grid it is on', () => {
    expect(minWidth('today', WIDE_COLS)).toBe(SPEC.today.minW * 2 - 2);
    expect(minWidth('agenda', WIDE_COLS)).toBe(4);
    expect(fit({ id: 'a', type: 'today', x: 0, y: 0, w: 40, h: 6 }, 40, 6, WIDE_COLS).w).toBe(24);
    expect(addWidget([], 'workload', WIDE_COLS)[0].w).toBe(SPEC.workload.w * 2);
    expect(normalizeLayout([{ id: 'x', type: 'heatmap', w: 0, h: 0 }], WIDE_COLS)[0]).toMatchObject({ x: 0, y: 0, w: 16, h: SPEC.heatmap.h });
    expect(fit({ id: 'a', type: 'agenda', x: 0, y: 0, w: 4, h: 6 }, 4, 6, WIDE_COLS).w).toBe(4);
  });

  it('settles the wide layout the user had, with its holes, into a solid one', () => {
    const holey = [
      { id: 'greeting', type: 'greeting', w: 10, h: 2 }, { id: 'quickAdd', type: 'quickAdd', w: 10, h: 2 }, { id: 'stats', type: 'stats', w: 8, h: 2 },
      { id: 'today', type: 'today', w: 8, h: 6 }, { id: 'agenda', type: 'agenda', w: 6, h: 6 }, { id: 'waiting', type: 'waiting', w: 8, h: 5 },
    ];
    const out = normalizeLayout(holey, WIDE_COLS);
    sound(out, WIDE_COLS);
    expect(settle(out, WIDE_COLS)).toEqual(out);
  });
});
