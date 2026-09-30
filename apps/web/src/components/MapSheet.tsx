import { useEffect, useRef, useState, type ReactNode } from 'react';
import { snapAfterDrag, snapHeights, type Snap } from '../lib/sheetSnap';
import { useI18n } from '../i18n';

// Draggable bottom sheet over the map: peek, half, full. Drag the handle (or flick); tap it to step up.
export function MapSheet({ snap, onSnap, onHeight, title, children }: {
  snap: Snap; onSnap: (s: Snap) => void; onHeight: (px: number) => void; title: string; children: ReactNode;
}) {
  const { t } = useI18n();
  const [vh, setVh] = useState(() => window.innerHeight);
  const heights = snapHeights(vh);
  const [drag, setDrag] = useState<number | null>(null);
  const start = useRef({ y: 0, h: 0, t: 0, lastY: 0, lastT: 0, v: 0 });
  const height = drag ?? heights[snap];

  useEffect(() => {
    const on = () => setVh(window.innerHeight);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  useEffect(() => { onHeight(drag === null ? heights[snap] : Math.round(drag)); }, [snap, vh, drag]); // eslint-disable-line react-hooks/exhaustive-deps

  const down = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    start.current = { y: e.clientY, h: heights[snap], t: e.timeStamp, lastY: e.clientY, lastT: e.timeStamp, v: 0 };
    setDrag(heights[snap]);
  };
  const move = (e: React.PointerEvent) => {
    if (drag === null) return;
    const s = start.current;
    const dt = e.timeStamp - s.lastT;
    if (dt > 0) s.v = (s.lastY - e.clientY) / dt;
    s.lastY = e.clientY; s.lastT = e.timeStamp;
    setDrag(Math.max(heights.peek - 30, Math.min(heights.full, s.h + (s.y - e.clientY))));
  };
  const up = (e: React.PointerEvent) => {
    if (drag === null) return;
    const moved = Math.abs(start.current.y - e.clientY);
    const next = moved < 6 ? (snap === 'peek' ? 'half' : snap === 'half' ? 'full' : 'peek') : snapAfterDrag(drag, start.current.v, heights);
    setDrag(null);
    onSnap(next);
  };

  return (
    <section className={`mapsheet glass${drag !== null ? ' dragging' : ''}`} style={{ height }} aria-label={title}>
      <div className="mapsheet-head" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => setDrag(null)} role="button" tabIndex={0}
        aria-label={t('map.handle')} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSnap(snap === 'peek' ? 'half' : snap === 'half' ? 'full' : 'peek'); } }}>
        <span className="grab-bar" />
        <h2>{title}</h2>
      </div>
      <div className={`mapsheet-body${snap === 'peek' ? ' peek' : ''}`}>{children}</div>
    </section>
  );
}
