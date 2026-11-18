import { describe, expect, it } from 'vitest';
import { addWidget, canAdd, DEFAULT_LAYOUT, DEFAULT_WIDE_LAYOUT, fit, minWidth, moveWidget, normalizeLayout, SPEC, WIDE_COLS, WIDGETS } from './widgets';

describe('home layout', () => {
  it('falls back to the default layout when nothing is stored', () => {
    expect(normalizeLayout(undefined)).toEqual(DEFAULT_LAYOUT);
    expect(normalizeLayout('nonsense')).toEqual(DEFAULT_LAYOUT);
  });

  it('keeps an empty layout empty: removing everything is a choice', () => {
    expect(normalizeLayout([])).toEqual([]);
  });

  it('drops unknown widgets and duplicates, and clamps sizes', () => {
    const out = normalizeLayout([
      { id: 'a', type: 'today', w: 40, h: 1 },
      { id: 'a', type: 'week', w: 4, h: 4 },
      { id: 'b', type: 'teleporter', w: 4, h: 4 },
      { id: 'c', type: 'today', w: 6, h: 6 },
      null,
      { id: 'd', type: 'upcoming', w: 8, h: 6, days: 99 },
    ]);
    expect(out.map((x) => x.id)).toEqual(['a', 'd']);
    expect(out[0]).toMatchObject({ w: 12, h: SPEC.today.minH });
    expect(out[1].days).toBe(14);
  });

  it('moves a widget to a new position', () => {
    const ids = moveWidget(DEFAULT_LAYOUT, 0, 3).map((x) => x.id);
    expect(ids.slice(0, 4)).toEqual(['quickAdd', 'today', 'agenda', 'greeting']);
    expect(moveWidget(DEFAULT_LAYOUT, 2, 2)).toBe(DEFAULT_LAYOUT);
  });

  it('fits sizes to each widget’s limits', () => {
    const it = DEFAULT_LAYOUT.find((x) => x.type === 'week')!;
    expect(fit(it, 1, 99)).toMatchObject({ w: SPEC.week.minW, h: SPEC.week.maxH });
  });

  it('adds single widgets once, and repeatable ones with fresh ids', () => {
    expect(canAdd(DEFAULT_LAYOUT, 'today')).toBe(false);
    expect(addWidget(DEFAULT_LAYOUT, 'today')).toBe(DEFAULT_LAYOUT);
    const twice = addWidget(addWidget(DEFAULT_LAYOUT, 'upcoming'), 'upcoming');
    expect(twice.filter((x) => x.type === 'upcoming').map((x) => x.id)).toEqual(['upcoming', 'upcoming-2']);
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
    const wide = normalizeLayout(undefined, WIDE_COLS);
    expect(wide).toEqual(DEFAULT_WIDE_LAYOUT);
    expect(wide.reduce((n, x) => n + x.w, 0) % WIDE_COLS).toBe(0);
  });

  it('scales sizes to the grid it is on', () => {
    expect(minWidth('today', WIDE_COLS)).toBe(SPEC.today.minW * 2);
    expect(fit({ id: 'a', type: 'today', w: 40, h: 6 }, 40, 6, WIDE_COLS).w).toBe(24);
    expect(addWidget([], 'workload', WIDE_COLS)[0].w).toBe(SPEC.workload.w * 2);
    expect(normalizeLayout([{ id: 'x', type: 'heatmap', w: 0, h: 0 }], WIDE_COLS)[0]).toMatchObject({ w: 16, h: SPEC.heatmap.h });
  });
});
