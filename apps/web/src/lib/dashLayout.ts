/** The overview board's layout: panels on a 24-column grid, each with a position and a size in grid cells. */
export const COLS = 24;
export type Item = { id: string; x: number; y: number; w: number; h: number };
export type Layout = { items: Item[]; hidden: string[] };

export const PANELS = ['today', 'week', 'map', 'weather', 'cal', 'places', 'activity'] as const;
export type PanelId = (typeof PANELS)[number];

export const MIN: Record<string, { w: number; h: number }> = {
  today: { w: 4, h: 6 }, week: { w: 6, h: 6 }, map: { w: 4, h: 6 }, weather: { w: 4, h: 5 }, cal: { w: 5, h: 9 }, places: { w: 4, h: 5 }, activity: { w: 3, h: 4 },
};

export const DEFAULT_ITEMS: Item[] = [
  { id: 'today', x: 0, y: 0, w: 6, h: 16 }, { id: 'week', x: 6, y: 0, w: 12, h: 16 }, { id: 'map', x: 18, y: 0, w: 6, h: 16 },
  { id: 'weather', x: 0, y: 16, w: 6, h: 12 }, { id: 'cal', x: 6, y: 16, w: 6, h: 12 }, { id: 'places', x: 12, y: 16, w: 6, h: 12 }, { id: 'activity', x: 18, y: 16, w: 6, h: 12 },
];
export const defaultLayout = (): Layout => ({ items: DEFAULT_ITEMS.map((i) => ({ ...i })), hidden: [] });

export const overlaps = (a: Item, b: Item): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
export const bottom = (items: Item[]): number => items.reduce((m, i) => Math.max(m, i.y + i.h), 0);

const int = (n: number) => Math.round(Number.isFinite(n) ? n : 0);

/** Keep an item on the grid and at least its minimum size. */
export function clampItem(it: Item): Item {
  const min = MIN[it.id] ?? { w: 3, h: 4 };
  const w = Math.min(COLS, Math.max(min.w, int(it.w)));
  const h = Math.max(min.h, int(it.h));
  return { id: it.id, w, h, x: Math.min(COLS - w, Math.max(0, int(it.x))), y: Math.max(0, int(it.y)) };
}

/** Put `moved` where it says and push whatever it lands on down, so nothing overlaps. The other panels keep their order in the list. */
export function place(items: Item[], moved: Item): Item[] {
  const m = clampItem(moved);
  const rest = items.filter((i) => i.id !== m.id).map((i) => ({ ...i }));
  const order = [...rest].sort((a, b) => a.y - b.y || a.x - b.x);
  const fixed: Item[] = [m];
  for (const it of order) {
    for (let again = true; again;) {
      again = false;
      for (const f of fixed) if (overlaps(it, f)) { it.y = f.y + f.h; again = true; }
    }
    fixed.push(it);
  }
  const by = new Map(fixed.map((i) => [i.id, i]));
  return [...items.map((i) => by.get(i.id) as Item), ...(items.some((i) => i.id === m.id) ? [] : [m])];
}

/** Slide every panel up as far as it will go ("tidy up"). */
export function compact(items: Item[]): Item[] {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x).map((i) => ({ ...i }));
  const done: Item[] = [];
  for (const it of sorted) {
    while (it.y > 0 && !done.some((d) => overlaps({ ...it, y: it.y - 1 }, d))) it.y -= 1;
    done.push(it);
  }
  const by = new Map(done.map((i) => [i.id, i]));
  return items.map((i) => by.get(i.id) as Item);
}

/** Show a hidden panel again: back where it was by default if that is free, otherwise below everything. */
export function showPanel(layout: Layout, id: string): Layout {
  if (layout.items.some((i) => i.id === id)) return layout;
  const d = DEFAULT_ITEMS.find((i) => i.id === id) ?? { id, x: 0, y: 0, w: 6, h: 10 };
  const free = !layout.items.some((i) => overlaps(i, d));
  const item = free ? { ...d } : { ...d, x: 0, y: bottom(layout.items) };
  return { items: place([...layout.items, item], item), hidden: layout.hidden.filter((h) => h !== id) };
}

export function hidePanel(layout: Layout, id: string): Layout {
  return { items: layout.items.filter((i) => i.id !== id), hidden: layout.hidden.includes(id) ? layout.hidden : [...layout.hidden, id] };
}

/** Whatever was saved, made safe: unknown panels dropped, sizes fixed, overlaps resolved, panels added since then shown at the bottom. */
export function normalizeLayout(raw: unknown): Layout {
  const r = raw as { items?: unknown; hidden?: unknown } | null;
  if (!r || !Array.isArray(r.items)) return defaultLayout();
  const known = new Set<string>(PANELS);
  const hidden = Array.isArray(r.hidden) ? [...new Set(r.hidden.filter((h): h is string => typeof h === 'string' && known.has(h)))] : [];
  let items: Item[] = [];
  for (const x of r.items as Partial<Item>[]) {
    if (!x || typeof x.id !== 'string' || !known.has(x.id) || hidden.includes(x.id) || items.some((i) => i.id === x.id)) continue;
    if (![x.x, x.y, x.w, x.h].every((n) => typeof n === 'number')) continue;
    items = place(items.length ? items : [], clampItem(x as Item));
  }
  const seen = new Set([...items.map((i) => i.id), ...hidden]);
  let layout: Layout = { items, hidden };
  for (const id of PANELS) if (!seen.has(id)) layout = showPanel(layout, id);
  return layout;
}
