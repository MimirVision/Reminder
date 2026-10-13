import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { State } from '../core/controller.ts';
import { DELETE_WAY, placeActions } from '../core/folders.ts';
import { canMute } from '../core/tidy.ts';
import { isMine, threadKey } from '../core/threads.ts';
import type { FolderKind, Mail } from '../core/types.ts';
import { moveWay } from './Move.tsx';
import { Icon } from './ui.tsx';
import { go, useC } from './ctx.tsx';

/** What a right-click on a row stands for: the messages of that row, where they are (null: the inbox), and the one that is answered. */
export interface RowTarget { items: Mail[]; latest: Mail; rows: number; place: FolderKind | null; replyTo: Mail }

/** The menu of a right-click on a message in the list (computer only): the same actions as the buttons, without opening the message first. */
export function RowMenu({ s, t, x, y, onClose, onMove, onBlock }: { s: State; t: RowTarget; x: number; y: number; onClose: () => void; onMove: () => void; onBlock: () => void }) {
  const c = useC();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  useLayoutEffect(() => { const r = ref.current?.getBoundingClientRect(); if (r) setPos({ x: Math.max(8, Math.min(x, innerWidth - r.width - 8)), y: Math.max(8, Math.min(y, innerHeight - r.height - 8)) }); }, [x, y]);
  useEffect(() => {
    const down = (e: Event) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } };
    addEventListener('mousedown', down, true); addEventListener('keydown', key, true); addEventListener('blur', onClose); addEventListener('resize', onClose); addEventListener('wheel', onClose, { passive: true });
    return () => { removeEventListener('mousedown', down, true); removeEventListener('keydown', key, true); removeEventListener('blur', onClose); removeEventListener('resize', onClose); removeEventListener('wheel', onClose); };
  }, [onClose]);

  const inbox = t.place === null;
  const acts = placeActions(t.place ?? 'inbox');
  const unread = t.items.some((m) => !m.isRead);
  const flagged = t.items.some((m) => m.flagged);
  const done = (f: () => void) => () => { onClose(); f(); };
  const it = (icon: string, text: string, run: () => void, cls = '') => <button key={text} type="button" role="menuitem" className={`cm-it${cls ? ` ${cls}` : ''}`} onClick={done(run)}><Icon n={icon} size={18} />{text}</button>;
  const primary = inbox ? { label: 'Archive', icon: 'archive', run: () => void c.archive(t.items, t.rows) } : acts.primary ? { label: acts.primary.label, icon: acts.primary.icon, run: () => void moveWay(c, t.items, acts.primary!, t.rows) } : null;
  const muted = s.muted.some((m) => m.key === threadKey(t.latest));
  return (
    <div className="cm" role="menu" aria-label="Message actions" ref={ref} style={{ left: pos.x, top: pos.y }} onContextMenu={(e) => e.preventDefault()}>
      {primary && it(primary.icon, primary.label, primary.run)}
      {it('mail', unread ? 'Mark as read' : 'Mark as unread', () => void c.toggleRead(t.items))}
      {it('flag', flagged ? 'Remove flag' : 'Flag', () => void c.toggleFlag(t.items))}
      {it('folder', 'Move to…', onMove)}
      <div className="cm-sep" role="separator" />
      {!t.latest.draft && it('reply', 'Reply', () => go({ name: 'compose', mode: 'reply', account: t.replyTo.account, id: t.replyTo.id }))}
      {inbox && canMute(t.latest) && !muted && it('bellOff', 'Mute conversation', () => void c.muteConversation(t.latest))}
      {inbox && !isMine(t.latest) && it('ban', 'Block sender…', onBlock)}
      {acts.canDelete && <><div className="cm-sep" role="separator" />{it('trash', 'Delete', () => (inbox ? void c.trash(t.items, t.rows) : void moveWay(c, t.items, DELETE_WAY, t.rows)), 'bad')}</>}
    </div>
  );
}
