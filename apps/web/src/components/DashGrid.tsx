import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { bottom, clampItem, COLS, place, type Item } from '../lib/dashLayout';
import { useI18n } from '../i18n';
import { Icon } from './icons';

export const ROW = 34;
export const GAP = 12;
const UNIT_Y = ROW + GAP;

type Drag = { id: string; mode: 'move' | 'resize'; sx: number; sy: number; dx: number; dy: number; orig: Item; cur: Item };

/** Panels on a 24-column grid. In edit mode a panel can be dragged by its title bar, resized from its corner (or moved with the arrow keys, resized with Shift + arrows) and hidden. */
export function DashGrid({ items, editing, onItems, onHide, panels, titles }: {
  items: Item[]; editing: boolean; onItems: (items: Item[]) => void; onHide: (id: string) => void; panels: Record<string, ReactNode>; titles: Record<string, string>;
}) {
  const { t } = useI18n();
  const el = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [drag, setDrag] = useState<Drag | null>(null);

  useEffect(() => {
    if (!el.current) return;
    const ro = new ResizeObserver(() => setWidth(el.current?.clientWidth ?? 0));
    ro.observe(el.current);
    setWidth(el.current.clientWidth);
    return () => ro.disconnect();
  }, []);

  const pitch = width > 0 ? (width + GAP) / COLS : 1;
  const shown = drag ? place(items, drag.cur) : items;
  const rect = (i: Item) => ({ left: i.x * pitch, top: i.y * UNIT_Y, width: i.w * pitch - GAP, height: i.h * UNIT_Y - GAP });

  const start = (e: PointerEvent, it: Item, mode: 'move' | 'resize') => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ id: it.id, mode, sx: e.clientX, sy: e.clientY, dx: 0, dy: 0, orig: it, cur: it });
  };
  const move = (e: PointerEvent) => {
    if (!drag) return;
    const dx = e.clientX - drag.sx; const dy = e.clientY - drag.sy;
    const gx = Math.round(dx / pitch); const gy = Math.round(dy / UNIT_Y);
    const o = drag.orig;
    const cur = clampItem(drag.mode === 'move' ? { ...o, x: o.x + gx, y: o.y + gy } : { ...o, w: o.w + gx, h: o.h + gy });
    setDrag({ ...drag, dx, dy, cur });
  };
  const end = () => { if (drag) { onItems(place(items, drag.cur)); setDrag(null); } };
  const key = (e: KeyboardEvent, it: Item) => {
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!d) return;
    e.preventDefault();
    onItems(place(items, e.shiftKey ? { ...it, w: it.w + d[0], h: it.h + d[1] } : { ...it, x: it.x + d[0], y: it.y + d[1] }));
  };

  const rows = Math.max(bottom(shown), 10);
  return (
    <div ref={el} className={`dash${editing ? ' editing' : ''}${drag ? ' dragging' : ''}`} style={{ height: rows * UNIT_Y - GAP + (editing ? UNIT_Y * 3 : 0) }}>
      {drag && <div className="dash-ghost" style={rect(drag.cur)} aria-hidden="true" />}
      {shown.map((it) => {
        const node = panels[it.id];
        if (!node) return null;
        const orig = items.find((i) => i.id === it.id) ?? it;
        const dragging = drag?.id === it.id;
        let r = rect(it);
        if (dragging) r = drag.mode === 'move' ? { ...rect(drag.orig), left: drag.orig.x * pitch + drag.dx, top: drag.orig.y * UNIT_Y + drag.dy } : { ...rect(drag.orig), width: Math.max(80, rect(drag.orig).width + drag.dx), height: Math.max(80, rect(drag.orig).height + drag.dy) };
        return (
          <div key={it.id} className={`dash-item${dragging ? ' lifted' : ''}`} style={r}>
            {node}
            {editing && (
              <>
                <div className="dash-bar" onPointerDown={(e) => start(e, orig, 'move')} onPointerMove={move} onPointerUp={end} onPointerCancel={() => setDrag(null)}
                  role="button" tabIndex={0} aria-label={t('dash.move', { name: titles[it.id] ?? it.id })} onKeyDown={(e) => key(e, orig)}>
                  <span className="dash-grip" aria-hidden="true">⋮⋮</span><strong>{titles[it.id] ?? it.id}</strong>
                  <button type="button" className="mini" aria-label={t('dash.hide', { name: titles[it.id] ?? it.id })} onPointerDown={(e) => e.stopPropagation()} onClick={() => onHide(it.id)}><Icon name="x" size={14} /></button>
                </div>
                <div className="dash-size" onPointerDown={(e) => start(e, orig, 'resize')} onPointerMove={move} onPointerUp={end} onPointerCancel={() => setDrag(null)} aria-hidden="true" />
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
export type { ReactNode };
