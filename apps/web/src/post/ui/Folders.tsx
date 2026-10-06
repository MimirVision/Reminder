import { useEffect, useRef, useState } from 'react';
import { folderKey, mailCounts, type Draft, type FolderTarget, type State } from '../core/controller.ts';
import { dayGroup } from '../core/format.ts';
import { FOLDER_ICON, FOLDER_NAME, placeActions, STANDARD_KINDS, type Way } from '../core/folders.ts';
import type { Route } from '../core/route.ts';
import { mailKey, type FolderKind, type Mail } from '../core/types.ts';
import { Banner, Icon } from './ui.tsx';
import { folderTitle, go, labelOf, openMail, resolveAccount, routeOfFolder, useC, useNow, useRoute } from './ctx.tsx';
import { Row, Skeleton, StatusBanners, SwipeRow } from './Inbox.tsx';
import { moveWay } from './Move.tsx';
import { Tabs } from './Tabs.tsx';

// The Folders tab (what Outlook has besides the inbox), the list of one folder, and the folders in the sidebar of the computer layout.

/** What a folder shows next to its name: unread mail in the inbox and in Junk, how many drafts there are, nothing for the rest (unread mail that was archived or deleted is not news). */
const COUNTED: readonly FolderKind[] = ['inbox', 'drafts', 'junk', 'other'];

function countOf(s: State, kind: FolderKind, account: string | null, now: number): number {
  if (!COUNTED.includes(kind)) return 0;
  if (kind === 'inbox') return mailCounts({ mail: s.mail, accountFilter: account, settings: s.settings }, now).unread;
  return s.folders.filter((f) => f.kind === kind && (!account || f.account === account)).reduce((n, f) => n + (kind === 'drafts' ? f.total : f.unread), 0);
}

/** Pulling the list down reads it again, like the inbox. */
function usePull(onPull: () => void) {
  const [pull, setPull] = useState(0);
  const start = useRef<number | null>(null);
  const bind = {
    onTouchStart: (e: React.TouchEvent<HTMLDivElement>) => { start.current = e.currentTarget.scrollTop <= 0 ? e.touches[0].clientY : null; },
    onTouchMove: (e: React.TouchEvent<HTMLDivElement>) => { if (start.current === null) return; const d = e.touches[0].clientY - start.current; setPull(d > 0 ? Math.min(90, d * 0.5) : 0); },
    onTouchEnd: () => { if (pull >= 44) onPull(); start.current = null; setPull(0); },
    onTouchCancel: () => { start.current = null; setPull(0); },
  };
  return { pull, bind };
}

const Pull = ({ pull }: { pull: number }) => <div className="pull" style={{ height: pull, opacity: Math.min(1, pull / 44) }} aria-hidden="true"><Icon n="refresh" size={20} className={pull >= 44 ? 'ready' : ''} /></div>;

function FolderRow({ icon, name, n, drafts, depth = 0, where, onClick }: { icon: string; name: string; n: number; drafts?: boolean; depth?: number; where?: string; onClick: () => void }) {
  const said = n > 0 ? `, ${n} ${drafts ? (n === 1 ? 'draft' : 'drafts') : 'unread'}` : '';
  return (
    <button type="button" className={`it fr${depth ? ' nested' : ''}`} style={{ '--d': depth } as React.CSSProperties} aria-label={`${name}${said}`} onClick={onClick}>
      <span className="ico"><Icon n={icon} /></span>
      <span className="rw">{name}{where && <small>{where}</small>}</span>
      <span className="v">{n > 0 && <b className={`cnt${drafts ? ' mu' : ''}`}>{n > 999 ? '999+' : n}</b>}<Icon n="chev" size={16} /></span>
    </button>
  );
}

/** The Folders tab: Inbox, Drafts, Sent, Archive, Junk and Deleted, then the folders of your own (in each mailbox, with the ones inside them nested). */
export function FoldersScreen({ s }: { s: State }) {
  const c = useC();
  const now = useNow();
  const { pull, bind } = usePull(() => void c.loadFolders({ force: true }));
  useEffect(() => { void c.loadFolders(); }, [c, s.accounts.length]);
  const many = s.accounts.length > 1;
  const scope = many ? s.accountFilter : null;
  const mailboxes = s.accounts.filter((a) => !a.needsSignIn && (!scope || a.email === scope));
  const mine = (email: string) => s.folders.filter((f) => f.account === email && f.kind === 'other');
  return (
    <div className="pg">
      <header className="hd">
        <div><h1 className="h1">Folders</h1>{many && <p className="sub" style={{ marginTop: 4 }}>{scope ? labelOf(s, scope) : 'All accounts'}</p>}</div>
        <div className="r"><button className="btn me" aria-label="Accounts and settings" onClick={() => go({ name: 'accounts' })}>{(s.accounts[0]?.label ?? 'P')[0].toUpperCase()}</button></div>
      </header>
      <StatusBanners s={s} />
      {s.foldersError && !s.foldersLoading && <Banner tone="bad" icon="warn" action={<button onClick={() => void c.loadFolders({ force: true })}>Try again</button>}>{s.foldersError}</Banner>}
      <Pull pull={pull} />
      <div className="scroll" {...bind}>
        <div className="card" style={{ marginTop: 10 }}>
          {STANDARD_KINDS.map((kind) => (
            <FolderRow key={kind} icon={FOLDER_ICON[kind]} name={FOLDER_NAME[kind]} n={countOf(s, kind, scope, now)} drafts={kind === 'drafts'}
              onClick={() => go(routeOfFolder({ kind, ...(scope ? { account: scope } : {}) }))} />
          ))}
        </div>
        {mailboxes.map((a) => {
          const own = mine(a.email);
          const title = many ? `${a.label} · your folders` : 'Your folders';
          if (!own.length) {
            if (s.foldersLoading) return <div key={a.email}><div className="lbl">{title}</div><p className="note" role="status">Reading your folders…</p></div>;
            if (s.foldersError) return null; // the banner above says so
            return <div key={a.email}><div className="lbl">{title}</div><p className="note">None yet. Folders you make in Outlook show up here.</p></div>;
          }
          return (
            <div key={a.email}>
              <div className="lbl">{title}</div>
              <div className="card">
                {own.map((f) => <FolderRow key={f.id} icon="folder" name={f.name} n={f.unread} depth={f.depth} where={f.depth === 0 && f.where ? `in ${f.where}` : undefined} onClick={() => go(routeOfFolder({ kind: 'other', account: a.email, id: f.id }))} />)}
              </div>
            </div>
          );
        })}
        <p className="note">Outlook keeps these folders, so Post reads them when you open one and needs a connection to do it. Moving, archiving and deleting here work the same as in the inbox, with the same Undo.</p>
      </div>
      <Tabs at="folders" s={s} />
      <button className="fab" aria-label="New message" onClick={() => go({ name: 'compose', mode: 'new' })}><Icon n="edit" size={26} /></button>
    </div>
  );
}

const EMPTY: Record<FolderKind, [string, string]> = {
  inbox: ['Inbox zero', 'Nothing waiting.'],
  drafts: ['No drafts', 'A message you start and do not send waits here, and so does any draft from another app.'],
  sent: ['Nothing sent', 'Mail you send, from Post or any other app, is kept here.'],
  archive: ['Archive is empty', 'Mail you archive from the inbox is kept here.'],
  junk: ['No junk', 'Outlook puts mail it takes for junk here.'],
  deleted: ['Nothing deleted', 'Deleted mail waits here. Move it back to the inbox if you change your mind.'],
  other: ['Nothing here', 'This folder has no mail in it.'],
};

/** The message you were writing when you left it half done, which only this phone has: it is shown with the drafts so it is not forgotten. */
function unsentRoute(d: Draft): Route { return d.mode === 'new' ? { name: 'compose', mode: 'new' } : { name: 'compose', mode: d.mode, account: d.account, id: d.replyTo }; }

/** One folder: its messages from Outlook, newest first, a page at a time. In Sent and Drafts a row is about who the message went to. */
export function FolderList({ s, target, pane = false }: { s: State; target: FolderTarget; pane?: boolean }) {
  const c = useC();
  const route = useRoute();
  const now = useNow();
  const key = folderKey(target);
  const v = s.folder?.key === key ? s.folder : null; // the folder that was open before this one is not this one's list
  const title = folderTitle(s, target);
  const open = route.name === 'message' ? mailKey(resolveAccount(s, route.account), route.id) : route.name === 'compose' && route.mode === 'draft' && route.account && route.id ? mailKey(resolveAccount(s, route.account), route.id) : null;
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  const sentinel = useRef<HTMLDivElement>(null);
  const sentSeen = useRef(s.sent);
  const { pull, bind } = usePull(() => void c.refreshFolder());

  useEffect(() => { void c.loadFolders(); void c.openFolder(target); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  // Coming back to Post, or back online, shows what Outlook has now (a folder read a moment ago is not read again).
  useEffect(() => {
    const on = () => { if (document.visibilityState === 'visible') void c.openFolder(target); };
    document.addEventListener('visibilitychange', on);
    window.addEventListener('online', on);
    return () => { document.removeEventListener('visibilitychange', on); window.removeEventListener('online', on); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  // Something has just gone out: a moment later Sent and Drafts have changed at Outlook.
  useEffect(() => {
    if (s.sent === sentSeen.current) return;
    sentSeen.current = s.sent;
    if (target.kind !== 'sent' && target.kind !== 'drafts') return;
    const t = setTimeout(() => { void c.refreshFolder(); }, 2500);
    return () => clearTimeout(t);
  }, [s.sent]); // eslint-disable-line react-hooks/exhaustive-deps

  // The next page is read when the end of the list comes near.
  useEffect(() => {
    const el = sentinel.current; if (!el || !v?.more) return;
    const io = new IntersectionObserver((e) => { if (e[0].isIntersecting) void c.moreInFolder(); }, { rootMargin: '400px' });
    io.observe(el); return () => io.disconnect();
  }, [v?.items.length, v?.more, v?.paging, v?.state]); // eslint-disable-line react-hooks/exhaustive-deps

  const items = v?.items ?? [];
  const groups: { name: string; items: Mail[] }[] = [];
  for (const m of items) { const g = dayGroup(m.received); const last = groups[groups.length - 1]; if (last?.name === g) last.items.push(m); else groups.push({ name: g, items: [m] }); }

  const many = s.accounts.length > 1;
  const info = target.kind === 'other' ? s.folders.find((f) => f.account === target.account && f.id === target.id) : undefined;
  const scope = target.kind === 'other' ? [many && target.account ? labelOf(s, target.account) : '', info?.where ?? ''].filter(Boolean).join(' · ') : target.account ? labelOf(s, target.account) : many ? 'All accounts' : '';
  const ago = v?.at ? Math.max(0, Math.round((now - v.at) / 60000)) : 0;
  const when = v?.state === 'loading' ? 'Updating…' : v?.at ? `Updated ${ago < 1 ? 'just now' : `${ago} min ago`}` : '';
  const sub = [scope, when].filter(Boolean).join(' · ');

  // A row shrinks away first, then the action runs, so the list closes up smoothly instead of jumping (as in the inbox).
  const act = (m: Mail, way: Way) => {
    setLeaving((p) => new Set([...p, m.key]));
    setTimeout(() => { void moveWay(c, [m], way); setLeaving((p) => { const n = new Set(p); n.delete(m.key); return n; }); }, 200);
  };

  const local = target.kind === 'drafts' ? c.loadDraft() : null;
  const sig = (s.settings.signature ?? '').trim();
  // Edits to a draft that is at Outlook are not a message of their own: they come back when the draft is opened.
  const unsent = local && local.mode !== 'draft' && (!target.account || local.account === target.account) && (local.to.trim() || local.cc.trim() || local.subject.trim() || (local.body.trim() && local.body.trim() !== sig)) ? local : null;

  const failedNow = v?.state === 'failed';
  const noNet = v?.error === 'No connection.';

  return (
    <div className="pg">
      {!pane && <div className="nav"><button className="back" onClick={() => go({ name: 'folders' })} aria-label="Back to folders"><Icon n="back" />Folders</button></div>}
      <header className={`hd${pane ? '' : ' under'}`}>
        <div style={{ minWidth: 0 }}><h1 className="h1" style={{ overflowWrap: 'anywhere' }}>{title}</h1>{sub && <p className="sub" style={{ marginTop: 4 }}>{sub}</p>}</div>
        <div className="r"><button className="btn" aria-label="Update now" onClick={() => void c.refreshFolder()}><Icon n="refresh" /></button></div>
      </header>
      <StatusBanners s={s} />
      {v && v.error && !failedNow && <Banner tone="bad" icon="warn" action={<button onClick={() => void c.refreshFolder()}>Retry</button>}>{v.error} Showing what was read before.</Banner>}
      {v && v.partial.length > 0 && <Banner icon="warn" action={<button onClick={() => void c.refreshFolder()}>Retry</button>}>Could not read {v.partial.join(' and ')}. The rest is shown.</Banner>}
      <Pull pull={pull} />
      <div className="scroll" {...bind}>
        {unsent && (
          <section>
            <div className="sec">On this phone</div>
            <div className="card">
              <button type="button" className="row" onClick={() => go(unsentRoute(unsent))} aria-label={`Unsent message: ${unsent.subject.trim() || 'no subject'}`}>
                <div className="avw"><div className="av sq"><Icon n="edit" size={18} /></div></div>
                <span className="rb">
                  <span className="r1"><span className="who">{unsent.subject.trim() || '(no subject)'}</span><span className="tg dr">Not in Outlook yet</span></span>
                  <span className="sj">{unsent.to.trim() ? `To: ${unsent.to.trim()}` : 'No recipient yet'}</span>
                  <span className="r1"><span className="pv">{unsent.body.replace(/\s+/g, ' ').trim()}</span></span>
                </span>
              </button>
            </div>
          </section>
        )}
        {(!v || (v.state === 'loading' && !items.length)) && <Skeleton label={`Reading ${title}…`} />}
        {groups.map((g) => (
          <section key={g.name}>
            <div className="sec">{g.name}</div>
            <div className="card">
              {g.items.map((m) => {
                const w = placeActions(m.fk ?? target.kind).swipe;
                return (
                  <SwipeRow key={m.key} leaving={leaving.has(m.key)} rightLabel={w.right.label} leftLabel={w.left.label} rightIcon={w.right.icon} leftIcon={w.left.icon} onRight={() => act(m, w.right)} onLeft={() => act(m, w.left)}>
                    <Row m={m} s={s} tag={false} selecting={false} selected={false} active={m.key === open} onToggle={() => {}} onOpen={() => openMail(m)} />
                  </SwipeRow>
                );
              })}
            </div>
          </section>
        ))}
        {v?.more && <div ref={sentinel}>{v.paging ? <p className="note" role="status" style={{ textAlign: 'center', margin: '16px 0' }}>Reading more…</p> : <button className="more" onClick={() => void c.moreInFolder()}>Show more</button>}</div>}
        {v && v.state === 'ready' && !items.length && !unsent && <div className="empty"><span className="big">{EMPTY[target.kind][0]}</span>{EMPTY[target.kind][1]}</div>}
        {v && failedNow && (
          <div className="empty">
            <span className="big">{noNet ? 'No connection' : `Could not open ${title}`}</span>
            {noNet ? 'Folders are read from Outlook, so they need a connection.' : v.error}
            <div style={{ marginTop: 14 }}><button className="link" onClick={() => void c.refreshFolder()}>Try again</button></div>
          </div>
        )}
      </div>
      {!pane && <Tabs at="folders" s={s} />}
      {!pane && <button className="fab" aria-label="New message" onClick={() => go({ name: 'compose', mode: 'new' })}><Icon n="edit" size={26} /></button>}
    </div>
  );
}

/** The folders in the sidebar of the computer layout: Drafts, Sent, Archive, Junk and Deleted, then your own, nested. `active`: the key of the folder that is open. */
export function SidebarFolders({ s, active }: { s: State; active: string | null }) {
  const c = useC();
  const now = useNow();
  useEffect(() => {
    void c.loadFolders();
    const on = () => { if (document.visibilityState === 'visible') void c.loadFolders(); };
    document.addEventListener('visibilitychange', on);
    window.addEventListener('focus', on);
    return () => { document.removeEventListener('visibilitychange', on); window.removeEventListener('focus', on); };
  }, [c, s.accounts.length]);
  const many = s.accounts.length > 1;
  const scope = many ? s.accountFilter : null;
  const mailboxes = s.accounts.filter((a) => !a.needsSignIn && (!scope || a.email === scope));
  const item = (target: FolderTarget, icon: string, text: string, n: number, depth = 0, drafts = false) => {
    const k = folderKey(target);
    return (
      <button key={k} className={`sb-it${active === k ? ' on' : ''}`} style={depth ? { paddingLeft: 12 + depth * 16 } : undefined} aria-current={active === k ? 'page' : undefined} title={text} onClick={() => go(routeOfFolder(target))}>
        <Icon n={icon} size={20} /><span className="sb-t">{text}</span>{n > 0 && <span className={`sb-n${drafts ? ' mu' : ''}`}>{n > 99 ? '99+' : n}</span>}
      </button>
    );
  };
  return (
    <>
      <div className="sb-h">Folders</div>
      <nav className="sb-nav" aria-label="Folders">
        {STANDARD_KINDS.filter((kind) => kind !== 'inbox').map((kind) => item({ kind, ...(scope ? { account: scope } : {}) }, FOLDER_ICON[kind], FOLDER_NAME[kind], countOf(s, kind, scope, now), 0, kind === 'drafts'))}
      </nav>
      {mailboxes.map((a) => {
        const own = s.folders.filter((f) => f.account === a.email && f.kind === 'other');
        if (!own.length) return null;
        return (
          <div key={a.email}>
            {many && <div className="sb-h sub">{a.label}</div>}
            <nav className="sb-nav" aria-label={many ? `${a.label} folders` : 'Your folders'}>
              {own.map((f) => item({ kind: 'other', account: a.email, id: f.id }, 'folder', f.name, f.unread, f.depth))}
            </nav>
          </div>
        );
      })}
    </>
  );
}
