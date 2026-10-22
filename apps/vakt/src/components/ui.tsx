// Small building blocks shared by every screen: sheet, buttons, fields, chips, toast, confetti and a counting number.
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useStore } from '../data/store';

export const cn = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export function Button({ variant = 'soft', className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'soft' | 'ghost' | 'danger' }) {
  return (
    <button
      {...p}
      className={cn(
        'inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl px-5 text-[15px] font-semibold transition active:scale-[0.98] disabled:opacity-50',
        variant === 'primary' && 'hero text-white shadow-float',
        variant === 'soft' && 'bg-accent-soft text-accent-ink',
        variant === 'ghost' && 'text-ink-2',
        variant === 'danger' && 'bg-danger-soft text-danger',
        className,
      )}
    />
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('rounded-3xl bg-surface p-5 shadow-card', className)}>{children}</div>;
}

export function Label({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between gap-2">
      <span className="text-[13px] font-semibold text-ink-2">{children}</span>
      {hint && <span className="text-[12px] text-ink-3">{hint}</span>}
    </div>
  );
}

export const inputClass = 'w-full rounded-2xl border border-line bg-sunken px-4 py-3 text-ink outline-none transition focus:border-accent focus:bg-surface';

export function Chip({ active, onClick, children, className }: { active?: boolean; onClick?: () => void; children: ReactNode; className?: string }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'min-h-10 rounded-full px-4 text-[14px] font-medium transition active:scale-95',
        active ? 'bg-ink text-canvas' : 'bg-sunken text-ink-2',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
      className={cn('relative h-7 w-12 shrink-0 rounded-full transition', on ? 'bg-accent' : 'bg-line')}>
      <span className={cn('absolute top-0.5 size-6 rounded-full bg-white shadow transition-all', on ? 'left-[22px]' : 'left-0.5')} />
    </button>
  );
}

/** A panel that slides up from the bottom, like iOS sheets. Drag the top down to close it. */
export function Sheet({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const [drag, setDrag] = useState(0);
  const start = useRef<number | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);
  const handle = {
    onTouchStart: (e: React.TouchEvent) => { start.current = e.touches[0].clientY; },
    onTouchMove: (e: React.TouchEvent) => { if (start.current !== null) setDrag(Math.max(0, e.touches[0].clientY - start.current)); },
    onTouchEnd: () => { start.current = null; if (drag > 110) onClose(); else setDrag(0); },
  };
  // In a portal on <body>, so no scrolled or animated parent can change where the sheet sits.
  return createPortal(
    <div className="fixed inset-x-0 top-0 z-40 flex h-dvh flex-col justify-end" role="dialog" aria-modal aria-label={title}>
      <div className="absolute inset-0 animate-fade-in bg-black/40 backdrop-blur-[2px] transition-opacity" style={{ opacity: 1 - Math.min(drag / 400, 0.6) }} onClick={onClose} />
      <div className="relative mx-auto flex max-h-[92dvh] w-full max-w-lg animate-sheet-in flex-col rounded-t-[28px] bg-canvas shadow-[0_-10px_40px_-12px_rgb(0_0_0/0.3)]"
        style={{ transform: drag ? `translateY(${drag}px)` : undefined, transition: start.current === null ? 'transform 200ms ease-out' : 'none' }}>
        <div className="flex touch-none items-center justify-between px-5 pt-3 pb-2" {...handle}>
          <div className="absolute top-2 left-1/2 h-1 w-10 -translate-x-1/2 rounded-full bg-line" />
          <h2 className="mt-2 text-[19px] font-bold tracking-tight">{title}</h2>
          <button onClick={onClose} aria-label="Lukk" className="mt-2 grid size-9 place-items-center rounded-full bg-sunken text-ink-2 transition active:scale-90"><X className="size-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain px-5 pb-4">{children}</div>
        {footer && <div className="pb-safe border-t border-line bg-canvas px-5 pt-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** A number that counts up to its value, so new money feels like it arrives. */
export function CountUp({ value, format }: { value: number; format: (n: number) => string }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    if (start === value || matchMedia('(prefers-reduced-motion: reduce)').matches) { setShown(value); from.current = value; return; }
    const t0 = performance.now(), dur = 700;
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      setShown(start + (value - start) * e);
      if (k < 1) raf = requestAnimationFrame(step); else from.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); from.current = value; };
  }, [value]);
  return <>{format(shown)}</>;
}

/** A short burst of confetti from the bottom of the screen. */
export function confetti() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const c = document.createElement('canvas');
  const dpr = window.devicePixelRatio || 1;
  c.width = innerWidth * dpr; c.height = innerHeight * dpr;
  c.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:60';
  document.body.appendChild(c);
  const ctx = c.getContext('2d')!;
  ctx.scale(dpr, dpr);
  const colors = ['#7c3aed', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#f472b6'];
  const bits = Array.from({ length: 110 }, () => ({
    x: innerWidth / 2 + (Math.random() - 0.5) * 120, y: innerHeight * 0.85,
    vx: (Math.random() - 0.5) * 11, vy: -(Math.random() * 13 + 9),
    r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3, w: 6 + Math.random() * 6, h: 8 + Math.random() * 8,
    c: colors[Math.floor(Math.random() * colors.length)],
  }));
  const t0 = performance.now();
  const frame = (t: number) => {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const b of bits) {
      b.vy += 0.38; b.vx *= 0.99; b.x += b.vx; b.y += b.vy; b.r += b.vr;
      ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.r); ctx.fillStyle = b.c; ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h); ctx.restore();
    }
    if (t - t0 < 2600) requestAnimationFrame(frame); else c.remove();
  };
  requestAnimationFrame(frame);
}

export function ToastView() {
  const { toastState: t } = useStore();
  if (!t) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center px-4" role="status" aria-live="polite">
      <div key={t.id} className={cn('pointer-events-auto flex animate-pop-in items-center gap-3 rounded-2xl px-4 py-3 text-[14.5px] font-medium shadow-card',
        t.error ? 'bg-danger text-white' : 'bg-ink text-canvas')}>
        <span>{t.text}</span>
        {t.undo && <button className="font-bold text-rose" onClick={t.undo}>Angre</button>}
      </div>
    </div>
  );
}

/** A number field that keeps what she types (also "260,50") and reports a number, or null when empty. */
export function NumberInput({ value, onChange, placeholder, suffix, id, ariaLabel }: { value: number | null; onChange: (n: number | null) => void; placeholder?: string; suffix?: string; id?: string; ariaLabel?: string }) {
  const [text, setText] = useState(value === null ? '' : String(value).replace('.', ','));
  useEffect(() => {
    const parsed = text.trim() === '' ? null : Number(text.replace(/\s/g, '').replace(',', '.'));
    if (parsed !== value) setText(value === null ? '' : String(value).replace('.', ','));
    // Only when the value changes from outside, so typing "260," isn't rewritten to "260".
  }, [value]);
  return (
    <div className="relative">
      <input id={id} aria-label={ariaLabel} inputMode="decimal" className={cn(inputClass, suffix && 'pr-16')} placeholder={placeholder} value={text}
        onChange={(e) => {
          setText(e.target.value);
          const t = e.target.value.replace(/\s/g, '').replace(',', '.');
          if (t === '') onChange(null);
          else if (!Number.isNaN(Number(t))) onChange(Number(t));
        }} />
      {suffix && <span className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-[14px] text-ink-3">{suffix}</span>}
    </div>
  );
}
