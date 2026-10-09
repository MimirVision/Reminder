import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { cleanUpThreads, mailCounts, triageThreads, visibleThreads, type Counts, type State } from '../core/controller.ts';
import { dayGroup, displayName, shortTime } from '../core/format.ts';
import { isHorizontal, swipeOffset, swipeResult, tabSwipe, SWIPE_COMMIT } from '../../lib/swipe.ts';
import { digestThreads } from '../core/digest.ts';
import { threadWho, type Thread } from '../core/threads.ts';
import { KIND_TAB, mailKey, type Kind, type Mail } from '../core/types.ts';
import { Avatar, Banner, Icon, Sheet } from './ui.tsx';
import { go, labelOf, resolveAccount, useBadge, useC, useNow, useRoute } from './ctx.tsx';
import { Tabs } from './Tabs.tsx';
import { MoveSheet } from './Move.tsx';
import { setDragging, useCarry } from './Carry.tsx';

/** The small label on a row. Shown where mail of several kinds is mixed (All, search, Later); inside a tab it would only repeat the tab. */
const TAG: Record<Kind, string> = { person: '', transaction: 'Transaction', update: 'Update', promo: 'Promotion' };

/** How long a finger rests on a row before it is lifted (to be dropped on a folder). */
const LIFT_MS = 450;
/** A mouse drags rows onto the folders in the sidebar; a touch screen lifts them with a long press instead. */
const finePointer = () => typeof matchMedia === 'function' && matchMedia('(hover: hover) and (pointer: fine)').matches;

/**
 * A row you can swipe. `onTrash`: a small trash can at the side of it (always there on a phone, on hover on a computer) that deletes the message
 * without opening it. `drag`: the messages the row stands for, so it can be dragged onto a folder with the mouse. `onLift`, `onLiftMove`,
 * `onLiftEnd`: on a touch screen, a long press lifts the row and then reports where the finger is, and where it let go (see Carry.tsx).
 */
export function SwipeRow({ children, onRight, onLeft, rightLabel, leftLabel, rightIcon, leftIcon, disabled, leaving, onTrash, drag, onLift, onLiftMove, onLiftEnd }: { children: React.ReactNode; onRight: () => void; onLeft: () => void; rightLabel: string; leftLabel: string; rightIcon: string; leftIcon: string; disabled?: boolean; leaving?: boolean; onTrash?: () => void; drag?: () => { items: Mail[]; rows: number }; onLift?: () => void; onLiftMove?: (x: number, y: number) => void; onLiftEnd?: (x: number, y: number) => void }) {
  const [dx, setDx] = useState(0);
  const [settle, setSettle] = useState(false);
  const [held, setHeld] = useState(false);
  const st = useRef<{ x: number; y: number; t: number; id: number; live: boolean } | null>(null);
  const fg = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const carrying = useRef(false);
  const lastPt = useRef<{ x: number; y: number } | null>(null);
  const cb = useRef({ onLiftMove, onLiftEnd });
  cb.current = { onLiftMove, onLiftEnd };
  const stopTimer = () => { if (timer.current) { clearTimeout(timer.current); timer.current = undefined; } };
  const down = (e: React.PointerEvent) => {
    if (disabled || e.pointerType === 'mouse' || carrying.current) return;
    st.current = { x: e.clientX, y: e.clientY, t: e.timeStamp, id: e.pointerId, live: false };
    stopTimer();
    if (onLift) timer.current = setTimeout(() => {
      timer.current = undefined;
      if (!st.current || st.current.live) return;
      st.current = null; carrying.current = true; lastPt.current = null; setHeld(true); setDx(0);
      try { navigator.vibrate?.(12); } catch { /* not every phone can */ }
      onLift();
    }, LIFT_MS);
  };
  const move = (e: React.PointerEvent) => {
    const s = st.current; if (!s || carrying.current) return;
    const mx = e.clientX - s.x, my = e.clientY - s.y;
    if (timer.current && Math.hypot(mx, my) > 8) stopTimer();
    if (!s.live && isHorizontal(mx, my)) { s.live = true; (e.currentTarget as HTMLElement).setPointerCapture(s.id); }
    if (s.live) { setSettle(false); setDx(swipeOffset(mx)); }
  };
  const end = (e: React.PointerEvent) => {
    stopTimer();
    if (carrying.current) return; // the finger events below finish a lift
    const s = st.current; st.current = null;
    if (!s?.live) return;
    const r = swipeResult(e.clientX - s.x, e.clientY - s.y, e.timeStamp - s.t);
    setSettle(true); setDx(0);
    if (r === 'done') onRight(); else if (r === 'delete') onLeft();
  };
  // Once a row is lifted the page must not scroll under the finger: that needs listeners that may cancel the touch, which React's are not.
  useEffect(() => {
    const el = fg.current; if (!el || !onLift) return;
    const moveT = (e: TouchEvent) => { if (!carrying.current) return; if (e.cancelable) e.preventDefault(); const t = e.touches[0]; if (t) { lastPt.current = { x: t.clientX, y: t.clientY }; cb.current.onLiftMove?.(t.clientX, t.clientY); } };
    const endT = (e: TouchEvent) => {
      if (!carrying.current) return;
      carrying.current = false; setHeld(false);
      if (e.cancelable) e.preventDefault(); // so that letting go does not also open the message
      const t = e.changedTouches[0], last = lastPt.current; // where the finger was last seen, which is what was lit up under it
      if (e.type === 'touchend' && (last || t)) cb.current.onLiftEnd?.(last?.x ?? t.clientX, last?.y ?? t.clientY); else cb.current.onLiftEnd?.(-1, -1);
    };
    el.addEventListener('touchmove', moveT, { passive: false });
    el.addEventListener('touchend', endT, { passive: false });
    el.addEventListener('touchcancel', endT, { passive: false });
    return () => { el.removeEventListener('touchmove', moveT); el.removeEventListener('touchend', endT); el.removeEventListener('touchcancel', endT); stopTimer(); };
  }, [!!onLift]); // eslint-disable-line react-hooks/exhaustive-deps
  const strength = Math.min(1, Math.abs(dx) / SWIPE_COMMIT);
  const canDrag = !!drag && !disabled && finePointer();
  return (
    <div className={`sw-row${leaving ? ' leaving' : ''}`}>
      <div className="swipe-bg" aria-hidden="true" style={{ background: dx > 0 ? `color-mix(in srgb, var(--ink) ${Math.round(strength * 100)}%, var(--card))` : dx < 0 ? `color-mix(in srgb, var(--ac) ${Math.round(strength * 100)}%, var(--card))` : 'transparent', color: strength > .6 ? (dx > 0 ? 'var(--bg)' : 'var(--on)') : 'var(--mu)' }}>
        <span className={`l${dx > 8 ? ' show' : ''}`}><Icon n={rightIcon} size={18} />{rightLabel}</span>
        <span className={`r${dx < -8 ? ' show' : ''}`}>{leftLabel}<Icon n={leftIcon} size={18} /></span>
      </div>
      <div ref={fg} className={`swipe-fg${settle ? ' settle' : ''}${onTrash && !disabled ? ' has-trash' : ''}${held ? ' held' : ''}${onLift ? ' liftable' : ''}`} style={{ transform: dx ? `translateX(${dx}px)` : undefined }}
        onPointerDown={down} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
        onContextMenu={(e) => { if (carrying.current || timer.current || (e.nativeEvent as PointerEvent).pointerType === 'touch') e.preventDefault(); }}
        draggable={canDrag || undefined}
        onDragStart={canDrag ? (e) => { const d = drag!(); setDragging(d); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', d.rows === 1 ? 'One message' : `${d.rows} messages`); } : undefined}
        onDragEnd={canDrag ? () => setDragging(null) : undefined}>
        {children}
        {onTrash && !disabled && <button type="button" className="rowtrash" aria-label="Delete" title="Delete" onClick={(e) => { e.stopPropagation(); onTrash(); }}><Icon n="trash" size={19} /></button>}
      </div>
    </div>
  );
}

/** One row. With `thread` it is a conversation: it shows the newest message, who is in it, how many messages it holds, and anything unread, flagged or attached in it. */
export function Row({ m, thread, s, selecting, selected, onOpen, onToggle, active, tag = true, place, expanded }: { m: Mail; thread?: Thread; s: State; selecting: boolean; selected: boolean; onOpen: () => void; onToggle: () => void; active?: boolean; tag?: boolean; place?: string; expanded?: boolean }) {
  const badge = useBadge(s)(m.account);
  const count = thread?.items.length ?? 1;
  const unread = thread ? thread.unread > 0 : !m.isRead;
  // Mail you wrote (Sent, Drafts) is about who it went to, not who it is from.
  const wrote = !thread && (m.fk === 'sent' || m.fk === 'drafts');
  const who = thread ? threadWho(thread) : wrote ? (m.to ? `To: ${m.to}` : m.draft ? 'No recipient yet' : 'To: nobody') : displayName(m.fromName, m.fromAddress);
  const flagged = thread ? thread.items.some((x) => x.flagged) : m.flagged;
  const files = thread ? thread.items.some((x) => x.hasAttachments) : m.hasAttachments;
  // One sender's several conversations in one row (see core/digest.ts): the third line lists the other subjects, and a tap opens or folds the row.
  const members = thread?.members;
  const others = members ? members.slice(1, 4).map((x) => x.latest.subject || '(no subject)').join(' · ') + (members.length > 4 ? ` · +${members.length - 4}` : '') : '';
  return (
    <button type="button" className={`row ${s.settings.rowSize}${active ? ' active' : ''}${members ? ' digest' : ''}`} aria-current={active ? 'true' : undefined} aria-expanded={members && !selecting ? !!expanded : undefined} onClick={selecting ? onToggle : onOpen} aria-label={`${who}, ${m.subject}${members ? `, ${members.length} conversations, ${count} messages` : count > 1 ? `, ${count} messages` : ''}${unread ? ', unread' : ''}`}>
      {unread && !selecting && <span className="dot" />}
      {selecting && <span className={`chk${selected ? ' on' : ''}`} aria-hidden="true">{selected && <Icon n="check" size={14} />}</span>}
      {/* A message to several people shows the first one's initials: "Anna, Per +1" would otherwise make "A+". */}
      <Avatar m={wrote ? { fromName: m.to && !/, |\+\d+$/.test(m.to) ? m.to : '', fromAddress: m.toAddress ?? '', kind: 'person' } : m} badge={badge} />
      <span className="rb">
        <span className="r1"><span className={`who${unread ? ' u' : ''}${wrote && !m.to ? ' nobody' : ''}`}>{who}</span>{count > 1 && <span className={`cc${unread ? ' u' : ''}`} aria-hidden="true">{count}</span>}{m.draft && <span className="tg dr">Draft</span>}{place && <span className="tg">{place}</span>}{tag && !wrote && TAG[m.kind] && <span className="tg">{TAG[m.kind]}</span>}<span className={`tm${unread ? ' n' : ''}`}>{shortTime(m.received)}</span></span>
        <span className={`sj${unread ? ' u' : ''}`}>{m.subject || '(no subject)'}</span>
        <span className="r1"><span className="pv">{members ? `Also: ${others}` : m.preview}</span>{members && !selecting && <span className={`dchev${expanded ? ' on' : ''}`} aria-hidden="true"><Icon n="chev" size={16} /></span>}{files && <span className="pa"><Icon n="paperclip" size={15} /></span>}{flagged && <span className="pa" style={{ color: 'var(--at)' }}><Icon n="flag" size={15} /></span>}</span>
      </span>
    </button>
  );
}

export function StatusBanners({ s }: { s: State }) {
  const c = useC();
  const bad = s.accounts.filter((a) => a.needsSignIn);
  const unsorted = s.sorting ? s.mail.filter((m) => m.folder === 'inbox' && m.sig === undefined).length : 0;
  return (
    <>
      {bad.map((a) => <Banner key={a.email} tone="bad" icon="warn" action={<button onClick={() => go({ name: 'accounts' })}>Sign in</button>}><b>{a.label} needs you to sign in again</b>Mail keeps its place; nothing is lost.</Banner>)}
      {s.storage === 'memory' && <Banner tone="bad" icon="warn" action={<button onClick={() => go({ name: 'settings', page: 'health' })}>Details</button>}><b>Post cannot save on this phone right now</b>What you do here is kept only until Post is closed. Your mail is safe in Outlook.</Banner>}
      {!s.online && <Banner icon="wifi">No connection. Showing what is on this phone{s.waiting ? `; ${s.waiting} action${s.waiting > 1 ? 's' : ''} will go through when you are back online.` : '.'}</Banner>}
      {s.online && s.sync.error && !s.sync.running && <Banner tone="bad" icon="warn" action={<button onClick={() => void c.sync()}>Retry</button>}>{s.sync.error}</Banner>}
      {s.online && s.waiting > 0 && !s.sync.error && !s.sync.running && <Banner icon="refresh">{s.waiting} waiting to be sent to Outlook</Banner>}
      {s.erasing && <Banner icon="trash"><b>{s.erasing.what}… {s.erasing.total === null ? 'counting' : `${s.erasing.done} of ${s.erasing.total}`}</b>Keep Post open until it is done. This cannot be undone.</Banner>}
      {unsorted > 0 && <Banner icon="refresh"><b>Sorting your mail… {unsorted} left</b>It is all here already. This only decides which tab each message goes in.</Banner>}
    </>
  );
}

export function Inbox({ s, pane = false }: { s: State; pane?: boolean }) {
  const c = useC();
  const route = useRoute();
  const activeKey = route.name === 'message' ? mailKey(resolveAccount(s, route.account), route.id) : null;
  const keyOf = (t: Thread) => t.key;
  const now = useNow();
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(60);
  // Which way the list slides in when you change tab: towards the tab you are going to (All is the last one).
  const seen = useRef(s.view);
  const turn = useRef(0);
  if (seen.current !== s.view) { turn.current = VIEW_ORDER.indexOf(s.view) > VIEW_ORDER.indexOf(seen.current) ? 1 : -1; seen.current = s.view; }
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  const [scrolled, setScrolled] = useState(false);
  const [pull, setPull] = useState(0);
  const [cleaning, setCleaning] = useState(false);
  const [moving, setMoving] = useState(false);
  const cr = useCarry(s);
  // The rows of senders that are opened up to show their conversations.
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const fold = (k: string) => setOpened((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const pullStart = useRef<number | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);

  const list = useMemo(() => (s.settings.digest ? digestThreads(visibleThreads(s, now), s.view) : visibleThreads(s, now)), [s.mail, s.view, s.unreadOnly, s.accountFilter, s.settings.threads, s.settings.digest, now]); // eslint-disable-line react-hooks/exhaustive-deps
  const counts = useMemo(() => mailCounts(s, now), [s.mail, s.accountFilter, s.settings.threads, now]); // eslint-disable-line react-hooks/exhaustive-deps
  const viewUnread = s.view === 'all' ? counts.unread : counts.byKind[s.view].unread;
  const shown = list.slice(0, limit);
  const groups = useMemo(() => {
    const out: { name: string; items: Thread[] }[] = [];
    for (const t of shown) { const g = dayGroup(t.latest.received); const last = out[out.length - 1]; if (last?.name === g) last.items.push(t); else out.push({ name: g, items: [t] }); }
    return out;
  }, [shown.length, list]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = sentinel.current; if (!el || shown.length >= list.length) return;
    const io = new IntersectionObserver((e) => { if (e[0].isIntersecting) setLimit((n) => n + 60); }, { rootMargin: '400px' });
    io.observe(el); return () => io.disconnect();
  }, [shown.length, list.length]);

  const promos = s.view === 'promo' ? cleanUpThreads(s, now, 0) : [];
  // The button that starts Triage mode counts what Triage would go through: the unread rows of this tab, but for the flagged ones.
  const triage = useMemo(() => (pane ? 0 : triageThreads(s, now).length), [pane, s.mail, s.view, s.accountFilter, s.settings.threads, now]); // eslint-disable-line react-hooks/exhaustive-deps
  const scope = s.accountFilter ? labelOf(s, s.accountFilter) : s.accounts.length > 1 ? 'All accounts' : s.accounts[0]?.label ?? 'Inbox';
  const when = s.sync.running ? 'Updating…' : s.sync.at ? `Updated ${Math.max(0, Math.round((now - s.sync.at) / 60000)) < 1 ? 'just now' : `${Math.round((now - s.sync.at) / 60000)} min ago`}` : '';
  const toggle = (k: string) => setPicked((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const chosen = list.filter((t) => picked.has(t.key));
  const chosenMail = chosen.flatMap((t) => t.items);
  // How many rows of the list a choice is, for the toast: a sender's row stands for each of its conversations.
  const rowsOf = (ts: Thread[]) => ts.reduce((n, t) => n + (t.members?.length ?? 1), 0);
  const exit = () => { setSelecting(false); setPicked(new Set()); };
  // A row leaving the list shrinks away first, then the action runs, so the list closes up smoothly instead of jumping.
  const leave = (rows: Thread[], then: () => void) => {
    setLeaving((p) => new Set([...p, ...rows.map(keyOf)]));
    setTimeout(() => { then(); setLeaving((p) => { const n = new Set(p); rows.forEach((t) => n.delete(t.key)); return n; }); }, 200);
  };
  // Every action reaches the whole conversation (all its messages in the inbox), and the toast and the Undo count it once.
  const act = (t: Thread, a: 'archive' | 'read' | 'flag' | 'delete') => {
    const n = t.members?.length ?? 1;
    if (a === 'archive') leave([t], () => void c.archive(t.items, n)); else if (a === 'delete') leave([t], () => void c.trash(t.items, n)); else if (a === 'read') void c.toggleRead(t.items); else void c.toggleFlag(t.items);
  };
  const onScroll = (e: React.UIEvent<HTMLDivElement>) => { const t = e.currentTarget.scrollTop; setScrolled((x) => (x ? t > 8 : t > 48)); };
  const touchStart = (e: React.TouchEvent<HTMLDivElement>) => { pullStart.current = e.currentTarget.scrollTop <= 0 ? e.touches[0].clientY : null; };
  const touchMove = (e: React.TouchEvent<HTMLDivElement>) => { if (pullStart.current === null) return; const d = e.touches[0].clientY - pullStart.current; setPull(d > 0 ? Math.min(90, d * 0.5) : 0); };
  const touchEnd = () => { if (pull >= 44) void c.sync(); pullStart.current = null; setPull(0); };
  const lab: Record<string, string> = { archive: 'Archive', read: 'Read', flag: 'Flag', delete: 'Delete' };
  const ico: Record<string, string> = { archive: 'archive', read: 'eye', flag: 'flag', delete: 'trash' };

  return (
    <div className="pg">
      <header className={`hd${scrolled ? ' min' : ''}`}>
        <h1 className="h1">{pane ? (s.view === 'all' ? 'All mail' : KIND_TAB[s.view]) : 'Inbox'}</h1>
        <div className="r">
          {triage > 0 && !selecting && <button className="btn tri" aria-label={`Triage mode, ${triage} to go through`} onClick={() => go({ name: 'triage' })}><Icon n="cards" size={20} />Triage</button>}
          <button className="btn" aria-label={selecting ? 'Done selecting' : 'Select messages'} onClick={() => (selecting ? exit() : setSelecting(true))}><Icon n={selecting ? 'x' : 'select'} /></button>
          {!pane && <button className="btn me" aria-label="Accounts and settings" onClick={() => go({ name: 'accounts' })}>{(s.accounts[0]?.label ?? 'P')[0].toUpperCase()}</button>}
        </div>
      </header>
      <div className="sync-row">
        <button className="sync" onClick={() => void c.sync()} aria-label="Update now"><b>{scope}</b> · {when}{s.sync.running && <Icon n="refresh" size={16} className="spin" />}</button>
        <button className={`un${s.unreadOnly ? ' on' : ''}`} aria-pressed={s.unreadOnly} onClick={() => c.setUnreadOnly(!s.unreadOnly)}>Unread{viewUnread > 0 && <span className="n">{viewUnread > 99 ? '99+' : viewUnread}</span>}</button>
      </div>
      <div className={`fold${scrolled ? ' min' : ''}`}><div><button className="find" tabIndex={scrolled ? -1 : 0} onClick={() => go({ name: 'search', q: '' })}><Icon n="search" />Search mail</button></div></div>
      {!pane && <CategoryTabs s={s} counts={counts} />}
      <StatusBanners s={s} />
      <div className="pull" style={{ height: pull, opacity: Math.min(1, pull / 44) }} aria-hidden="true"><Icon n="refresh" size={20} className={pull >= 44 ? 'ready' : ''} /></div>
      <div className="scroll" onScroll={onScroll} onTouchStart={touchStart} onTouchMove={touchMove} onTouchEnd={touchEnd} onTouchCancel={touchEnd}>
        <div key={s.view} className={`vwrap${turn.current > 0 ? ' slide-next' : turn.current < 0 ? ' slide-prev' : ''}`}>
        {promos.length > 0 && !selecting && !s.unreadOnly && (
          <div className="cleanbar">
            <span className="ico"><Icon n="sparkle" size={20} /></span>
            <div><b>{promos.length} promotion{promos.length > 1 ? 's' : ''}</b><span>Archive the old ones in one tap</span></div>
            <button onClick={() => setCleaning(true)}>Clean up</button>
          </div>
        )}
        {groups.map((g) => (
          <section key={g.name}>
            <div className="sec">{g.name}</div>
            <div className="card">
              {g.items.map((t) => (
                <Fragment key={t.key}>
                  <SwipeRow leaving={leaving.has(t.key)} disabled={selecting || cr.active} onTrash={t.members ? undefined : () => act(t, 'delete')} drag={() => ({ items: t.items, rows: t.members?.length ?? 1 })} onLift={t.members ? undefined : () => cr.begin(t.items, 1)} onLiftMove={cr.move} onLiftEnd={cr.end} rightLabel={lab[s.settings.swipeRight]} leftLabel={lab[s.settings.swipeLeft]} rightIcon={ico[s.settings.swipeRight]} leftIcon={ico[s.settings.swipeLeft]} onRight={() => act(t, s.settings.swipeRight)} onLeft={() => act(t, s.settings.swipeLeft)}>
                    <Row m={t.latest} thread={t} s={s} tag={s.view === 'all'} active={!!activeKey && t.items.some((x) => x.key === activeKey)} selecting={selecting} selected={picked.has(t.key)} expanded={opened.has(t.key)} onToggle={() => toggle(t.key)} onOpen={() => (t.members ? fold(t.key) : go({ name: 'message', account: t.latest.account, id: t.latest.id }))} />
                  </SwipeRow>
                  {t.members && opened.has(t.key) && !selecting && (
                    <div className="dkids">
                      {t.members.map((x) => (
                        <SwipeRow key={x.key} leaving={leaving.has(x.key)} disabled={cr.active} onTrash={() => act(x, 'delete')} drag={() => ({ items: x.items, rows: 1 })} onLift={() => cr.begin(x.items, 1)} onLiftMove={cr.move} onLiftEnd={cr.end} rightLabel={lab[s.settings.swipeRight]} leftLabel={lab[s.settings.swipeLeft]} rightIcon={ico[s.settings.swipeRight]} leftIcon={ico[s.settings.swipeLeft]} onRight={() => act(x, s.settings.swipeRight)} onLeft={() => act(x, s.settings.swipeLeft)}>
                          <Row m={x.latest} thread={x} s={s} tag={false} active={!!activeKey && x.items.some((y) => y.key === activeKey)} selecting={false} selected={false} onToggle={() => {}} onOpen={() => go({ name: 'message', account: x.latest.account, id: x.latest.id })} />
                        </SwipeRow>
                      ))}
                    </div>
                  )}
                </Fragment>
              ))}
            </div>
          </section>
        ))}
        {list.length > shown.length && <div ref={sentinel}><button className="more" onClick={() => setLimit((n) => n + 60)}>Show more</button></div>}
        {!list.length && <Empty s={s} counts={counts} />}
        </div>
      </div>
      {selecting ? (
        <div className="bar sel" role="toolbar" aria-label="Actions for the selected messages">
          <button className="ib" aria-label="Select all" onClick={() => setPicked(new Set(list.map(keyOf)))}><Icon n="select" /></button>
          <button className="go" disabled={!chosen.length} onClick={() => { const rows = chosen, items = chosenMail; exit(); leave(rows, () => void c.archive(items, rowsOf(rows))); }}><Icon n="archive" />Archive {chosen.length || ''}</button>
          <button className="ib" aria-label="Mark read" disabled={!chosen.length} onClick={() => { const items = chosenMail; exit(); void c.markRead(items); }}><Icon n="eye" /></button>
          <button className="ib" aria-label="Move to a folder" disabled={!chosen.length} onClick={() => setMoving(true)}><Icon n="folder" /></button>
          <button className="ib" aria-label="Delete" disabled={!chosen.length} onClick={() => { const rows = chosen, items = chosenMail; exit(); leave(rows, () => void c.trash(items, rowsOf(rows))); }}><Icon n="trash" /></button>
        </div>
      ) : cr.active ? cr.strip : (
        <>
          {!pane && <Tabs at="inbox" s={s} />}
          {!pane && <button className="fab" aria-label="New message" onClick={() => go({ name: 'compose', mode: 'new' })}><Icon n="edit" size={26} /></button>}
        </>
      )}
      {cr.sheet}
      {cleaning && <CleanUpSheet s={s} onClose={() => setCleaning(false)} />}
      {moving && chosen.length > 0 && <MoveSheet s={s} items={chosenMail} rows={rowsOf(chosen)} inbox onClose={() => setMoving(false)} onMoved={() => { setMoving(false); exit(); }} />}
    </div>
  );
}

const VIEW_ORDER: State['view'][] = ['person', 'transaction', 'update', 'promo', 'all'];

/** Primary, Transactions, Updates, Promotions and All, each with what is unread in it. Nothing is hidden: All shows everything. */
export function CategoryTabs({ s, counts }: { s: State; counts: Counts }) {
  const c = useC();
  const ref = useRef<HTMLDivElement>(null);
  const tabs: [State['view'], string, number][] = [['person', KIND_TAB.person, counts.byKind.person.unread], ['transaction', KIND_TAB.transaction, counts.byKind.transaction.unread], ['update', KIND_TAB.update, counts.byKind.update.unread], ['promo', KIND_TAB.promo, counts.byKind.promo.unread], ['all', 'All', 0]];
  useEffect(() => { (ref.current?.querySelector('[aria-selected="true"]') as HTMLElement | null)?.scrollIntoView?.({ inline: 'center', block: 'nearest', behavior: 'smooth' }); }, [s.view]);
  // The row scrolls under the finger as usual. Only a hard, quick flick to the left jumps to All (like swiping all the way in iOS Mail).
  const st = useRef<{ x: number; y: number; t: number } | null>(null);
  const at = tabs.findIndex(([v]) => v === s.view);
  const down = (e: React.TouchEvent) => { const p = e.touches[0]; st.current = p ? { x: p.clientX, y: p.clientY, t: e.timeStamp } : null; };
  const end = (e: React.TouchEvent) => {
    const g = st.current; st.current = null;
    const p = e.changedTouches[0];
    if (!g || !p) return;
    const to = tabSwipe(p.clientX - g.x, p.clientY - g.y, e.timeStamp - g.t, at, tabs.length);
    if (to !== null) c.setView(tabs[to][0]);
  };
  return (
    <div className="pills" role="tablist" aria-label="Mail categories" ref={ref} onTouchStart={down} onTouchEnd={end} onTouchCancel={() => { st.current = null; }}>
      {tabs.map(([v, text, n]) => (
        <button key={v} role="tab" aria-selected={s.view === v} className={`pill${s.view === v ? ' on' : ''}`} onClick={() => c.setView(v)}>
          {text}{n > 0 && <span className="n" aria-label={`${n} unread`}>{n > 99 ? '99+' : n}</span>}
        </button>
      ))}
    </div>
  );
}

/** "Mostly from Elkjøp, Zalando and Coop": so you can see what a clean up would take before you tap it. */
function mostlyFrom(items: Mail[]): string {
  const n = new Map<string, number>();
  for (const m of items) { const who = displayName(m.fromName, m.fromAddress); n.set(who, (n.get(who) ?? 0) + 1); }
  const top = [...n.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([who]) => who);
  return top.length ? `Mostly from ${top.length > 1 ? `${top.slice(0, -1).join(', ')} and ${top[top.length - 1]}` : top[0]}.` : '';
}

function CleanUpSheet({ s, onClose }: { s: State; onClose: () => void }) {
  const c = useC();
  const now = useNow();
  // Rows of the Promotions tab, the same ones you see there: a conversation is one, however many messages are in it.
  const all = cleanUpThreads(s, now, 0);
  const old = cleanUpThreads(s, now, 7);
  const unread = visibleThreads({ mail: s.mail, view: 'promo', unreadOnly: true, accountFilter: s.accountFilter, settings: s.settings }, now);
  return (
    <Sheet title="Clean up Promotions" onClose={onClose}>
      <p className="note" style={{ margin: '2px 8px 12px' }}>{mostlyFrom(all.map((t) => t.latest))} Archived mail is moved to Archive, not deleted: search still finds it, and Undo works for a few seconds.</p>
      <div className="card">
        <button className="it" disabled={!old.length} onClick={() => { onClose(); void c.cleanUp(7); }}><span className="ico"><Icon n="archive" /></span>Archive older than a week<span className="v">{old.length}</span></button>
        <button className="it" disabled={!all.length} onClick={() => { onClose(); void c.cleanUp(0); }}><span className="ico"><Icon n="archive" /></span>Archive all promotions<span className="v">{all.length}</span></button>
        <button className="it" disabled={!unread.length} onClick={() => { onClose(); void c.markRead(unread.flatMap((t) => t.items)); }}><span className="ico"><Icon n="eye" /></span>Mark all as read<span className="v">{unread.length}</span></button>
      </div>
      <div className="card">
        <button className="it" onClick={() => { onClose(); go({ name: 'settings', page: 'sorting' }); }}><span className="ico"><Icon n="sliders" /></span>Do this by itself<span className="v">{s.settings.autoClean ? `After ${s.settings.autoClean} days` : 'Off'}<Icon n="chev" /></span></button>
      </div>
      <p className="note">Mail you flagged stays where it is. A sender that should not be here? Open one of its messages, tap Why, and move it.</p>
    </Sheet>
  );
}

function Empty({ s, counts }: { s: State; counts: Counts }) {
  const c = useC();
  if (!s.ready || (s.sync.running && !s.mail.length)) return <Skeleton />;
  if (!s.accounts.length) return <div className="empty"><span className="big">No account yet</span><button className="cta" style={{ marginTop: 16 }} onClick={() => go({ name: 'accounts' })}>Add an account</button></div>;
  if (s.sorting && counts.unsorted > 0 && s.view !== 'all') return <div className="empty"><span className="big">Sorting…</span>Post is reading your mail to put each message in the right tab. It shows up here in a moment.</div>;
  if (s.view !== 'all' || s.unreadOnly) {
    const name = s.view === 'all' ? 'your inbox' : KIND_TAB[s.view];
    const elsewhere = s.view === 'all' ? 0 : s.unreadOnly ? counts.unread - counts.byKind[s.view].unread : counts.total - counts.byKind[s.view].total;
    return (
      <div className="empty">
        <span className="big">{s.unreadOnly ? 'Nothing unread' : s.view === 'person' ? 'Primary is clear' : 'Nothing here'}</span>
        {s.unreadOnly ? `No unread mail in ${name}.` : `No mail in ${name} right now.`}
        {elsewhere > 0 && <> {elsewhere} more {s.unreadOnly ? 'unread ' : ''}in the other tabs.</>}
        <div style={{ marginTop: 14, display: 'flex', gap: 18, justifyContent: 'center', flexWrap: 'wrap' }}>
          {s.unreadOnly && <button className="link" onClick={() => c.setUnreadOnly(false)}>Show read mail too</button>}
          {s.view !== 'all' && <button className="link" onClick={() => c.setView('all')}>Show all mail</button>}
        </div>
      </div>
    );
  }
  return <div className="empty"><span className="big">Inbox zero</span>Nothing waiting. Enjoy it.</div>;
}

/** Grey placeholder rows while the very first sync runs (or a folder is being read), so the screen feels alive instead of blank. */
export function Skeleton({ label = 'Getting your mail…' }: { label?: string }) {
  return (
    <div role="status" aria-label={label.replace(/…$/, '')}>
      <div className="sec">{label}</div>
      <div className="card">{[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="row" style={{ opacity: 1 - i * 0.15 }}>
          <div className="avw"><div className="av sk" /></div>
          <div className="rb"><span className="sk-l" style={{ width: '45%' }} /><span className="sk-l" style={{ width: '80%' }} /><span className="sk-l" style={{ width: '65%', height: 10 }} /></div>
        </div>
      ))}</div>
    </div>
  );
}
