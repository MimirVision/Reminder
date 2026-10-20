// Home as a dashboard of widgets. In customize mode a widget can be dragged to a new place (or moved with the arrow
// keys from its handle), resized from its corner (or with Shift + arrows), removed, and new ones added from a gallery.
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { GripVertical, LayoutGrid, Maximize2, Plus, RotateCcw, X } from 'lucide-react';
import { useStore } from '../../data/store';
import { addWidget, canAdd, COLS, DEFAULT_LAYOUT, fit, GAP_PX, moveWidget, normalizeLayout, ROW_PX, rowsToPx, SPEC, WIDGETS, type WidgetItem, type WidgetType } from '../../lib/widgets';
import { Button } from '../../ui/button';
import { cn } from '../../ui/cn';
import { Confirm, Dialog, Menu, MenuItem, MenuLabel, MenuSeparator } from '../../ui/overlay';
import { EmptyState } from '../../ui/states';
import {
  ActivityWidget, AttentionWidget, CalendarWidget, DeadlinesWidget, GreetingWidget, MissingWidget, NotesWidget, OverdueWidget, PinnedWidget,
  ProgressWidget, QuickAddWidget, StatsWidget, TodayWidget, UpcomingWidget, WaitingWidget, WeekWidget, DocumentsWidget, AgendaWidget, type WidgetProps,
} from './widgets';

const RENDER: Record<WidgetType, (p: WidgetProps) => React.ReactNode> = {
  greeting: GreetingWidget, quickAdd: QuickAddWidget, today: TodayWidget, overdue: OverdueWidget, upcoming: UpcomingWidget,
  week: WeekWidget, waiting: WaitingWidget, missing: MissingWidget, stats: StatsWidget, progress: ProgressWidget,
  attention: AttentionWidget, pinned: PinnedWidget, activity: ActivityWidget, notes: NotesWidget, deadlines: DeadlinesWidget, calendar: CalendarWidget, documents: DocumentsWidget, agenda: AgendaWidget,
};

const CONTENT_SIZED = new Set<WidgetType>(['greeting', 'quickAdd', 'stats']);

const WIDTHS = [{ w: 3, label: 'Quarter' }, { w: 4, label: 'Third' }, { w: 6, label: 'Half' }, { w: 8, label: 'Two thirds' }, { w: 12, label: 'Full width' }];

type Drag = { id: string; x: number; y: number; startX: number; startY: number; active: boolean; lastOver: string | null };
type Resize = { id: string; startX: number; startY: number; w: number; h: number; col: number };

export function Dashboard({ editing, setEditing }: { editing: boolean; setEditing: (v: boolean) => void }) {
  const { snap, saveSettings } = useStore();
  const stored = snap.workspace.settings.homeLayout;
  const [items, setItems] = useState<WidgetItem[]>(() => normalizeLayout(stored));
  const [drag, setDrag] = useState<Drag | null>(null);
  const [resizing, setResizing] = useState<Resize | null>(null);
  const [gallery, setGallery] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [announce, setAnnounce] = useState('');
  const grid = useRef<HTMLDivElement>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // Another device (or a reload) changed the stored layout: follow it, unless a gesture is under way.
  const storedKey = JSON.stringify(stored ?? null);
  useEffect(() => { if (!drag && !resizing) setItems(normalizeLayout(stored)); }, [storedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = (next: WidgetItem[]) => {
    setItems(next);
    void saveSettings({ homeLayout: next });
  };
  const update = (id: string, patch: Partial<WidgetItem>) => commit(itemsRef.current.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const remove = (id: string) => {
    const it = itemsRef.current.find((x) => x.id === id);
    commit(itemsRef.current.filter((x) => x.id !== id));
    if (it) setAnnounce(`${SPEC[it.type].name} removed`);
  };
  const resizeTo = (id: string, w: number, h: number) => {
    const next = itemsRef.current.map((x) => (x.id === id ? fit(x, w, h) : x));
    commit(next);
    const it = next.find((x) => x.id === id)!;
    setAnnounce(`${SPEC[it.type].name}: ${it.w} of ${COLS} columns wide, ${it.h} rows tall`);
  };

  // ── Dragging to move ───────────────────────────────────────────────────────
  const startDrag = (e: ReactPointerEvent, id: string) => {
    if (!editing || e.button !== 0 || (e.target as HTMLElement).closest('button,[role=menuitem],a,input,textarea')) return;
    setDrag({ id, x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, active: false, lastOver: null });
  };
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;
  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const active = d.active || Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 5;
      if (!active) return;
      const over = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-widget-id]')?.dataset.widgetId ?? null;
      let lastOver = d.lastOver;
      // Move once per widget entered, so two widgets of different sizes don't swap back and forth.
      if (over && over !== d.id && over !== d.lastOver) {
        const list = itemsRef.current;
        const next = moveWidget(list, list.findIndex((x) => x.id === d.id), list.findIndex((x) => x.id === over));
        itemsRef.current = next;
        setItems(next);
        lastOver = over;
      } else if (!over) lastOver = null;
      const nd = { ...d, x: e.clientX, y: e.clientY, active, lastOver };
      dragRef.current = nd;
      setDrag(nd);
    };
    const up = () => {
      if (dragRef.current?.active) void saveSettings({ homeLayout: itemsRef.current });
      dragRef.current = null;
      setDrag(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
  }, [drag?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Resizing from the corner ───────────────────────────────────────────────
  const startResize = (e: ReactPointerEvent, it: WidgetItem) => {
    e.preventDefault();
    e.stopPropagation();
    const width = grid.current?.getBoundingClientRect().width ?? 1200;
    setResizing({ id: it.id, startX: e.clientX, startY: e.clientY, w: it.w, h: it.h, col: (width - GAP_PX * (COLS - 1)) / COLS });
  };
  useEffect(() => {
    if (!resizing) return;
    const r = resizing;
    const move = (e: PointerEvent) => {
      const w = r.w + Math.round((e.clientX - r.startX) / (r.col + GAP_PX));
      const h = r.h + Math.round((e.clientY - r.startY) / (ROW_PX + GAP_PX));
      const next = itemsRef.current.map((x) => (x.id === r.id ? fit(x, w, h) : x));
      itemsRef.current = next;
      setItems(next);
    };
    const up = () => { setResizing(null); void saveSettings({ homeLayout: itemsRef.current }); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
  }, [resizing?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── The keyboard, from a widget's handle ───────────────────────────────────
  const onHandleKey = (e: KeyboardEvent, it: WidgetItem) => {
    const i = itemsRef.current.findIndex((x) => x.id === it.id);
    const name = SPEC[it.type].name;
    if (e.shiftKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      e.preventDefault();
      const dw = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
      const dh = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
      resizeTo(it.id, it.w + dw, it.h + dh);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      const to = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? i - 1 : i + 1;
      if (to < 0 || to >= itemsRef.current.length) return;
      commit(moveWidget(itemsRef.current, i, to));
      setAnnounce(`${name} moved to position ${to + 1} of ${itemsRef.current.length}`);
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-widget-id="${it.id}"] [data-handle]`)?.focus());
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      remove(it.id);
    }
  };

  const add = (type: WidgetType) => {
    const next = addWidget(itemsRef.current, type);
    commit(next);
    setGallery(false);
    const id = next[next.length - 1].id;
    setAnnounce(`${SPEC[type].name} added at the end`);
    requestAnimationFrame(() => document.querySelector(`[data-widget-id="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  };

  const dragging = drag?.active ? items.find((x) => x.id === drag.id) : undefined;

  return (
    <>
      {editing && (
        <div role="toolbar" aria-label="Customize Home" className="sticky top-[60px] z-20 mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-accent/30 bg-surface/95 py-2 pr-2 pl-4 shadow-pop backdrop-blur">
          <LayoutGrid className="size-4 text-accent" />
          <p className="min-w-0 flex-1 text-[13px] text-ink-2">
            <span className="font-medium text-ink">Customizing Home.</span> Drag a widget to move it, drag its corner to resize.
            <span className="hidden xl:inline"> From a handle: arrows move, Shift + arrows resize.</span>
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
        <div ref={grid} className={cn('grid grid-cols-1 gap-5 lg:auto-rows-(--row) lg:grid-cols-12', (drag?.active || resizing) && 'cursor-grabbing select-none')}
          style={{ '--row': `${ROW_PX}px` } as CSSProperties}>
          {items.map((it) => {
            const W = RENDER[it.type];
            const isDragged = drag?.active && drag.id === it.id;
            return (
              <div key={it.id} data-widget-id={it.id} data-widget-type={it.type}
                style={{ '--w': it.w, '--h': it.h, '--px': `${rowsToPx(it.h)}px` } as CSSProperties}
                onPointerDown={(e) => startDrag(e, it.id)}
                // On a phone widgets stack: the short ones take their content's height, the lists keep theirs.
                className={cn('relative min-w-0 col-span-1 lg:col-span-(--w) lg:row-span-(--h)', !CONTENT_SIZED.has(it.type) && 'max-lg:h-(--px)',
                  editing && 'cursor-grab touch-none rounded-xl',
                  isDragged && 'opacity-40')}>
                <div className={cn('h-full', editing && 'pointer-events-none select-none')} inert={editing || undefined}>
                  <W item={it} update={(p) => update(it.id, p)} />
                </div>
                {editing && (
                  <>
                    <div aria-hidden className={cn('pointer-events-none absolute -inset-1 rounded-[16px] border-2 border-dashed transition-colors',
                      isDragged || resizing?.id === it.id ? 'border-accent bg-accent-soft/30' : 'border-accent/35')} />
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
                        {WIDTHS.filter((o) => o.w >= SPEC[it.type].minW).map((o) => (
                          <MenuItem key={o.w} onSelect={() => resizeTo(it.id, o.w, it.h)}>{o.label}{it.w === o.w && <span className="ml-auto text-accent">✓</span>}</MenuItem>
                        ))}
                        <MenuSeparator />
                        <MenuLabel>Height</MenuLabel>
                        <MenuItem disabled={it.h >= SPEC[it.type].maxH} onSelect={() => resizeTo(it.id, it.w, it.h + 1)}>Taller</MenuItem>
                        <MenuItem disabled={it.h <= SPEC[it.type].minH} onSelect={() => resizeTo(it.id, it.w, it.h - 1)}>Shorter</MenuItem>
                      </Menu>
                      <button aria-label={`Remove ${SPEC[it.type].name}`} onClick={() => remove(it.id)}
                        className="flex size-7 items-center justify-center rounded-md text-ink-3 hover:bg-danger-soft hover:text-danger"><X className="size-4" /></button>
                    </div>
                    <div role="presentation" onPointerDown={(e) => startResize(e, it)} title="Drag to resize"
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

      {dragging && drag && (
        <div aria-hidden className="pointer-events-none fixed z-50 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-lg bg-ink px-3 py-2 text-[12.5px] font-medium text-canvas shadow-pop"
          style={{ left: drag.x, top: drag.y }}>
          <GripVertical className="size-4 opacity-60" /> {SPEC[dragging.type].name}
        </div>
      )}
      <p className="sr-only" aria-live="polite">{announce}</p>

      <Dialog open={gallery} onOpenChange={setGallery} title="Add a widget" description="Pick what Home should show. You can move and resize it afterwards." width="max-w-3xl">
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
        body="Your widgets, their order and sizes go back to how Ledger starts. Your notepad text is kept."
        onConfirm={() => { commit(DEFAULT_LAYOUT.map((x) => ({ ...x }))); setAnnounce('Home reset to the default layout'); }} />
    </>
  );
}
