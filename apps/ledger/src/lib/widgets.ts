// The Home dashboard: which widgets it shows, where, and how big. Each widget has a place on a grid (column x, row y)
// and a size (w columns, h rows). Widgets fall upward into free space, like a stack settling, so the dashboard has no
// holes; moving or resizing one pushes whatever is in its way down. Removing one only lets the widgets below it
// move up: nothing beside it shifts. Stored in the workspace settings, so it follows you between devices.
// Very wide screens (an ultrawide monitor) get a 24-column grid with a layout of their own: the same widgets side by
// side instead of stretched. Sizes in WIDGETS are in twelfths and scale to the grid.

export type WidgetType =
  | 'greeting' | 'quickAdd' | 'today' | 'overdue' | 'upcoming' | 'week' | 'waiting'
  | 'stats' | 'progress' | 'attention' | 'pinned' | 'activity' | 'notes' | 'deadlines' | 'calendar' | 'documents' | 'agenda'
  | 'workload' | 'heatmap' | 'pace' | 'ontime' | 'mix' | 'clients';

export interface WidgetItem {
  id: string;
  type: WidgetType;
  /** Column (0-based) and row of the top-left corner. */
  x: number;
  y: number;
  /** Columns out of the grid's (12, or 24 on a very wide screen). */
  w: number;
  /** Rows of ROW_PX. */
  h: number;
  /** Per-widget options, e.g. how many days ahead the upcoming list looks. */
  days?: number;
}

export interface WidgetSpec {
  type: WidgetType;
  name: string;
  description: string;
  w: number;
  h: number;
  minW: number;
  minH: number;
  maxH: number;
  /** Only one of these makes sense on a page. */
  single?: boolean;
}

export const COLS = 12;
/** The grid on a very wide screen. */
export const WIDE_COLS = 24;
/** The grid's width in pixels from which the wide grid is used. */
export const WIDE_FROM_PX = 2300;
export const ROW_PX = 56;
export const GAP_PX = 20;

export const WIDGETS: WidgetSpec[] = [
  { type: 'greeting', name: 'Greeting and summary', description: 'Today’s date, a one-line summary and your progress ring.', w: 12, h: 2, minW: 4, minH: 2, maxH: 4, single: true },
  { type: 'quickAdd', name: 'Quick add', description: 'Type a task in one line: “Chase receipts @client fri !high”.', w: 12, h: 2, minW: 4, minH: 2, maxH: 2, single: true },
  { type: 'today', name: 'Today', description: 'Everything due today, with what you have already finished.', w: 8, h: 6, minW: 4, minH: 3, maxH: 14, single: true },
  { type: 'overdue', name: 'Overdue', description: 'Open tasks past their due date, oldest first.', w: 8, h: 6, minW: 4, minH: 3, maxH: 14, single: true },
  { type: 'upcoming', name: 'Upcoming deadlines', description: 'The next 7, 14 or 30 days, grouped by day.', w: 8, h: 6, minW: 4, minH: 3, maxH: 14 },
  { type: 'week', name: 'This week', description: 'How many tasks fall on each of the next seven days.', w: 4, h: 4, minW: 3, minH: 3, maxH: 6, single: true },
  { type: 'waiting', name: 'Waiting on clients', description: 'Tasks waiting for a client, most overdue first.', w: 4, h: 4, minW: 3, minH: 3, maxH: 10, single: true },
  { type: 'stats', name: 'Key numbers', description: 'Open, overdue, due this week and done this week at a glance.', w: 12, h: 2, minW: 4, minH: 2, maxH: 3, single: true },
  { type: 'progress', name: 'Completed per week', description: 'Tasks finished in each of the last eight weeks, and how many on time.', w: 4, h: 4, minW: 3, minH: 3, maxH: 6, single: true },
  { type: 'attention', name: 'Clients needing attention', description: 'Clients ranked by overdue and open work.', w: 4, h: 5, minW: 3, minH: 3, maxH: 10, single: true },
  { type: 'pinned', name: 'Pinned clients', description: 'Your pinned clients with their open work and next deadline.', w: 4, h: 4, minW: 3, minH: 3, maxH: 10, single: true },
  { type: 'activity', name: 'Recent activity', description: 'What changed lately across all clients.', w: 4, h: 5, minW: 3, minH: 3, maxH: 12, single: true },
  { type: 'notes', name: 'Notepad', description: 'A scratchpad for the day. Saved as you type.', w: 4, h: 4, minW: 3, minH: 2, maxH: 10, single: true },
  { type: 'deadlines', name: 'Deadline radar', description: 'The next deadline for each kind of work: VAT, payroll, annual accounts…', w: 4, h: 4, minW: 3, minH: 3, maxH: 8, single: true },
  { type: 'agenda', name: 'Agenda', description: 'Today’s meetings by the hour, and the next ones coming up.', w: 4, h: 6, minW: 3, minH: 3, maxH: 12, single: true },
  { type: 'documents', name: 'Documents to collect', description: 'Everything you’ve requested from clients that hasn’t arrived yet, oldest first.', w: 4, h: 4, minW: 3, minH: 3, maxH: 10, single: true },
  { type: 'workload', name: 'Workload ahead', description: 'A chart of open tasks per week for the coming weeks, by type: see the busy weeks coming.', w: 8, h: 5, minW: 4, minH: 4, maxH: 9, single: true },
  { type: 'heatmap', name: 'Deadline calendar', description: 'Every day of the coming months, darker the more is due. Overdue days are marked.', w: 8, h: 4, minW: 4, minH: 3, maxH: 7, single: true },
  { type: 'pace', name: 'This month’s pace', description: 'A line chart of the month: due so far against done so far.', w: 4, h: 5, minW: 3, minH: 4, maxH: 8, single: true },
  { type: 'ontime', name: 'On time', description: 'The share of tasks finished by their due date, its trend, and the change from before.', w: 4, h: 3, minW: 3, minH: 3, maxH: 5, single: true },
  { type: 'mix', name: 'Open work by type', description: 'How your open work splits into bookkeeping, VAT, payroll, reporting and year-end.', w: 4, h: 5, minW: 3, minH: 4, maxH: 8, single: true },
  { type: 'clients', name: 'Busiest clients', description: 'Bars of each client’s work in the next 30 days, overdue marked.', w: 4, h: 5, minW: 3, minH: 3, maxH: 12, single: true },
  { type: 'calendar', name: 'Month at a glance', description: 'A small calendar with the busy days marked.', w: 4, h: 5, minW: 3, minH: 4, maxH: 7, single: true },
];

export const SPEC = Object.fromEntries(WIDGETS.map((w) => [w.type, w])) as Record<WidgetType, WidgetSpec>;

/** The start on a normal screen. Positions are worked out by `settle`. */
const START: Omit<WidgetItem, 'x' | 'y'>[] = [
  { id: 'greeting', type: 'greeting', w: 12, h: 2 },
  { id: 'quickAdd', type: 'quickAdd', w: 12, h: 2 },
  { id: 'today', type: 'today', w: 8, h: 6 },
  { id: 'agenda', type: 'agenda', w: 4, h: 6 },
  { id: 'overdue', type: 'overdue', w: 8, h: 6 },
  { id: 'waiting', type: 'waiting', w: 4, h: 6 },
  { id: 'week', type: 'week', w: 4, h: 4 },
  { id: 'deadlines', type: 'deadlines', w: 4, h: 4 },
  { id: 'workload', type: 'workload', w: 4, h: 4 },
];

/** The wide-screen start: three bands of four to five widgets, the charts in the middle. */
const START_WIDE: Omit<WidgetItem, 'x' | 'y'>[] = [
  { id: 'greeting', type: 'greeting', w: 8, h: 2 },
  { id: 'quickAdd', type: 'quickAdd', w: 8, h: 2 },
  { id: 'stats', type: 'stats', w: 8, h: 2 },
  { id: 'today', type: 'today', w: 8, h: 6 },
  { id: 'overdue', type: 'overdue', w: 8, h: 6 },
  { id: 'agenda', type: 'agenda', w: 4, h: 6 },
  { id: 'waiting', type: 'waiting', w: 4, h: 6 },
  { id: 'workload', type: 'workload', w: 13, h: 5 },
  { id: 'heatmap', type: 'heatmap', w: 11, h: 5 },
  { id: 'pace', type: 'pace', w: 7, h: 5 },
  { id: 'mix', type: 'mix', w: 5, h: 5 },
  { id: 'clients', type: 'clients', w: 6, h: 5 },
  { id: 'ontime', type: 'ontime', w: 6, h: 5 },
  { id: 'upcoming', type: 'upcoming', w: 9, h: 5, days: 14 },
  { id: 'deadlines', type: 'deadlines', w: 5, h: 5 },
  { id: 'calendar', type: 'calendar', w: 5, h: 5 },
  { id: 'activity', type: 'activity', w: 5, h: 5 },
];

export const UPCOMING_CHOICES = [7, 14, 30] as const;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(n)));

/**
 * A widget's smallest width on a grid of `cols` columns. On the wide grid a column is narrower than half a normal one
 * would be, so widgets may be a little narrower there (a third-wide list fits in a sixth of an ultrawide screen).
 */
export const minWidth = (type: WidgetType, cols = COLS) => (cols === COLS ? SPEC[type].minW : Math.min(cols, Math.max(4, Math.round((SPEC[type].minW * cols) / COLS) - 2)));

/** Fits a size to what the widget allows, and keeps it inside the grid. */
export function fit(item: WidgetItem, w: number, h: number, cols = COLS): WidgetItem {
  const s = SPEC[item.type];
  const nw = clamp(w, minWidth(item.type, cols), cols);
  return { ...item, w: nw, h: clamp(h, s.minH, s.maxH), x: clamp(item.x, 0, cols - nw) };
}

// ── Placement ───────────────────────────────────────────────────────────────────

type Box = Pick<WidgetItem, 'x' | 'y' | 'w' | 'h'>;
export const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const byPlace = (a: WidgetItem, b: WidgetItem) => a.y - b.y || a.x - b.x;

/** The first free place, top to bottom and left to right, where a w × h widget fits. */
export function firstFree(list: Box[], w: number, h: number, cols = COLS): { x: number; y: number } {
  for (let y = 0; ; y++) {
    for (let x = 0; x + w <= cols; x++) if (!list.some((o) => overlaps({ x, y, w, h }, o))) return { x, y };
  }
}

/**
 * Settles a layout: every widget moves up as far as it can without overlapping another, in reading order. A widget
 * that overlaps one already placed is moved down below it first. The result has no overlaps and no gaps above any
 * widget, and the order of the list is reading order (also the order on a phone and for the keyboard).
 */
export function settle(list: WidgetItem[], cols = COLS, pinned?: string): WidgetItem[] {
  const placed: WidgetItem[] = [];
  // A widget being moved keeps its place; the others make room around it.
  const order = [...list].sort((a, b) => (a.id === pinned ? -1 : b.id === pinned ? 1 : byPlace(a, b)));
  for (const it of order) {
    const p = { ...it, x: clamp(it.x, 0, cols - Math.min(it.w, cols)), y: Math.max(0, Math.round(it.y)), w: Math.min(it.w, cols) };
    if (p.id !== pinned) {
      while (placed.some((o) => overlaps(p, o))) p.y++;
      while (p.y > 0 && !placed.some((o) => overlaps({ ...p, y: p.y - 1 }, o))) p.y--;
    }
    placed.push(p);
  }
  // The pinned one was placed first; settle again without it pinned, so it too falls into any space above it.
  return pinned ? settle(placed, cols) : placed.sort(byPlace);
}

/** Places widgets that have no place yet in the first free spot, in list order (an old layout, or the defaults). */
function place(list: Omit<WidgetItem, 'x' | 'y'>[] & Partial<Box>[], cols: number): WidgetItem[] {
  const out: WidgetItem[] = [];
  for (const it of list as (WidgetItem & Partial<Box>)[]) {
    const has = Number.isInteger(it.x) && Number.isInteger(it.y) && it.x! >= 0 && it.y! >= 0;
    out.push({ ...it, ...(has ? { x: it.x!, y: it.y! } : firstFree(out, Math.min(it.w, cols), it.h, cols)) });
  }
  return settle(out, cols);
}

export const defaultLayout = (cols = COLS) => place((cols === WIDE_COLS ? START_WIDE : START).map((x) => ({ ...x, w: Math.min(x.w, cols) })), cols);
export const DEFAULT_LAYOUT = defaultLayout(COLS);
export const DEFAULT_WIDE_LAYOUT = defaultLayout(WIDE_COLS);

/** Reads a stored layout defensively: unknown widgets are dropped, sizes clamped, duplicates removed, overlaps settled. */
export function normalizeLayout(raw: unknown, cols = COLS): WidgetItem[] {
  if (!Array.isArray(raw)) return defaultLayout(cols);
  const seen = new Set<string>();
  const singles = new Set<WidgetType>();
  const out: (WidgetItem & Partial<Box>)[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const { id, type, x, y, w, h, days } = r as Record<string, unknown>;
    if (typeof id !== 'string' || !id || seen.has(id) || typeof type !== 'string' || !(type in SPEC)) continue;
    const t = type as WidgetType;
    if (SPEC[t].single && singles.has(t)) continue;
    seen.add(id);
    singles.add(t);
    const item = fit({ id, type: t, x: 0, y: 0, w: 0, h: 0 }, Number(w) || (SPEC[t].w * cols) / COLS, Number(h) || SPEC[t].h, cols);
    // Layouts saved before widgets had a place get one in reading order.
    const hasPlace = typeof x === 'number' && typeof y === 'number';
    const placed = { ...item, ...(hasPlace ? { x: clamp(x, 0, cols - item.w), y: Math.max(0, Math.round(y)) } : { x: undefined, y: undefined }) };
    if (t === 'upcoming') placed.days = UPCOMING_CHOICES.includes(days as 7) ? (days as number) : 14;
    out.push(placed as WidgetItem & Partial<Box>);
  }
  return place(out, cols);
}

/** Moves a widget so its top-left corner is at (x, y); what is in the way moves down, then everything settles. */
export function moveTo(list: WidgetItem[], id: string, x: number, y: number, cols = COLS): WidgetItem[] {
  return settle(list.map((it) => (it.id === id ? { ...it, x: clamp(x, 0, cols - it.w), y: Math.max(0, Math.round(y)) } : it)), cols, id);
}

/** Resizes a widget in place; what is in the way moves down, then everything settles. */
export function resizeTo(list: WidgetItem[], id: string, w: number, h: number, cols = COLS): WidgetItem[] {
  return settle(list.map((it) => (it.id === id ? fit(it, w, h, cols) : it)), cols, id);
}

/**
 * One step with the keyboard: left/right by a column, up/down past the neighbouring widget (a single row would just
 * settle back). Returns the list unchanged when the widget can't go further.
 */
export function nudge(list: WidgetItem[], id: string, dx: number, dy: number, cols = COLS): WidgetItem[] {
  const it = list.find((x) => x.id === id);
  if (!it) return list;
  for (let k = 1; k <= 40; k++) {
    const next = moveTo(list, id, it.x + dx * k, it.y + dy * k, cols);
    const moved = next.find((x) => x.id === id)!;
    if (moved.x !== it.x || moved.y !== it.y) return next;
    if (dx && (it.x + dx * k < 0 || it.x + dx * k + it.w > cols)) break;
    if (dy < 0 && it.y + dy * k < 0) break;
  }
  return list;
}

export function removeWidget(list: WidgetItem[], id: string, cols = COLS): WidgetItem[] {
  return settle(list.filter((x) => x.id !== id), cols);
}

/** A widget can be added when it isn't a single one that is already on the page. */
export function canAdd(list: WidgetItem[], type: WidgetType): boolean {
  return !SPEC[type].single || !list.some((x) => x.type === type);
}

/** Adds a widget in the first free place big enough for it (a gap if there is one, else at the bottom). */
export function addWidget(list: WidgetItem[], type: WidgetType, cols = COLS): WidgetItem[] {
  if (!canAdd(list, type)) return list;
  let n = 1;
  while (list.some((x) => x.id === (n === 1 ? type : `${type}-${n}`))) n++;
  const s = SPEC[type];
  const w = Math.min(cols, Math.round((s.w * cols) / COLS));
  const item: WidgetItem = { id: n === 1 ? type : `${type}-${n}`, type, w, h: s.h, ...firstFree(list, w, s.h, cols) };
  if (type === 'upcoming') item.days = 14;
  return settle([...list, item], cols);
}

/** How many rows the layout uses. */
export const rowsUsed = (list: Box[]) => Math.max(0, ...list.map((x) => x.y + x.h));

/** Pixel height of a widget that spans `h` rows. */
export const rowsToPx = (h: number) => h * ROW_PX + (h - 1) * GAP_PX;
