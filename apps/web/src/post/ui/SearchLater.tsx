import { useEffect, useRef, useState } from 'react';
import type { State } from '../core/controller.ts';
import { replyLaterThreads } from '../core/controller.ts';
import { ARCHIVE_WAY, DELETE_WAY, FOLDER_NAME, placeActions } from '../core/folders.ts';
import type { FolderKind, Mail } from '../core/types.ts';
import { Icon } from './ui.tsx';
import { Row, SwipeRow } from './Inbox.tsx';
import { MoveSheet, moveWay } from './Move.tsx';
import { useCarry } from './Carry.tsx';
import { Tabs } from './Tabs.tsx';
import { go, openMail, useC, useNow } from './ctx.tsx';

const TIPS = ['from:anna', 'is:unread', 'has:attachment', 'in:promotions', 'account:work'];

export function Search({ s, q: initial, pane = false }: { s: State; q: string; pane?: boolean }) {
  const c = useC();
  const [q, setQ] = useState(initial);
  const [remote, setRemote] = useState<Mail[] | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  // What can be done to the results is what can be done in the inbox and in the folders: swipe, the can, select several, hold and drag to a folder.
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  const [gone, setGone] = useState<Set<string>>(new Set()); // results from Outlook that have been moved or deleted since they were listed
  const [moving, setMoving] = useState(false);
  const carried = useRef<Mail[]>([]);
  useEffect(() => { ref.current?.focus(); }, []);
  useEffect(() => { setRemote(null); setGone(new Set()); setSelecting(false); setPicked(new Set()); }, [q]);
  const local = q.trim() ? c.searchLocal(q) : [];
  const older = (remote ?? []).filter((m) => !gone.has(m.key));
  const hide = (rows: Mail[]) => setGone((p) => new Set([...p, ...rows.map((m) => m.key)]));
  const cr = useCarry(s, () => { hide(carried.current); });
  const kindOf = (m: Mail): FolderKind => m.fk ?? c.folderOf(m)?.kind ?? 'inbox';
  const leave = (rows: Mail[], then: () => void) => {
    setLeaving((p) => new Set([...p, ...rows.map((m) => m.key)]));
    setTimeout(() => { then(); hide(rows); setLeaving((p) => { const n = new Set(p); rows.forEach((m) => n.delete(m.key)); return n; }); }, 200);
  };
  const exit = () => { setSelecting(false); setPicked(new Set()); };
  const toggle = (k: string) => setPicked((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const everything = [...local, ...older];
  const chosen = everything.filter((m) => picked.has(m.key));
  const kinds = new Set(chosen.map(kindOf));
  const onlyKind = kinds.size === 1 ? [...kinds][0] : null;
  const primary = kinds.has('drafts') ? null : onlyKind ? placeActions(onlyKind).primary : ARCHIVE_WAY;
  // A message from Outlook that is not in the inbox says where it is; a draft opens in the editor, anything else in the reader.
  const placeOf = (m: Mail): string | undefined => { const f = c.folderOf(m); const k = m.fk ?? f?.kind; return !k || k === 'inbox' ? undefined : k === 'other' ? f?.name : FOLDER_NAME[k]; };
  const result = (m: Mail, place?: string) => {
    const kind = kindOf(m);
    const pa = placeActions(kind);
    const w = pa.swipe;
    const act = (way: typeof DELETE_WAY) => leave([m], () => void moveWay(c, [m], way));
    const drag = kind === 'drafts' ? undefined : () => ({ items: [m], rows: 1 });
    return (
      <SwipeRow key={m.key} leaving={leaving.has(m.key)} disabled={selecting || cr.active} onTrash={pa.canDelete ? () => act(DELETE_WAY) : undefined} drag={drag}
        onLift={drag ? () => { carried.current = [m]; cr.begin([m], 1); } : undefined} onLiftMove={cr.move} onLiftEnd={cr.end} onDragged={() => hide([m])}
        rightLabel={w.right.label} leftLabel={w.left.label} rightIcon={w.right.icon} leftIcon={w.left.icon} onRight={() => act(w.right)} onLeft={() => act(w.left)}>
        <Row m={m} s={s} selecting={selecting} selected={picked.has(m.key)} place={place} onOpen={() => openMail(m)} onToggle={() => toggle(m.key)} />
      </SwipeRow>
    );
  };
  const askOutlook = async () => { setBusy(true); try { setRemote(await c.searchRemote(q)); } finally { setBusy(false); } };

  return (
    <div className="pg">
      <div className="nav" style={{ paddingBottom: 4 }}>
        <div className="find" style={{ margin: 0, flex: 1, minWidth: 0, width: 'auto', color: 'var(--ink)' }}>
          <Icon n="search" />
          <input ref={ref} aria-label="Search mail" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search mail" enterKeyHint="search" autoCapitalize="none" autoCorrect="off" style={{ flex: 1, minWidth: 0, border: 0, background: 'transparent', outline: 'none', height: 44 }} />
          {q && <button className="btn plain" style={{ width: 32, height: 32 }} aria-label="Clear" onClick={() => { setQ(''); ref.current?.focus(); }}><Icon n="x" size={18} /></button>}
        </div>
        {everything.length > 0 && <button className="btn" aria-label={selecting ? 'Done selecting' : 'Select messages'} onClick={() => (selecting ? exit() : setSelecting(true))}><Icon n={selecting ? 'x' : 'select'} /></button>}
      </div>
      <div className="scroll">
        {!q.trim() && (
          <>
            <div className="lbl">Try</div>
            <div className="pills" style={{ flexWrap: 'wrap', overflow: 'visible' }}>{TIPS.map((t) => <button key={t} className="pill" onClick={() => { setQ((x) => `${x}${x && !x.endsWith(' ') ? ' ' : ''}${t}${t.endsWith(':') ? '' : ' '}`); ref.current?.focus(); }}>{t}</button>)}</div>
            <p className="note">Search runs on this phone, so it is instant and works offline. It understands æ ø å. Use the button under the results to search all of Outlook.</p>
          </>
        )}
        {q.trim() && (
          <>
            <div className="sec">{local.length ? `${local.length} on this phone` : 'Nothing on this phone'}</div>
            {local.length > 0 && <div className="card">{local.map((m) => result(m))}</div>}
            {remote === null ? <button className="more" disabled={busy} onClick={() => void askOutlook()}>{busy ? 'Searching Outlook…' : 'Search all of Outlook'}</button> : (
              <>
                <div className="sec">{older.length ? 'Older, from Outlook' : 'Nothing older in Outlook'}</div>
                {older.length > 0 && <div className="card">{older.map((m) => result(m, placeOf(m)))}</div>}
              </>
            )}
          </>
        )}
      </div>
      {selecting ? (
        <div className="bar sel" role="toolbar" aria-label="Actions for the selected messages">
          <button className="ib" aria-label="Select all" onClick={() => setPicked(new Set(everything.map((m) => m.key)))}><Icon n="select" /></button>
          {primary
            ? <button className="go" disabled={!chosen.length} onClick={() => { const rows = onlyKind ? chosen : chosen.filter((m) => kindOf(m) !== 'archive'); exit(); leave(rows, () => void moveWay(c, rows, primary, rows.length)); }}><Icon n={primary.icon} />{primary.label} {chosen.length || ''}</button>
            : <span className="go-gap" />}
          <button className="ib" aria-label="Mark read" disabled={!chosen.length || kinds.has('drafts')} onClick={() => { const rows = chosen; exit(); void c.markRead(rows); }}><Icon n="eye" /></button>
          <button className="ib" aria-label="Move to a folder" disabled={!chosen.length || kinds.has('drafts')} onClick={() => setMoving(true)}><Icon n="folder" /></button>
          <button className="ib" aria-label="Delete" disabled={!chosen.length || kinds.has('deleted')} onClick={() => { const rows = chosen; exit(); leave(rows, () => void c.trash(rows, rows.length)); }}><Icon n="trash" /></button>
        </div>
      ) : cr.active ? cr.strip : !pane && <Tabs at="search" s={s} />}
      {cr.sheet}
      {moving && chosen.length > 0 && <MoveSheet s={s} items={chosen} rows={chosen.length} onClose={() => setMoving(false)} onMoved={() => { setMoving(false); hide(chosen); exit(); }} />}
    </div>
  );
}

export function Later({ s, pane = false }: { s: State; pane?: boolean }) {
  const now = useNow();
  const later = replyLaterThreads(s, now);
  const open = (m: Mail) => go({ name: 'message', account: m.account, id: m.id });
  return (
    <div className="pg">
      <header className="hd"><h1 className="h1">Later</h1></header>
      <div className="scroll">
        <div className="sec">Reply later</div>
        {later.length ? <div className="card">{later.map((t) => <div key={t.key} className="sw-row"><Row m={t.latest} thread={t} s={s} selecting={false} selected={false} onOpen={() => open(t.latest)} onToggle={() => {}} /></div>)}</div> : <p className="note">Flagged messages show up here, so “I will answer that later” does not get lost.</p>}
      </div>
      {!pane && <Tabs at="later" s={s} />}
    </div>
  );
}
