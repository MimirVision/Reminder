import { useEffect, useState } from 'react';
import type { Controller, State } from '../core/controller.ts';
import { destinationOf, FOLDER_ICON, FOLDER_NAME, GRAPH_NAME, type Way } from '../core/folders.ts';
import type { FolderInfo, FolderKind, Mail } from '../core/types.ts';
import { Icon, Sheet } from './ui.tsx';
import { useC } from './ctx.tsx';
import { NewFolderSheet } from './NewFolder.tsx';

/** Does one of the ways a person can send a message on (Archive, Delete, back to the inbox ...): the same words and the same Undo whichever screen it was done from. */
export function moveWay(c: Controller, items: Mail[], way: Way, rows: number = items.length) {
  if (way.to === 'archive') return c.archive(items, rows);
  if (way.to === 'deleted') return c.trash(items, rows);
  return c.moveTo(items, { to: GRAPH_NAME[way.to as Exclude<FolderKind, 'other'>], name: FOLDER_NAME[way.to] }, rows);
}

/** Drops messages on a place (archive, junk, one of your folders ...): the same words and the same Undo as Move to. */
export function dropOn(c: Controller, items: Mail[], rows: number, d: Pick<FolderInfo, 'kind' | 'id' | 'name'>) {
  if (d.kind === 'archive') return c.archive(items, rows);
  if (d.kind === 'deleted') return c.trash(items, rows);
  return c.moveTo(items, { to: destinationOf(d), name: d.name }, rows);
}

/** The standard places a message can go: never Drafts or Sent (Outlook keeps those for what you write). */
const STANDARD_TARGETS = ['inbox', 'archive', 'junk', 'deleted'] as const;

/**
 * "Move to…": where the messages can go. Inbox, Archive, Junk and Deleted first, then the folders of your own in their mailbox, each one a tap away.
 * Messages from several mailboxes can only go to the four standard places (a folder of your own belongs to one mailbox). `inbox`: the messages
 * are in the inbox on this phone, so Inbox is not offered; messages seen in a folder do not offer the folder they are in.
 */
export function MoveSheet({ s, items, rows = items.length, inbox = false, onClose, onMoved }: { s: State; items: Mail[]; rows?: number; inbox?: boolean; onClose: () => void; onMoved?: () => void }) {
  const c = useC();
  const [making, setMaking] = useState(false);
  useEffect(() => { void c.loadFolders(); }, [c]);
  const accounts = [...new Set(items.map((m) => m.account))];
  const one = accounts.length === 1 ? accounts[0] : null;
  const first = items[0];
  const here = first ? c.folderOf(first) : undefined;
  const placeKind: FolderKind | null = inbox ? 'inbox' : first?.fk ?? here?.kind ?? null;
  const own: FolderInfo[] = one ? s.folders.filter((f) => f.account === one && f.kind === 'other' && f.id !== first?.fid) : [];
  const standard: Pick<FolderInfo, 'kind' | 'id' | 'name' | 'where'>[] = STANDARD_TARGETS.filter((k) => k !== placeKind).map((kind) => ({ kind, id: '', name: FOLDER_NAME[kind], where: '' }));
  const pick = (f: Pick<FolderInfo, 'kind' | 'id' | 'name'>) => {
    onClose();
    void dropOn(c, items, rows, f);
    onMoved?.();
  };
  const row = (f: Pick<FolderInfo, 'kind' | 'id' | 'name' | 'where'>) => (
    <button key={`${f.kind}|${f.id}`} className="it" onClick={() => pick(f)}>
      <span className="ico"><Icon n={FOLDER_ICON[f.kind]} /></span>
      <span className="rw">{f.name}{f.where && <small>in {f.where}</small>}</span>
    </button>
  );
  return (
    <Sheet title="Move to…" onClose={onClose}>
      <div className="card">{standard.map(row)}</div>
      {one && own.length > 0 && <><div className="lbl">Your folders</div><div className="card">{own.map(row)}</div></>}
      {one && <div className="card"><button className="it" onClick={() => setMaking(true)}><span className="ico"><Icon n="plus" /></span><span className="rw">New folder…</span></button></div>}
      {one && !own.length && s.foldersLoading && <p className="note" role="status">Reading your folders…</p>}
      {one && !own.length && !s.foldersLoading && s.foldersError && <p className="note" role="status">Could not read your folders ({s.foldersError}) <button className="link" onClick={() => void c.loadFolders({ force: true })}>Try again</button></p>}
      {!one && <p className="note">These messages are in more than one mailbox. To move them to one of your own folders, choose messages from one mailbox.</p>}
      {making && one && <NewFolderSheet s={s} account={one} items={items} rows={rows} onClose={() => setMaking(false)} onMade={() => { onClose(); onMoved?.(); }} />}
    </Sheet>
  );
}
