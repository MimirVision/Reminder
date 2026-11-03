import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../i18n';
import { Icon } from './icons';

// Full-screen photo: arrows or swipe-free buttons (and the left/right keys) between the photos of a to-do, Escape or the cross closes it.
export function PhotoViewer({ urls, start = 0, onClose }: { urls: string[]; start?: number; onClose: () => void }) {
  const { t } = useI18n();
  const [i, setI] = useState(Math.min(Math.max(start, 0), Math.max(urls.length - 1, 0)));
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const step = (d: number) => setI((cur) => (cur + d + urls.length) % urls.length);

  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onCloseRef.current(); } // not also the sheet underneath
      else if (e.key === 'ArrowLeft') setI((cur) => (cur - 1 + urls.length) % urls.length);
      else if (e.key === 'ArrowRight') setI((cur) => (cur + 1) % urls.length);
    };
    window.addEventListener('keydown', onKey, true);
    return () => { document.body.style.overflow = prevOverflow; window.removeEventListener('keydown', onKey, true); };
  }, [urls.length]);

  if (urls.length === 0) return null;
  const label = t('photo.of', { n: i + 1, total: urls.length });
  return createPortal(
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={label} onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <img src={urls[i]} alt={label} />
      <div className="lightbox-bar">
        <span>{urls.length > 1 ? label : ''}</span>
        <span className="row">
          <a className="btn small" href={urls[i]} target="_blank" rel="noreferrer">{t('photo.newTab')}</a>
          <button ref={closeRef} type="button" className="btn small icon" onClick={onClose} aria-label={t('photo.close')}><Icon name="x" size={16} /></button>
        </span>
      </div>
      {urls.length > 1 && (
        <>
          <button type="button" className="lightbox-nav prev" onClick={() => step(-1)} aria-label={t('photo.prev')}><Icon name="chevron" size={22} /></button>
          <button type="button" className="lightbox-nav next" onClick={() => step(1)} aria-label={t('photo.next')}><Icon name="chevron" size={22} /></button>
        </>
      )}
    </div>,
    document.body,
  );
}
