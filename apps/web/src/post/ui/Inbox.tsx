import { useEffect, useMemo, useRef, useState } from 'react';
import { cleanUpList, mailCounts, visibleMail, type Counts, type State } from '../core/controller.ts';
import { dayGroup, displayName, shortTime } from '../core/format.ts';
import { isHorizontal, swipeOffset, swipeResult, SWIPE_COMMIT } from '../../lib/swipe.ts';
import { KIND_TAB, mailKey, type Kind, type Mail } from '../core/types.ts';
import { presets } from '../core/snooze.ts';
import { Avatar, Banner, Icon, Sheet } from './ui.tsx';
import { go, labelOf, resolveAccount, useBadge, useC, useNow, useRoute } from './ctx.tsx';
import { Tabs } from './Tabs.tsx';

/** The small label on a row. Shown where mail of several kinds is mixed (All, search, Later); inside a tab it would only repeat the tab. */
const TAG: Record<Kind, string> = { person: '', transaction: 'Transaction', update: 'Update', promo: 'Promotion' };

export function SwipeRow({ children, onRight, onLeft, rightLabel, leftLabel, rightIcon, leftIcon, disabled, leaving }: { children: React.ReactNode; onRight: () => void; onLeft: () => void; rightLabel: string; leftLabel: string; rightIcon: string; leftIcon: string; disabled?: boolean; leaving?: boolean }) {
  const [dx, setDx] = useState(0);
  const [settle, setSettle] = useState(false);
  const st = useRef<{ x: number; y: number; t: number; id: number; live: boolean } | null>(null);
  const down = (e: React.PointerEvent) => { if (disabled || e.pointerType === 'mouse') return; st.current = { x: e.clientX, y: e.clientY, t: e.timeStamp, id: e.pointerId, live: false }; };
  const move = (e: React.PointerEvent) => {
    const s = st.current; if (!s) return;
    const mx = e.clientX - s.x, my = e.clientY - s.y;
    if (!s.live && isHorizontal(mx, my)) { s.live = true; (e.currentTarget as HTMLElement).setPointerCapture(s.id); }
    if (s.live) { setSettle(false); setDx(swipeOffset(mx)); }
  };
  const end = (e: React.PointerEvent) => {
    const s = st.current; st.current = null;
    if (!s?.live) return;
    const r = swipeResult(e.clientX - s.x, e.clientY - s.y, e.timeStamp - s.t);
    setSettle(true); setDx(0);
    if (r === 'done') onRight(); else if (r === 'delete') onLeft();
  };
  const strength = Math.min(1, Math.abs(dx) / SWIPE_COMMIT);
  return (
    <div className={`sw-row${leaving ? ' leaving' : ''}`}>
      <div className="swipe-bg" aria-hidden="true" style={{ background: dx > 0 ? `color-mix(in srgb, var(--ink) ${Math.round(strength * 100)}%, var(--card))` : dx < 0 ? `color-mix(in srgb, var(--ac) ${Math.round(strength * 100)}%, var(--card))` : 'transparent', color: strength > .6 ? (dx > 0 ? 'var(--bg)' : 'var(--on)') : 'var(--mu)' }}>
        <span className={`l${dx > 8 ? ' show' : ''}`}><Icon n={rightIcon} size={18} />{rightLabel}</span>
        <span className={`r${dx < -8 ? ' show' : ''}`}>{leftLabel}<Icon n={leftIcon} size={18} /></span>
      </div>
      <div className={`swipe-fg${settle ? ' settle' : ''}`} style={{ transform: dx ? `translateX(${dx}px)` : undefined }} onPointerDown={down} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>{children}</div>
    </div>
  );
}

export function Row({ m, s, selecting, selected, onOpen, onToggle, active, tag = true }: { m: Mail; s: State; selecting: boolean; selected: boolean; onOpen: () => void; onToggle: () => void; active?: boolean; tag?: boolean }) {
  const badge = useBadge(s)(m.account);
  const unread = !m.isRead;
  return (
    <button type="button" className={`row ${s.settings.rowSize}${active ? ' active' : ''}`} aria-current={active ? 'true' : undefined} onClick={selecting ? onToggle : onOpen} aria-label={`${displayName(m.fromName, m.fromAddress)}, ${m.subject}${unread ? ', unread' : ''}`}>
      {unread && !selecting && <span className="dot" />}
      {selecting && <span className={`chk${selected ? ' on' : ''}`} aria-hidden="true">{selected && <Icon n="check" size={14} />}</span>}
      <Avatar m={m} badge={badge} />
      <span className="rb">
        <span className="r1"><span className={`who${unread ? ' u' : ''}`}>{displayName(m.fromName, m.fromAddress)}</span>{tag && TAG[m.kind] && <span className="tg">{TAG[m.kind]}</span>}<span className={`tm${unread ? ' n' : ''}`}>{shortTime(m.received)}</span></span>
        <span className={`sj${unread ? ' u' : ''}`}>{m.subject || '(no subject)'}</span>
        <span className="r1"><span className="pv">{m.preview}</span>{m.hasAttachments && <span className="pa"><Icon n="paperclip" size={15} /></span>}{m.flagged && <span className="pa" style={{ color: 'var(--at)' }}><Icon n="flag" size={15} /></span>}</span>
      </span>
    </button>
  );
}

export function SnoozeSheet({ onPick, onClose }: { onPick: (at: Date, label: string) => void; onClose: () => void }) {
  const list = presets(new Date());
  const name: Record<string, string> = { later: 'Later today', tomorrow: 'Tomorrow', weekend: 'This weekend', monday: 'Monday', nextweek: 'Next week' };
  return (
    <Sheet title="Snooze until…" onClose={onClose}>
      <div className="card">
        {list.map((p) => {
          const label = `${p.at.toLocaleDateString('en-GB', { weekday: 'short' })} ${p.at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
          return <button key={p.id} className="it" onClick={() => onPick(p.at, label)}><span className="ico"><Icon n="clock" /></span>{name[p.id]}<span className="v">{label}</span></button>;
        })}
      </div>
      <p className="note">The message stays in your mailbox. It comes back to the top of your inbox at that time, when you open Post. Nothing rings.</p>
    </Sheet>
  );
}

export function StatusBanners({ s }: { s: State }) {
  const c = useC();
  const bad = s.accounts.filter((a) => a.needsSignIn);
  const unsorted = s.sorting ? s.mail.filter((m) => m.folder === 'inbox' && m.sig === undefined).length : 0;
  return (
    <>
      {bad.map((a) => <Banner key={a.email} tone="bad" icon="warn" action={<button onClick={() => go({ name: 'accounts' })}>Sign in</button>}><b>{a.label} needs you to sign in again</b>Mail keeps its place; nothing is lost.</Banner>)}
      {!s.online && <Banner icon="wifi">No connection. Showing what is on this phone{s.waiting ? `; ${s.waiting} action${s.waiting > 1 ? 's' : ''} will go through when you are back online.` : '.'}</Banner>}
      {s.online && s.sync.error && !s.sync.running && <Banner tone="bad" icon="warn" action={<button onClick={() => void c.sync()}>Retry</button>}>{s.sync.error}</Banner>}
      {s.online && s.waiting > 0 && !s.sync.error && !s.sync.running && <Banner icon="refresh">{s.waiting} waiting to be sent to Outlook</Banner>}
      {unsorted > 0 && <Banner icon="refresh"><b>Sorting your mail… {unsorted} left</b>It is all here already. This only decides which tab each message goes in.</Banner>}
    </>
  );
}

export function Inbox({ s, pane = false }: { s: State; pane?: boolean }) {
  const c = useC();
  const route = useRoute();
  const activeKey = route.name === 'message' ? mailKey(resolveAccount(s, route.account), route.id) : null;
  const now = useNow();
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [snoozing, setSnoozing] = useState<Mail | null>(null);
  const [limit, setLimit] = useState(60);
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  const [scrolled, setScrolled] = useState(false);
  const [pull, setPull] = useState(0);
  const [cleaning, setCleaning] = useState(false);
  const pullStart = useRef<number | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);

  const list = useMemo(() => visibleMail(s, now), [s.mail, s.view, s.unreadOnly, s.accountFilter, now]); // eslint-disable-line react-hooks/exhaustive-deps
  const counts = useMemo(() => mailCounts(s, now), [s.mail, s.accountFilter, now]); // eslint-disable-line react-hooks/exhaustive-deps
  const viewUnread = s.view === 'all' ? counts.unread : counts.byKind[s.view].unread;
  const shown = list.slice(0, limit);
  const groups = useMemo(() => {
    const out: { name: string; items: Mail[] }[] = [];
    for (const m of shown) { const g = dayGroup(m.received); const last = out[out.length - 1]; if (last?.name === g) last.items.push(m); else out.push({ name: g, items: [m] }); }
    return out;
  }, [shown.length, list]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = sentinel.current; if (!el || shown.length >= list.length) return;
    const io = new IntersectionObserver((e) => { if (e[0].isIntersecting) setLimit((n) => n + 60); }, { rootMargin: '400px' });
    io.observe(el); return () => io.disconnect();
  }, [shown.length, list.length]);

  const promos = s.view === 'promo' ? cleanUpList(s, now, 0) : [];
  const scope = s.accountFilter ? labelOf(s, s.accountFilter) : s.accounts.length > 1 ? 'All accounts' : s.accounts[0]?.label ?? 'Inbox';
  const when = s.sync.running ? 'Updating…' : s.sync.at ? `Updated ${Math.max(0, Math.round((now - s.sync.at) / 60000)) < 1 ? 'just now' : `${Math.round((now - s.sync.at) / 60000)} min ago`}` : '';
  const toggle = (k: string) => setPicked((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const chosen = list.filter((m) => picked.has(m.key));
  const exit = () => { setSelecting(false); setPicked(new Set()); };
  // A message leaving the list shrinks away first, then the action runs, so the list closes up smoothly instead of jumping.
  const leave = (items: Mail[], then: () => void) => {
    setLeaving((p) => new Set([...p, ...items.map((m) => m.key)]));
    setTimeout(() => { then(); setLeaving((p) => { const n = new Set(p); items.forEach((m) => n.delete(m.key)); return n; }); }, 200);
  };
  const act = (m: Mail, a: 'archive' | 'read' | 'flag' | 'delete' | 'snooze') => {
    if (a === 'archive') leave([m], () => void c.archive([m])); else if (a === 'delete') leave([m], () => void c.trash([m])); else if (a === 'read') void c.setRead(m, !m.isRead); else if (a === 'flag') void c.setFlag(m, !m.flagged); else setSnoozing(m);
  };
  const onScroll = (e: React.UIEvent<HTMLDivElement>) => { const t = e.currentTarget.scrollTop; setScrolled((x) => (x ? t > 8 : t > 48)); };
  const touchStart = (e: React.TouchEvent<HTMLDivElement>) => { pullStart.current = e.currentTarget.scrollTop <= 0 ? e.touches[0].clientY : null; };
  const touchMove = (e: React.TouchEvent<HTMLDivElement>) => { if (pullStart.current === null) return; const d = e.touches[0].clientY - pullStart.current; setPull(d > 0 ? Math.min(90, d * 0.5) : 0); };
  const touchEnd = () => { if (pull >= 44) void c.sync(); pullStart.current = null; setPull(0); };
  const lab: Record<string, string> = { archive: 'Archive', read: 'Read', flag: 'Flag', delete: 'Delete', snooze: 'Snooze' };
  const ico: Record<string, string> = { archive: 'archive', read: 'eye', flag: 'flag', delete: 'trash', snooze: 'clock' };

  return (
    <div className="pg">
      <header className={`hd${scrolled ? ' min' : ''}`}>
        <h1 className="h1">{pane ? (s.view === 'all' ? 'All mail' : KIND_TAB[s.view]) : 'Inbox'}</h1>
        <div className="r">
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
              {g.items.map((m) => (
                <SwipeRow key={m.key} leaving={leaving.has(m.key)} disabled={selecting} rightLabel={lab[s.settings.swipeRight]} leftLabel={lab[s.settings.swipeLeft]} rightIcon={ico[s.settings.swipeRight]} leftIcon={ico[s.settings.swipeLeft]} onRight={() => act(m, s.settings.swipeRight)} onLeft={() => act(m, s.settings.swipeLeft)}>
                  <Row m={m} s={s} tag={s.view === 'all'} active={m.key === activeKey} selecting={selecting} selected={picked.has(m.key)} onToggle={() => toggle(m.key)} onOpen={() => go({ name: 'message', account: m.account, id: m.id })} />
                </SwipeRow>
              ))}
            </div>
          </section>
        ))}
        {list.length > shown.length && <div ref={sentinel}><button className="more" onClick={() => setLimit((n) => n + 60)}>Show more</button></div>}
        {!list.length && <Empty s={s} counts={counts} />}
      </div>
      {selecting ? (
        <div className="bar sel" role="toolbar" aria-label="Actions for the selected messages">
          <button className="ib" aria-label="Select all" onClick={() => setPicked(new Set(list.map((m) => m.key)))}><Icon n="select" /></button>
          <button className="go" disabled={!chosen.length} onClick={() => { const items = chosen; exit(); leave(items, () => void c.archive(items)); }}><Icon n="archive" />Archive {chosen.length || ''}</button>
          <button className="ib" aria-label="Mark read" disabled={!chosen.length} onClick={() => { const items = chosen; exit(); void c.markRead(items); }}><Icon n="eye" /></button>
          <button className="ib" aria-label="Delete" disabled={!chosen.length} onClick={() => { const items = chosen; exit(); leave(items, () => void c.trash(items)); }}><Icon n="trash" /></button>
        </div>
      ) : (
        <>
          {!pane && <Tabs at="inbox" s={s} />}
          {!pane && <button className="fab" aria-label="New message" onClick={() => go({ name: 'compose', mode: 'new' })}><Icon n="edit" size={26} /></button>}
        </>
      )}
      {snoozing && <SnoozeSheet onClose={() => setSnoozing(null)} onPick={(at, label) => { void c.snooze(snoozing, at, label); setSnoozing(null); }} />}
      {cleaning && <CleanUpSheet s={s} onClose={() => setCleaning(false)} />}
    </div>
  );
}

/** Primary, Transactions, Updates, Promotions and All, each with what is unread in it. Nothing is hidden: All shows everything. */
export function CategoryTabs({ s, counts }: { s: State; counts: Counts }) {
  const c = useC();
  const ref = useRef<HTMLDivElement>(null);
  const tabs: [State['view'], string, number][] = [['person', KIND_TAB.person, counts.byKind.person.unread], ['transaction', KIND_TAB.transaction, counts.byKind.transaction.unread], ['update', KIND_TAB.update, counts.byKind.update.unread], ['promo', KIND_TAB.promo, counts.byKind.promo.unread], ['all', 'All', 0]];
  useEffect(() => { (ref.current?.querySelector('[aria-selected="true"]') as HTMLElement | null)?.scrollIntoView?.({ inline: 'center', block: 'nearest' }); }, [s.view]);
  return (
    <div className="pills" role="tablist" aria-label="Mail categories" ref={ref}>
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
  const all = cleanUpList(s, now, 0);
  const old = cleanUpList(s, now, 7);
  const unread = visibleMail({ mail: s.mail, view: 'promo', unreadOnly: true, accountFilter: s.accountFilter }, now);
  return (
    <Sheet title="Clean up Promotions" onClose={onClose}>
      <p className="note" style={{ margin: '2px 8px 12px' }}>{mostlyFrom(all)} Archived mail is moved to Archive, not deleted: search still finds it, and Undo works for a few seconds.</p>
      <div className="card">
        <button className="it" disabled={!old.length} onClick={() => { onClose(); void c.cleanUp(7); }}><span className="ico"><Icon n="archive" /></span>Archive older than a week<span className="v">{old.length}</span></button>
        <button className="it" disabled={!all.length} onClick={() => { onClose(); void c.cleanUp(0); }}><span className="ico"><Icon n="archive" /></span>Archive all promotions<span className="v">{all.length}</span></button>
        <button className="it" disabled={!unread.length} onClick={() => { onClose(); void c.markRead(unread); }}><span className="ico"><Icon n="eye" /></span>Mark all as read<span className="v">{unread.length}</span></button>
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
  return <div className="empty"><span className="big">Inbox zero</span>{counts.unread === 0 ? 'Nothing waiting. Enjoy it.' : 'Everything else is snoozed.'}</div>;
}

/** Grey placeholder rows while the very first sync runs, so the screen feels alive instead of blank. */
function Skeleton() {
  return (
    <div role="status" aria-label="Getting your mail">
      <div className="sec">Getting your mail…</div>
      <div className="card">{[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="row" style={{ opacity: 1 - i * 0.15 }}>
          <div className="avw"><div className="av sk" /></div>
          <div className="rb"><span className="sk-l" style={{ width: '45%' }} /><span className="sk-l" style={{ width: '80%' }} /><span className="sk-l" style={{ width: '65%', height: 10 }} /></div>
        </div>
      ))}</div>
    </div>
  );
}
