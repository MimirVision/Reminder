import { useEffect, useMemo, useRef, useState } from 'react';
import type { State } from '../core/controller.ts';
import type { FolderInfo, Mail } from '../core/types.ts';
import { Sheet } from './ui.tsx';
import { labelOf, useC } from './ctx.tsx';

/** How deep a new folder may sit: the Folders screen reads three levels, so a folder made deeper than that would not be listed. */
const MAX_PARENT_DEPTH = 1;

/**
 * "New folder": a name, and where it goes (at the top, in Inbox, or inside one of your folders, so a subfolder is made the same way as a folder).
 * With `items` it is the end of Move to: the folder is made and the messages go into it.
 */
export function NewFolderSheet({ s, account, parent, items, rows, onClose, onMade }: { s: State; account?: string; parent?: string; items?: Mail[]; rows?: number; onClose: () => void; onMade?: (f: FolderInfo) => void }) {
  const c = useC();
  const accounts = s.accounts.filter((a) => !a.needsSignIn);
  const fixed = account ?? (items?.length && new Set(items.map((m) => m.account)).size === 1 ? items[0].account : undefined);
  const [who, setWho] = useState<string>(fixed ?? (s.accountFilter && accounts.some((a) => a.email === s.accountFilter) ? s.accountFilter : accounts[0]?.email ?? ''));
  const [where, setWhere] = useState<string>(parent ?? '');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => { void c.loadFolders(); }, [c]);
  useEffect(() => { const t = setTimeout(() => field.current?.focus(), 50); return () => clearTimeout(t); }, []);
  const parents = useMemo(() => s.folders.filter((f) => f.account === who && f.kind === 'other' && f.depth <= MAX_PARENT_DEPTH), [s.folders, who]);
  useEffect(() => { if (where && where !== 'inbox' && !parents.some((f) => f.id === where)) setWhere(''); }, [parents, where]);
  const n = rows ?? items?.length ?? 0;
  const go = async () => {
    if (busy) return;
    setBusy(true); setError('');
    const r = items?.length ? await c.moveToNewFolder(items, who, name, where || null, rows) : await c.createFolder(who, name, where || null);
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    onClose();
    onMade?.(r.folder);
  };
  return (
    <Sheet title={items?.length ? 'Move to a new folder' : 'New folder'} onClose={onClose}>
      <div className="card" style={{ padding: 12 }}>
        <label className="lbl" htmlFor="nf-name" style={{ margin: '0 0 6px' }}>Name</label>
        <input id="nf-name" ref={field} className="field" style={{ height: 48 }} value={name} maxLength={200} placeholder="For example Customers" autoCapitalize="sentences" enterKeyHint="done" onChange={(e) => { setName(e.target.value); setError(''); }} onKeyDown={(e) => { if (e.key === 'Enter') void go(); }} />
        {!fixed && accounts.length > 1 && (
          <>
            <label className="lbl" htmlFor="nf-who" style={{ margin: '14px 0 6px' }}>In mailbox</label>
            <select id="nf-who" className="field" style={{ height: 48 }} value={who} onChange={(e) => setWho(e.target.value)}>{accounts.map((a) => <option key={a.email} value={a.email}>{labelOf(s, a.email)}</option>)}</select>
          </>
        )}
        <label className="lbl" htmlFor="nf-in" style={{ margin: '14px 0 6px' }}>Put it</label>
        <select id="nf-in" className="field" style={{ height: 48 }} value={where} onChange={(e) => setWhere(e.target.value)}>
          <option value="">At the top, next to Inbox</option>
          <option value="inbox">Inside Inbox</option>
          {parents.map((f) => <option key={f.id} value={f.id}>Inside {f.where ? `${f.where} / ` : ''}{f.name}</option>)}
        </select>
      </div>
      {error && <p className="note" role="alert" style={{ color: 'var(--bad)' }}>{error}</p>}
      <div className="card" style={{ marginTop: 12 }}>
        <button className="it" disabled={!name.trim() || busy || !who} onClick={() => void go()}><span className="rw"><b>{busy ? 'Making…' : n > 0 ? `Make folder and move ${n === 1 ? 'the message' : `${n} messages`}` : 'Make folder'}</b></span></button>
      </div>
      <p className="note">Folders are made in Outlook itself, so they show up in Outlook and on your other devices too.</p>
    </Sheet>
  );
}
