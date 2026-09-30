import { useEffect, useRef, type ReactNode } from 'react';
import { useI18n } from '../i18n';

// Modal bottom sheet: slides up, closes on Escape or a tap outside, locks page scroll, and lifts above the iOS keyboard.
export function Sheet({ label, onClose, children, tall }: { label: string; onClose: () => void; children: ReactNode; tall?: boolean }) {
  const overlay = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const { t } = useI18n();

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    window.addEventListener('keydown', onKey);
    const vv = window.visualViewport;
    const onVv = () => {
      if (!vv || !overlay.current) return;
      overlay.current.style.setProperty('--kb', `${Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop))}px`);
    };
    vv?.addEventListener('resize', onVv);
    vv?.addEventListener('scroll', onVv);
    onVv();
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
      vv?.removeEventListener('resize', onVv);
      vv?.removeEventListener('scroll', onVv);
    };
  }, []);

  return (
    <div className="overlay" ref={overlay} onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`sheet${tall ? ' tall' : ''}`} role="dialog" aria-modal="true" aria-label={label}>
        <button type="button" className="grab" aria-label={t('common.close')} onClick={onClose} />
        {children}
      </div>
    </div>
  );
}
