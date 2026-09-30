import { useRef, useState, type ReactNode } from 'react';
import { isHorizontal, swipeOffset, swipeResult } from '../lib/swipe';
import { tap } from '../lib/haptics';
import { useI18n } from '../i18n';
import { Icon } from './icons';

// Swipe right to finish, left to delete. Taps and the normal buttons keep working; vertical drags still scroll.
export function SwipeRow({ children, onDone, onDelete, doneLabel }: { children: ReactNode; onDone: () => void; onDelete: () => void; doneLabel?: string }) {
  const { t } = useI18n();
  const [dx, setDx] = useState(0);
  const [settling, setSettling] = useState(false);
  const start = useRef<{ x: number; y: number; t: number; id: number; live: boolean } | null>(null);

  const down = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') return; // swipes are for fingers; the mouse has the buttons
    start.current = { x: e.clientX, y: e.clientY, t: e.timeStamp, id: e.pointerId, live: false };
  };
  const move = (e: React.PointerEvent) => {
    const s = start.current;
    if (!s) return;
    const mx = e.clientX - s.x, my = e.clientY - s.y;
    if (!s.live && isHorizontal(mx, my)) { s.live = true; (e.currentTarget as HTMLElement).setPointerCapture(s.id); }
    if (s.live) { setSettling(false); setDx(swipeOffset(mx)); }
  };
  const end = (e: React.PointerEvent) => {
    const s = start.current;
    start.current = null;
    if (!s?.live) return;
    const action = swipeResult(e.clientX - s.x, e.clientY - s.y, e.timeStamp - s.t);
    setSettling(true);
    setDx(0);
    if (action === 'done') { tap('success'); onDone(); }
    else if (action === 'delete') { tap(); onDelete(); }
  };

  return (
    <div className="swipe">
      <div className="swipe-bg" aria-hidden="true">
        <span className={`swipe-act done${dx > 8 ? ' show' : ''}`}><Icon name="check" size={18} /> {doneLabel ?? t('row.swipeDone')}</span>
        <span className={`swipe-act del${dx < -8 ? ' show' : ''}`}>{t('row.swipeDelete')} <Icon name="trash" size={18} /></span>
      </div>
      <div className={`swipe-fg${settling ? ' settle' : ''}`} style={{ transform: dx ? `translateX(${dx}px)` : undefined, touchAction: 'pan-y' }}
        onPointerDown={down} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
        {children}
      </div>
    </div>
  );
}
