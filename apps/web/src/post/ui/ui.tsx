import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { initials, senderHue } from '../core/format.ts';
import type { Kind, Mail } from '../core/types.ts';

const P: Record<string, string> = {
  back: 'm15 6-6 6 6 6',
  chev: 'm9 6 6 6-6 6',
  down: 'm6 9 6 6 6-6',
  up: 'm6 15 6-6 6 6',
  check: 'm5 12 5 5L20 7',
  x: 'M6 6l12 12M18 6 6 18',
  plus: 'M12 5v14M5 12h14',
  search: 'M20 20l-3.5-3.5M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14z',
  select: 'm4 7 2 2 3-3M4 17l2 2 3-3M13 8h7M13 18h7',
  inbox: 'M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z',
  clock: 'M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  archive: 'M3 4h18v4H3zM5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8M10 12h4',
  trash: 'M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  reply: 'M9 7 4 12l5 5M4 12h9a7 7 0 0 1 7 7v1',
  replyAll: 'M7 7 2 12l5 5M12 7 7 12l5 5M7 12h6a7 7 0 0 1 7 7v1',
  forward: 'm15 7 5 5-5 5M20 12h-9a7 7 0 0 0-7 7v1',
  bell: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  paperclip: 'M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  send: 'm22 2-7 20-4-9-9-4zM22 2 11 13',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z',
  warn: 'M12 3 2 20h20zM12 10v4M12 17h.01',
  wifi: 'M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 20h.01M2 9a15 15 0 0 1 20 0',
  home: 'M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  mail: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM3 7l9 6 9-6',
  refresh: 'M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  sliders: 'M4 6h10M18 6h2M4 12h2M10 12h10M4 18h14M20 18h0M14 4v4M6 10v4M18 16v4',
  skip: 'm9 6 6 6-6 6',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  receipt: 'M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1zM16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8M12 17.5v-11',
  tag: 'M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4zM7.5 7.5h.01',
  sparkle: 'M11 3l1.8 5.2L18 10l-5.2 1.8L11 17l-1.8-5.2L4 10l5.2-1.8zM19 15l.8 2.2 2.2.8-2.2.8L19 21l-.8-2.2-2.2-.8 2.2-.8z',
  download: 'M12 3v12m0 0-4-4m4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2',
  share: 'M12 15V3m0 0L8 7m4-4 4 4M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8',
  minus: 'M5 12h14',
  file: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  pulse: 'M3 12h4l2.5-6 4 12 2.5-6H21',
  folder: 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z',
  ban: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM5.6 5.6l12.8 12.8',
  cards: 'M8 5h8M6 9h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z', // a card with the next one behind it: Triage mode
};

/** The icon of each tab, so the sidebar, the sheets and the settings agree. */
export const KIND_ICON: Record<Kind, string> = { person: 'user', transaction: 'receipt', update: 'bell', promo: 'tag' };

export function Icon({ n, size = 22, className }: { n: keyof typeof P | string; size?: number; className?: string }) {
  return <svg className={`ic${className ? ` ${className}` : ''}`} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><path d={P[n] ?? ''} /></svg>;
}

export function Mark({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <rect x="5" y="9" width="30" height="22" rx="3" fill="#fff" />
      <path d="M6 11l14 11L34 11" fill="none" stroke="#C8431F" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The colour of a sender's avatar: its hue, from the address. The stylesheet turns it into a tint that is checked for contrast (see avatarTone). */
export const avatarHue = (address: string, name = ''): CSSProperties => ({ '--h': senderHue(address, name) } as CSSProperties);

/** Circle = a person, rounded square = anything automatic (transaction, update, promotion). Every sender has their own tint, so people are easy to tell apart; unread and the account have their own marks (the dot and the small letter). */
export function Avatar({ m, badge }: { m: Pick<Mail, 'fromName' | 'fromAddress' | 'kind'>; badge?: { letter: string; colour: string } | null }) {
  const person = m.kind === 'person';
  return (
    <div className="avw">
      <div className={`av${person ? '' : ' sq'}`} style={avatarHue(m.fromAddress, m.fromName)}>{initials(m.fromName, m.fromAddress)}</div>
      {badge && <span className="ab" style={{ background: badge.colour }} aria-label={`Account ${badge.letter}`}>{badge.letter}</span>}
    </div>
  );
}

export function Sheet({ title, onClose, children, action }: { title: string; onClose: () => void; children: ReactNode; action?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-label={title} ref={ref} tabIndex={-1}>
        <div className="grab" />
        <div className="shh"><h2 className="h3">{title}</h2>{action}</div>
        {children}
      </div>
    </>
  );
}

export function Banner({ tone = 'warn', icon = 'warn', children, action }: { tone?: 'warn' | 'bad' | 'ok'; icon?: string; children: ReactNode; action?: ReactNode }) {
  return <div className={`bn bn-${tone}`} role="status"><Icon n={icon} size={18} /><div>{children}</div>{action}</div>;
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={`sw${on ? ' on' : ''}`} onClick={() => onChange(!on)} />;
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => <button key={v} type="button" role="radio" aria-checked={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>{text}</button>)}
    </div>
  );
}
