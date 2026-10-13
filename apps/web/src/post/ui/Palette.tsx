import { useEffect, useMemo, useRef, useState } from 'react';
import type { State, View } from '../core/controller.ts';
import { FOLDER_NAME } from '../core/folders.ts';
import { KIND_TAB, type FolderKind, type Mail } from '../core/types.ts';
import { dropOn } from './Move.tsx';
import { Icon } from './ui.tsx';
import { go, routeOfFolder, useC } from './ctx.tsx';

interface Cmd { id: string; group: string; icon: string; text: string; hint?: string; run: () => void }

const PLACES: FolderKind[] = ['drafts', 'sent', 'archive', 'junk', 'deleted'];
const TABS: View[] = ['person', 'transaction', 'update', 'promo', 'all'];

/**
 * Quick actions (Ctrl/Cmd+K): type a few letters to move the open message to a folder, jump to a tab or folder, or open a screen.
 * `items`: the open message (or conversation), when there is one; `rows` how many rows it stands for; `here`: where it is now, so that place is not offered.
 */
export function Palette({ s, items, rows, here, onClose }: { s: State; items: Mail[]; rows: number; here: FolderKind | null; onClose: () => void }) {
  const c = useC();
  const [q, setQ] = useState('');
  const [at, setAt] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { void c.loadFolders(); }, [c]);

  const cmds = useMemo(() => {
    const out: Cmd[] = [];
    const done = (f: () => void) => () => { onClose(); f(); };
    const accounts = [...new Set(items.map((m) => m.account))];
    const one = accounts.length === 1 ? accounts[0] : null;
    if (items.length) {
      const first = items[0];
      const std = (['inbox', 'archive', 'junk', 'deleted'] as FolderKind[]).filter((k) => k !== here);
      for (const kind of std) out.push({ id: `mv-${kind}`, group: 'Move this message to', icon: kind === 'inbox' ? 'inbox' : kind === 'archive' ? 'archive' : kind === 'junk' ? 'ban' : 'trash', text: FOLDER_NAME[kind], run: done(() => void dropOn(c, items, rows, { kind, id: '', name: FOLDER_NAME[kind] })) });
      if (one) for (const f of s.folders.filter((x) => x.account === one && x.kind === 'other' && x.id !== first.fid)) out.push({ id: `mv-${f.id}`, group: 'Move this message to', icon: 'folder', text: f.name, hint: f.where ? `in ${f.where}` : undefined, run: done(() => void dropOn(c, items, rows, f)) });
    }
    for (const v of TABS) out.push({ id: `tab-${v}`, group: 'Go to', icon: 'inbox', text: v === 'all' ? 'All mail' : KIND_TAB[v], run: done(() => { c.setView(v); go({ name: 'inbox' }); }) });
    for (const k of PLACES) out.push({ id: `go-${k}`, group: 'Go to', icon: 'folder', text: FOLDER_NAME[k], run: done(() => go(routeOfFolder({ kind: k }))) });
    for (const f of s.folders.filter((x) => x.kind === 'other')) out.push({ id: `go-${f.account}-${f.id}`, group: 'Go to', icon: 'folder', text: f.name, hint: s.accounts.length > 1 && f.where ? `in ${f.where}` : undefined, run: done(() => go(routeOfFolder({ kind: 'other', account: f.account, id: f.id }))) });
    out.push(
      { id: 'new', group: 'Do', icon: 'edit', text: 'New message', hint: 'c', run: done(() => go({ name: 'compose', mode: 'new' })) },
      { id: 'search', group: 'Do', icon: 'search', text: 'Search', hint: '/', run: done(() => go({ name: 'search', q: '' })) },
      { id: 'later', group: 'Do', icon: 'clock', text: 'Later', run: done(() => go({ name: 'later' })) },
      { id: 'triage', group: 'Do', icon: 'cards', text: 'Triage mode', run: done(() => go({ name: 'triage' })) },
      { id: 'refresh', group: 'Do', icon: 'refresh', text: 'Check for new mail', hint: 'g', run: done(() => void c.sync()) },
      { id: 'settings', group: 'Do', icon: 'sliders', text: 'Settings', run: done(() => go({ name: 'settings', page: '' })) },
    );
    return out;
  }, [c, s.folders, s.accounts.length, items, rows, here, onClose]);

  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = words.length ? cmds.filter((x) => words.every((w) => `${x.group} ${x.text} ${x.hint ?? ''}`.toLowerCase().includes(w))) : cmds;
  useEffect(() => setAt(0), [q]);
  useEffect(() => { (list.current?.querySelector('.on') as HTMLElement | null)?.scrollIntoView?.({ block: 'nearest' }); }, [at, q]);

  const key = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setAt((i) => Math.min(shown.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setAt((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); shown[at]?.run(); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };
  let last = '';
  return (
    <div className="pal-bg" onMouseDown={onClose}>
      <div className="pal" role="dialog" aria-label="Quick actions" onMouseDown={(e) => e.stopPropagation()}>
        <div className="pal-in"><Icon n="search" size={18} /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={key} placeholder={items.length ? 'Move this message, go to a folder, or do something…' : 'Go to a folder or do something…'} aria-label="Quick actions" role="combobox" aria-expanded="true" aria-controls="pal-list" /><kbd>Esc</kbd></div>
        <div className="pal-list" id="pal-list" role="listbox" ref={list}>
          {shown.map((x, i) => {
            const head = x.group !== last ? <div className="pal-h" role="presentation">{x.group}</div> : null;
            last = x.group;
            return <div key={x.id}>{head}<button type="button" role="option" aria-selected={i === at} className={`pal-it${i === at ? ' on' : ''}`} onMouseMove={() => setAt(i)} onClick={x.run}><Icon n={x.icon} size={18} /><span className="pal-t">{x.text}</span>{x.hint && <small>{x.hint}</small>}</button></div>;
          })}
          {!shown.length && <p className="pal-none">Nothing matches “{q}”.</p>}
        </div>
      </div>
    </div>
  );
}
