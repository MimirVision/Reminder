// Home as a dashboard of widgets on a grid. In customize mode a widget is dragged to the place under the pointer (or
// moved with the arrow keys from its handle), resized from its corner (or with Shift + arrows), removed, and new ones
// added from a gallery. Widgets in the way move down, and everything settles upward, so there are never holes; the
// rules are in lib/widgets.ts.
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { GripVertical, LayoutGrid, Maximize2, Plus, RotateCcw, X } from 'lucide-react';
import { useStore } from '../../data/store';
import {
  addWidget, canAdd, COLS, defaultLayout, GAP_PX, minWidth, moveTo, normalizeLayout, nudge, removeWidget, resizeTo, ROW_PX, rowsToPx, rowsUsed,
  SPEC, WIDE_COLS, WIDE_FROM_PX, WIDGETS, type WidgetItem, type WidgetType,
} from '../../lib/widgets';
import { Button } from '../../ui/button';
import { cn } from '../../ui/cn';
import { Confirm, Dialog, Menu, MenuItem, MenuLabel, MenuSeparator } from '../../ui/overlay';
import { EmptyState } from '../../ui/states';
import {
  ActivityWidget, AttentionWidget, CalendarWidget, DeadlinesWidget, GreetingWidget, NotesWidget, OverdueWidget, PinnedWidget,
  ProgressWidget, QuickAddWidget, StatsWidget, TodayWidget, UpcomingWidget, WaitingWidget, WeekWidget, DocumentsWidget, AgendaWidget, type WidgetProps,
} from './widgets';
import { ClientLoadWidget, HeatmapWidget, MixWidget, OnTimeWidget, PaceWidget, WorkloadWidget } from './charts';

const RENDER: Record<WidgetType, (p: WidgetProps) => React.ReactNode> = {
  greeting: GreetingWidget, quickAdd: QuickAddWidget, today: TodayWidget, overdue: OverdueWidget, upcoming: UpcomingWidget,
  week: WeekWidget, waiting: WaitingWidget, stats: StatsWidget, progress: ProgressWidget,
  attention: AttentionWidget, pinned: PinnedWidget, activity: ActivityWidget, notes: NotesWidget, deadlines: DeadlinesWidget, calendar: CalendarWidget, documents: DocumentsWidget, agenda: AgendaWidget,
  workload: WorkloadWidget, heatmap: HeatmapWidget, pace: PaceWidget, ontime: OnTimeWidget, mix: MixWidget, clients: ClientLoadWidget,
};

const CONTENT_SIZED = new Set<WidgetType>(['greeting', 'quickAdd', 'stats']);

const WIDTHS: Record<number, { w: number; label: string }[]> = {
  [COLS]: [{ w: 3, label: 'Quarter' }, { w: 4, label: 'Third' }, { w: 6, label: 'Half' }, { w: 8, label: 'Two thirds' }, { w: 12, label: 'Full width' }],
  [WIDE_COLS]: [{ w: 4, label: 'Sixth' }, { w: 6, label: 'Quarter' }, { w: 8, label: 'Third' }, { w: 12, label: 'Half' }, { w: 16, label: 'Two thirds' }, { w: 24, label: 'Full width' }],
};

/** 24 columns once the dashboard is very wide (an ultrawide monitor), else 12. */
function useColumns() {
  const ref = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(COLS);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setCols(e.contentRect.width >= WIDE_FROM_PX ? WIDE_COLS : COLS));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, cols] as const;
}

/** A gesture under way: the layout when it started, so each pointer move is worked out from there (never compounded). */
type Gesture =
  | { kind: 'move'; id: string; base: WidgetItem[]; offX: number; offY: number; startX: number; startY: number; x: number; y: number; active: boolean }
  | { kind: 'resize'; id: string; base: WidgetItem[]; startX: number; startY: number; w: number; h: number };

export function Dashboard({ editing, setEditing }: { editing: boolean; setEditing: (v: boolean) => void }) {
  const { snap, saveSettings } = useStore();
  const [outer, cols] = useColumns();
  const wide = cols === WIDE_COLS;
  // The wide screen keeps a layout of its own, so arranging one never disturbs the other.
  const key = wide ? 'homeLayoutWide' : 'homeLayout';
  const stored = snap.workspace.settings[key];
  const save = (next: WidgetItem[]) => saveSettings({ [key]: next });
  const [items, setItems] = useState<WidgetItem[]>(() => normalizeLayout(stored, cols));
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [gallery, setGallery] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [announce, setAnnounce] = useState('');
  const grid = useRef<HTMLDivElement>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const gestureRef = useRef(gesture);
  gestureRef.current = gesture;

  // Another device (or a reload) changed the stored layout: follow it, unless a gesture is under way.
  const storedKey = JSON.stringify(stored ?? null);
  useEffect(() => { if (!gestureRef.current) setItems(normalizeLayout(stored, cols)); }, [storedKey, cols]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = (next: WidgetItem[]) => {
    itemsRef.current = next;
    setItems(next);
    void save(next);
  };
  const update = (id: string, patch: Partial<WidgetItem>) => commit(itemsRef.current.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const remove = (id: string) => {
    const it = itemsRef.current.find((x) => x.id === id);
    commit(removeWidget(itemsRef.current, id, cols));
    if (it) setAnnounce(`${SPEC[it.type].name} removed. The widgets below it moved up.`);
  };
  const resize = (id: string, w: number, h: number) => {
    const next = resizeTo(itemsRef.current, id, w, h, cols);
    commit(next);
    const it = next.find((x) => x.id === id)!;
    setAnnounce(`${SPEC[it.type].name}: ${it.w} of ${cols} columns wide, ${it.h} rows tall`);
  };

  /** The grid cell under a point, as fractional columns and rows. */
  const cellAt = (clientX: number, clientY: number) => {
    const r = grid.current!.getBoundingClientRect();
    const colW = (r.width - GAP_PX * (cols - 1)) / cols;
    return { cx: (clientX - r.left) / (colW + GAP_PX), cy: (clientY - r.top) / (ROW_PX + GAP_PX), colW };
  };

  // ── Dragging to move ───────────────────────────────────────────────────────
  const startMove = (e: ReactPointerEvent<HTMLDivElement>, it: WidgetItem) => {
    if (!editing || e.button !== 0 || (e.target as HTMLElement).closest('button:not([data-handle]),[role=menuitem],a,input,textarea,[data-resize]')) return;
    const box = e.currentTarget.getBoundingClientRect();
    setGesture({ kind: 'move', id: it.id, base: itemsRef.current, offX: e.clientX - box.left, offY: e.clientY - box.top, startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY, active: false });
  };
  // ── Resizing from the corner ───────────────────────────────────────────────
  const startResize = (e: ReactPointerEvent, it: WidgetItem) => {
    e.preventDefault();
    e.stopPropagation();
    setGesture({ kind: 'resize', id: it.id, base: itemsRef.current, startX: e.clientX, startY: e.clientY, w: it.w, h: it.h });
  };

  useEffect(() => {
    if (!gesture) return;
    const move = (e: PointerEvent) => {
      const g = gestureRef.current;
      if (!g || !grid.current) return;
      let next: WidgetItem[];
      if (g.kind === 'move') {
        const active = g.active || Math.hypot(e.clientX - g.startX, e.clientY - g.startY) > 5;
        if (!active) return;
        // Near the top or bottom of the window, the page scrolls, so a widget can be carried past the screen's edge.
        if (e.clientY < 90) window.scrollBy(0, -24); else if (e.clientY > window.innerHeight - 60) window.scrollBy(0, 24);
        // The widget's top-left corner goes to the cell nearest to where it is being held.
        const { cx, cy } = cellAt(e.clientX - g.offX, e.clientY - g.offY);
        next = moveTo(g.base, g.id, Math.round(cx), Math.round(cy), cols);
        const ng = { ...g, x: e.clientX, y: e.clientY, active };
        gestureRef.current = ng;
        setGesture(ng);
      } else {
        const { colW } = cellAt(e.clientX, e.clientY);
        const w = g.w + Math.round((e.clientX - g.startX) / (colW + GAP_PX));
        const h = g.h + Math.round((e.clientY - g.startY) / (ROW_PX + GAP_PX));
        next = resizeTo(g.base, g.id, w, h, cols);
      }
      // Only re-render when a widget actually lands somewhere new.
      if (JSON.stringify(next) !== JSON.stringify(itemsRef.current)) { itemsRef.current = next; setItems(next); }
    };
    const up = () => {
      const g = gestureRef.current;
      gestureRef.current = null;
      setGesture(null);
      if (g && (g.kind === 'resize' || g.active) && JSON.stringify(itemsRef.current) !== JSON.stringify(g.base)) void save(itemsRef.current);
    };
    const cancel = (e: globalThis.KeyboardEvent) => {
      const g = gestureRef.current;
      if (e.key !== 'Escape' || !g) return;
      itemsRef.current = g.base;
      setItems(g.base);
      gestureRef.current = null;
      setGesture(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    window.addEventListener('keydown', cancel);
    return () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up); window.removeEventListener('keydown', cancel);
    };
  }, [gesture?.id, gesture?.kind, cols]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── The keyboard, from a widget's handle ───────────────────────────────────
  const onHandleKey = (e: KeyboardEvent, it: WidgetItem) => {
    const name = SPEC[it.type].name;
    const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key] as [number, number] | undefined;
    if (dir && e.shiftKey) {
      e.preventDefault();
      resize(it.id, it.w + dir[0], it.h + dir[1]);
    } else if (dir) {
      e.preventDefault();
      const next = nudge(itemsRef.current, it.id, dir[0], dir[1], cols);
      if (next === itemsRef.current) return;
      commit(next);
      const moved = next.find((x) => x.id === it.id)!;
      setAnnounce(`${name} moved to column ${moved.x + 1}, row ${moved.y + 1}`);
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-widget-id="${it.id}"] [data-handle]`)?.focus());
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      remove(it.id);
    }
  };

  const add = (type: WidgetType) => {
    const before = new Set(itemsRef.current.map((x) => x.id));
    const next = addWidget(itemsRef.current, type, cols);
    commit(next);
    setGallery(false);
    const added = next.find((x) => !before.has(x.id));
    if (!added) return;
    setAnnounce(`${SPEC[type].name} added at column ${added.x + 1}, row ${added.y + 1}`);
    requestAnimationFrame(() => document.querySelector(`[data-widget-id="${added.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  };

  const moving = gesture?.kind === 'move' && gesture.active ? items.find((x) => x.id === gesture.id) : undefined;
  const busy = gesture && (gesture.kind === 'resize' || gesture.active);
  // While customizing, a few spare rows below the last widget, so there is somewhere to drag to.
  const rows = rowsUsed(items) + (editing ? 4 : 0);

  return (
    <div ref={outer}>
      {editing && (
        <div role="toolbar" aria-label="Customize Home" className="sticky top-[60px] z-20 mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-accent/30 bg-surface/95 py-2 pr-2 pl-4 shadow-pop backdrop-blur">
          <LayoutGrid className="size-4 text-accent" />
          <p className="min-w-0 flex-1 text-[13px] text-ink-2">
            <span className="font-medium text-ink">Customizing Home.</span><span className="hidden sm:inline"> Drag a widget where you want it, drag its corner to resize. Widgets in the way move down.</span>
            <span className="hidden xl:inline"> From a handle: arrows move, Shift + arrows resize. Esc cancels a drag.</span>
            {wide && <span className="hidden xl:inline"> This is the wide-screen layout; smaller screens keep their own.</span>}
          </p>
          <Button size="sm" onClick={() => setGallery(true)}><Plus /> Add widget</Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirmReset(true)}><RotateCcw /> Reset</Button>
          <Button size="sm" variant="primary" onClick={() => setEditing(false)}>Done</Button>
        </div>
      )}

      {items.length === 0 ? (
        <EmptyState icon={LayoutGrid} title="Your Home is empty" body="Add the widgets you want to start the day with."
          action={<Button variant="primary" onClick={() => { setEditing(true); setGallery(true); }}><Plus /> Add widget</Button>} />
      ) : (
        <div ref={grid}
          className={cn('relative grid grid-cols-1 gap-5 lg:grid-cols-(--cols) lg:grid-rows-(--rows)', busy && 'cursor-grabbing select-none')}
          style={{
            '--cols': `repeat(${cols}, minmax(0, 1fr))`, '--rows': `repeat(${rows}, ${ROW_PX}px)`,
            // While customizing, the grid's columns are drawn faintly, so it is clear where a widget will land.
            ...(editing ? { backgroundImage: `repeating-linear-gradient(to right, color-mix(in oklab, var(--c-accent) 3%, transparent) 0 calc((100% - ${GAP_PX * (cols - 1)}px) / ${cols}), transparent calc((100% - ${GAP_PX * (cols - 1)}px) / ${cols}) calc((100% - ${GAP_PX * (cols - 1)}px) / ${cols} + ${GAP_PX}px))` } : {}),
          } as CSSProperties}>
          {items.map((it, i) => {
            const W = RENDER[it.type];
            const isMoving = moving?.id === it.id;
            const isResizing = gesture?.kind === 'resize' && gesture.id === it.id;
            return (
              <div key={it.id} data-widget-id={it.id} data-widget-type={it.type}
                // Widgets arrive one after another, in reading order, when Home opens (and a new one when it is added).
                style={{ '--x': it.x + 1, '--y': it.y + 1, '--w': it.w, '--h': it.h, '--px': `${rowsToPx(it.h)}px`, animationDelay: `${Math.min(i, 14) * 28}ms` } as CSSProperties}
                onPointerDown={(e) => startMove(e, it)}
                // On a phone widgets stack in reading order: the short ones take their content's height, the lists keep theirs.
                className={cn('relative min-w-0 col-span-1 animate-rise-in lg:col-start-(--x) lg:col-span-(--w) lg:row-start-(--y) lg:row-span-(--h)', !CONTENT_SIZED.has(it.type) && 'max-lg:h-(--px)',
                  editing && 'cursor-grab touch-none rounded-xl')}>
                <div className={cn('h-full transition-opacity', editing && 'pointer-events-none select-none', isMoving && 'opacity-30')} inert={editing || undefined}>
                  <W item={it} update={(p) => update(it.id, p)} />
                </div>
                {editing && (
                  <>
                    <div aria-hidden className={cn('pointer-events-none absolute -inset-1 rounded-[16px] border-2 border-dashed transition-colors',
                      isMoving || isResizing ? 'border-accent bg-accent-soft/40' : 'border-accent/35')} />
                    <div className="absolute top-2 right-2 z-10 flex items-center gap-0.5 rounded-lg border border-line bg-surface p-0.5 shadow-pop">
                      <button data-handle aria-label={`Move or resize ${SPEC[it.type].name}`} title="Drag to move · arrows move · Shift + arrows resize"
                        onKeyDown={(e) => onHandleKey(e, it)}
                        className="flex h-7 cursor-grab items-center gap-1 rounded-md px-1.5 text-[12px] font-medium text-ink-2 hover:bg-hover">
                        <GripVertical className="size-4 text-ink-3" />
                        <span className="max-w-36 truncate">{SPEC[it.type].name}</span>
                      </button>
                      <Menu label={`Size of ${SPEC[it.type].name}`} align="end" trigger={
                        <button aria-label={`Size of ${SPEC[it.type].name}`} className="flex size-7 items-center justify-center rounded-md text-ink-3 hover:bg-hover hover:text-ink"><Maximize2 className="size-3.5" /></button>
                      }>
                        <MenuLabel>Width</MenuLabel>
                        {WIDTHS[cols].filter((o) => o.w >= minWidth(it.type, cols)).map((o) => (
                          <MenuItem key={o.w} onSelect={() => resize(it.id, o.w, it.h)}>{o.label}{it.w === o.w && <span className="ml-auto text-accent">✓</span>}</MenuItem>
                        ))}
                        <MenuSeparator />
                        <MenuLabel>Height</MenuLabel>
                        <MenuItem disabled={it.h >= SPEC[it.type].maxH} onSelect={() => resize(it.id, it.w, it.h + 1)}>Taller</MenuItem>
                        <MenuItem disabled={it.h <= SPEC[it.type].minH} onSelect={() => resize(it.id, it.w, it.h - 1)}>Shorter</MenuItem>
                      </Menu>
                      <button aria-label={`Remove ${SPEC[it.type].name}`} onClick={() => remove(it.id)}
                        className="flex size-7 items-center justify-center rounded-md text-ink-3 hover:bg-danger-soft hover:text-danger"><X className="size-4" /></button>
                    </div>
                    <div role="presentation" data-resize onPointerDown={(e) => startResize(e, it)} title="Drag to resize"
                      className="absolute -right-1 -bottom-1 z-10 hidden size-5 cursor-nwse-resize items-end justify-end lg:flex">
                      <span className="size-3.5 rounded-br-[10px] border-r-[3px] border-b-[3px] border-accent" />
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {moving && gesture?.kind === 'move' && (
        <div aria-hidden className="pointer-events-none fixed z-50 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-lg bg-ink px-3 py-2 text-[12.5px] font-medium text-canvas shadow-pop"
          style={{ left: gesture.x, top: gesture.y }}>
          <GripVertical className="size-4 opacity-60" /> {SPEC[moving.type].name}
        </div>
      )}
      <p className="sr-only" aria-live="polite">{announce}</p>

      <Dialog open={gallery} onOpenChange={setGallery} title="Add a widget" description="It goes in the first free space big enough for it. You can move and resize it afterwards." width="max-w-3xl">
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {WIDGETS.map((w) => {
            const ok = canAdd(items, w.type);
            return (
              <li key={w.type}>
                <button disabled={!ok} onClick={() => add(w.type)}
                  className="flex h-full w-full flex-col gap-1 rounded-xl border border-line p-3.5 text-left transition-colors hover:border-accent/50 hover:bg-accent-soft/30 disabled:cursor-default disabled:opacity-55 disabled:hover:border-line disabled:hover:bg-transparent">
                  <span className="flex items-center gap-2 text-[13.5px] font-semibold">
                    {w.name}
                    <span className="ml-auto text-[11.5px] font-normal text-ink-3">{ok ? <span className="inline-flex items-center gap-1 text-accent"><Plus className="size-3.5" />Add</span> : 'On Home'}</span>
                  </span>
                  <span className="text-[12.5px] text-ink-3">{w.description}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </Dialog>
      <Confirm open={confirmReset} onOpenChange={setConfirmReset} tone="primary" title="Reset Home to the default layout?" confirmLabel="Reset"
        body={`Your widgets, their places and sizes${wide ? ' on this wide screen' : ''} go back to how Ledger starts. Your notepad text is kept.`}
        onConfirm={() => { commit(defaultLayout(cols)); setAnnounce('Home reset to the default layout'); }} />
    </div>
  );
}
