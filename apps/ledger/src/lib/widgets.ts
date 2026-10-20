// The Home dashboard: which widgets it shows, in what order, and how big each one is. The layout is a list placed
// on a 12-column grid in reading order (with gaps filled), so moving a widget is a reorder and resizing changes its
// column and row span. Stored in the workspace settings, so it follows you between devices.

export type WidgetType =
  | 'greeting' | 'quickAdd' | 'today' | 'overdue' | 'upcoming' | 'week' | 'waiting' | 'missing'
  | 'stats' | 'progress' | 'attention' | 'pinned' | 'activity' | 'notes' | 'deadlines' | 'calendar' | 'documents' | 'agenda';

export interface WidgetItem {
  id: string;
  type: WidgetType;
  /** Columns out of 12. */
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
export const ROW_PX = 56;
export const GAP_PX = 20;

export const WIDGETS: WidgetSpec[] = [
  { type: 'greeting', name: 'Greeting and summary', description: 'Today’s date, a one-line summary and your progress ring.', w: 12, h: 2, minW: 6, minH: 2, maxH: 4, single: true },
  { type: 'quickAdd', name: 'Quick add', description: 'Type a task in one line: “Chase receipts @client fri !high”.', w: 12, h: 2, minW: 4, minH: 2, maxH: 2, single: true },
  { type: 'today', name: 'Today', description: 'Everything due today, with what you have already finished.', w: 8, h: 6, minW: 4, minH: 3, maxH: 14, single: true },
  { type: 'overdue', name: 'Overdue', description: 'Open tasks past their due date, oldest first.', w: 8, h: 6, minW: 4, minH: 3, maxH: 14, single: true },
  { type: 'upcoming', name: 'Upcoming deadlines', description: 'The next 7, 14 or 30 days, grouped by day.', w: 8, h: 6, minW: 4, minH: 3, maxH: 14 },
  { type: 'week', name: 'This week', description: 'How many tasks fall on each of the next seven days.', w: 4, h: 4, minW: 3, minH: 3, maxH: 6, single: true },
  { type: 'waiting', name: 'Waiting on clients', description: 'Tasks waiting for a client, most overdue first.', w: 4, h: 4, minW: 3, minH: 3, maxH: 10, single: true },
  { type: 'missing', name: 'Missing tasks', description: 'Recurring periods that have no task yet.', w: 4, h: 4, minW: 3, minH: 2, maxH: 8, single: true },
  { type: 'stats', name: 'Key numbers', description: 'Open, overdue, due this week and done this week at a glance.', w: 12, h: 2, minW: 4, minH: 2, maxH: 3, single: true },
  { type: 'progress', name: 'Completed per week', description: 'Tasks finished in each of the last eight weeks, and how many on time.', w: 4, h: 4, minW: 3, minH: 3, maxH: 6, single: true },
  { type: 'attention', name: 'Clients needing attention', description: 'Clients ranked by overdue and open work.', w: 4, h: 5, minW: 3, minH: 3, maxH: 10, single: true },
  { type: 'pinned', name: 'Pinned clients', description: 'Your pinned clients with their open work and next deadline.', w: 4, h: 4, minW: 3, minH: 3, maxH: 10, single: true },
  { type: 'activity', name: 'Recent activity', description: 'What changed lately across all clients.', w: 4, h: 5, minW: 3, minH: 3, maxH: 12, single: true },
  { type: 'notes', name: 'Notepad', description: 'A scratchpad for the day. Saved as you type.', w: 4, h: 4, minW: 3, minH: 2, maxH: 10, single: true },
  { type: 'deadlines', name: 'Deadline radar', description: 'The next deadline for each kind of work: VAT, payroll, annual accounts…', w: 4, h: 4, minW: 3, minH: 3, maxH: 8, single: true },
  { type: 'agenda', name: 'Agenda', description: 'Today’s meetings by the hour, and the next ones coming up.', w: 4, h: 6, minW: 3, minH: 3, maxH: 12, single: true },
  { type: 'documents', name: 'Documents to collect', description: 'Everything you’ve requested from clients that hasn’t arrived yet, oldest first.', w: 4, h: 4, minW: 3, minH: 3, maxH: 10, single: true },
  { type: 'calendar', name: 'Month at a glance', description: 'A small calendar with the busy days marked.', w: 4, h: 5, minW: 3, minH: 4, maxH: 7, single: true },
];

export const SPEC = Object.fromEntries(WIDGETS.map((w) => [w.type, w])) as Record<WidgetType, WidgetSpec>;

export const DEFAULT_LAYOUT: WidgetItem[] = [
  { id: 'greeting', type: 'greeting', w: 12, h: 2 },
  { id: 'quickAdd', type: 'quickAdd', w: 12, h: 2 },
  { id: 'today', type: 'today', w: 8, h: 6 },
  { id: 'agenda', type: 'agenda', w: 4, h: 6 },
  { id: 'overdue', type: 'overdue', w: 8, h: 6 },
  { id: 'waiting', type: 'waiting', w: 4, h: 6 },
  { id: 'week', type: 'week', w: 4, h: 4 },
  { id: 'missing', type: 'missing', w: 4, h: 4 },
];

export const UPCOMING_CHOICES = [7, 14, 30] as const;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(n)));

/** Fits a size to what the widget allows. */
export function fit(item: WidgetItem, w: number, h: number): WidgetItem {
  const s = SPEC[item.type];
  return { ...item, w: clamp(w, s.minW, COLS), h: clamp(h, s.minH, s.maxH) };
}

/** Reads a stored layout defensively: unknown widgets are dropped, sizes clamped, duplicates removed. */
export function normalizeLayout(raw: unknown): WidgetItem[] {
  if (!Array.isArray(raw)) return DEFAULT_LAYOUT.map((x) => ({ ...x }));
  const seen = new Set<string>();
  const singles = new Set<WidgetType>();
  const out: WidgetItem[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const { id, type, w, h, days } = r as Record<string, unknown>;
    if (typeof id !== 'string' || !id || seen.has(id) || typeof type !== 'string' || !(type in SPEC)) continue;
    const t = type as WidgetType;
    if (SPEC[t].single && singles.has(t)) continue;
    seen.add(id);
    singles.add(t);
    const item = fit({ id, type: t, w: 0, h: 0 }, Number(w) || SPEC[t].w, Number(h) || SPEC[t].h);
    if (t === 'upcoming') item.days = UPCOMING_CHOICES.includes(days as 7) ? (days as number) : 14;
    out.push(item);
  }
  return out;
}

/** Moves the widget at `from` so it ends up at index `to`. */
export function moveWidget(list: WidgetItem[], from: number, to: number): WidgetItem[] {
  if (from === to || from < 0 || from >= list.length) return list;
  const next = [...list];
  const [it] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(next.length, to)), 0, it);
  return next;
}

/** A widget can be added when it isn't a single one that is already on the page. */
export function canAdd(list: WidgetItem[], type: WidgetType): boolean {
  return !SPEC[type].single || !list.some((x) => x.type === type);
}

export function addWidget(list: WidgetItem[], type: WidgetType): WidgetItem[] {
  if (!canAdd(list, type)) return list;
  let n = 1;
  while (list.some((x) => x.id === (n === 1 ? type : `${type}-${n}`))) n++;
  const s = SPEC[type];
  const item: WidgetItem = { id: n === 1 ? type : `${type}-${n}`, type, w: s.w, h: s.h };
  if (type === 'upcoming') item.days = 14;
  return [...list, item];
}

/** Pixel height of a widget that spans `h` rows. */
export const rowsToPx = (h: number) => h * ROW_PX + (h - 1) * GAP_PX;
