import { useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { canMoveInto, dropChoices, type Dest } from '../core/drop.ts';
import type { State } from '../core/controller.ts';
import { FOLDER_ICON } from '../core/folders.ts';
import type { FolderInfo, Mail } from '../core/types.ts';
import { Icon } from './ui.tsx';
import { dropOn } from './Move.tsx';
import { NewFolderSheet } from './NewFolder.tsx';
import { useC } from './ctx.tsx';

// Moving mail by holding a row and dragging it. On a computer the rows are dragged with the mouse onto the folders in the sidebar (see `dragging`).
// On a phone a long press lifts the row, a strip of folders slides in, and the row is dropped on one of them: by letting go of the finger over it,
// or, when the finger lets go anywhere else, by tapping one (so it works even where the dragging itself does not).

/** What is being dragged with the mouse. The browser only lets a drop read text, so the messages themselves are kept here. */
let dragged: { items: Mail[]; rows: number } | null = null;
export const dragging = () => dragged;
export function setDragging(d: { items: Mail[]; rows: number } | null) {
  dragged = d;
  if (typeof document !== 'undefined') document.body.classList.toggle('dragging-mail', !!d);
}

interface Carried { items: Mail[]; rows: number; over: string | null }

const dropAt = (x: number, y: number): string | null => {
  const el = typeof document !== 'undefined' && x >= 0 ? document.elementFromPoint(x, y)?.closest('[data-drop]') : null;
  return el?.getAttribute('data-drop') ?? null;
};

/** The state of a carry for one list: start it from a row, follow the finger, finish it, and the strip and sheet to put on the screen. */
export function useCarry(s: State, after?: () => void): { active: boolean; begin: (items: Mail[], rows: number) => void; move: (x: number, y: number) => void; end: (x: number, y: number) => void; strip: ReactNode; sheet: ReactNode } {
  const c = useC();
  const [carried, show] = useState<Carried | null>(null);
  const live = useRef<Carried | null>(null); // the same, for the finger events that come between two renders
  const setCarried = (v: Carried | null) => { live.current = v; show(v); };
  const [making, setMaking] = useState<Carried | null>(null);
  const close = () => setCarried(null);
  const choose = (id: string, from: Carried) => {
    const { standard, own } = dropChoices(s.folders, from.items);
    if (id === 'cancel') { close(); return; }
    if (id === 'new') { setMaking(from); close(); return; }
    const dest: Pick<FolderInfo, 'kind' | 'id' | 'name'> | undefined = id.startsWith('f:') ? own.find((f) => f.id === id.slice(2)) : standard.find((d) => d.kind === id);
    if (!dest) return;
    close();
    void dropOn(c, from.items, from.rows, dest);
    after?.();
  };
  return {
    active: !!carried,
    begin: (items, rows) => { void c.loadFolders(); setCarried({ items, rows, over: null }); },
    move: (x, y) => { const p = live.current; if (p) setCarried({ ...p, over: dropAt(x, y) }); },
    end: (x, y) => { const p = live.current; if (!p) return; const id = dropAt(x, y); if (id) choose(id, p); else setCarried({ ...p, over: null }); },
    strip: carried ? <CarryStrip s={s} carried={carried} onPick={(id) => choose(id, carried)} /> : null,
    sheet: making ? <NewFolderSheet s={s} items={making.items} rows={making.rows} onClose={() => setMaking(null)} onMade={after} /> : null,
  };
}

function CarryStrip({ s, carried, onPick }: { s: State; carried: Carried; onPick: (id: string) => void }) {
  const { standard, own, account } = dropChoices(s.folders, carried.items);
  const chip = (id: string, icon: string, text: string, small?: string) => (
    <button key={id} type="button" data-drop={id} className={`cchip${carried.over === id ? ' over' : ''}`} onClick={() => onPick(id)}>
      <Icon n={icon} size={18} /><span>{text}{small && <small>{small}</small>}</span>
    </button>
  );
  const n = carried.rows;
  return (
    <div className="carry" role="toolbar" aria-label="Drop on a folder">
      <div className="carry-h"><b>Move {n === 1 ? 'this message' : `${n} messages`} to…</b><button type="button" data-drop="cancel" className="link" onClick={() => onPick('cancel')}>Cancel</button></div>
      <div className="carry-chips">
        {standard.map((d: Dest) => chip(d.kind, FOLDER_ICON[d.kind], d.name))}
        {account && chip('new', 'plus', 'New folder…')}
        {own.map((f) => chip(`f:${f.id}`, 'folder', f.name, f.where || undefined))}
        {!account && <span className="note" style={{ margin: 0, alignSelf: 'center' }}>Messages from one mailbox can go to your folders.</span>}
      </div>
    </div>
  );
}

/** A button in the sidebar that messages can be dragged onto with the mouse: it lights up when they may be dropped there, and moves them when they are. */
export function DropButton({ s, dest, className = '', children, ...rest }: { s: State; dest: Pick<Dest, 'kind' | 'id' | 'name' | 'account'>; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const c = useC();
  const [over, setOver] = useState(false);
  const ok = () => { const d = dragging(); return !!d && canMoveInto(d.items, dest, s.folders); };
  return (
    <button {...rest} className={`${className}${over ? ' drop-on' : ''}`}
      onDragOver={(e) => { if (!ok()) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (!over) setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const d = dragging(); if (!d || !ok()) return; setDragging(null); void dropOn(c, d.items, d.rows, dest); }}>
      {children}
    </button>
  );
}
