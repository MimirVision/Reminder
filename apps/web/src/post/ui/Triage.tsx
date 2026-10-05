import { useEffect, useRef, useState } from 'react';
import { visibleMail, type State } from '../core/controller.ts';
import { displayName, initials, shortTime } from '../core/format.ts';
import type { Mail } from '../core/types.ts';
import { isHorizontal, swipeResult } from '../../lib/swipe.ts';
import { Icon } from './ui.tsx';
import { SnoozeSheet } from './Inbox.tsx';
import { back, go, labelOf, useBadge, useC } from './ctx.tsx';

const plain = (b: { contentType: 'html' | 'text'; content: string }) => {
  if (b.contentType === 'text') return b.content;
  try { const d = new DOMParser().parseFromString(b.content.replace(/<\/(p|div|li|tr|h\d)>|<br\s*\/?>/gi, '$& '), 'text/html'); d.querySelectorAll('style,script,head').forEach((n) => n.remove()); return (d.body.textContent ?? '').replace(/\s+/g, ' ').trim(); } catch { return ''; }
};

/** Triage mode: one message at a time, four honest choices, no list to scroll. The queue is fixed when you start so nothing reorders under your thumb. */
export function Triage({ s }: { s: State }) {
  const c = useC();
  const badgeOf = useBadge(s);
  const queue = useRef<string[] | null>(null);
  if (!queue.current) queue.current = visibleMail({ mail: s.mail, filter: 'unread', accountFilter: s.accountFilter }, Date.now()).filter((m) => !m.flagged).map((m) => m.key);
  const [handled, setHandled] = useState<string[]>([]);
  const [snooze, setSnooze] = useState(false);
  const [dx, setDx] = useState(0);
  const [drag, setDrag] = useState(false);
  const st = useRef<{ x: number; y: number; t: number; id: number; live: boolean } | null>(null);
  const [text, setText] = useState('');
  const total = queue.current.length;
  const items = queue.current.filter((k) => !handled.includes(k)).map((k) => s.mail.find((m) => m.key === k)).filter((m): m is Mail => !!m);
  const cur = items[0];
  const next = items[1];
  const index = Math.min(total, total - items.length + 1);
  const mark = (m: Mail) => setHandled((h) => [...h, m.key]);
  const laterCount = s.mail.filter((m) => m.flagged && m.folder === 'inbox').length;

  useEffect(() => {
    setText(cur?.preview ?? '');
    if (!cur) return;
    let live = true;
    c.openBody(cur).then((b) => { if (live) setText(plain(b).slice(0, 900) || cur.preview); }).catch(() => {});
    return () => { live = false; };
  }, [cur?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!cur) {
    return (
      <div className="pg">
        <div className="nav"><button className="back" onClick={() => go({ name: 'inbox' })}><Icon n="back" />Inbox</button></div>
        <div className="empty"><span className="big">All caught up</span>{total ? `You went through ${total} message${total > 1 ? 's' : ''}.` : 'Nothing unread to go through.'}<button className="cta" style={{ marginTop: 20 }} onClick={() => go({ name: 'inbox' })}>Back to inbox</button></div>
      </div>
    );
  }
  // Drag the card: right to archive, left to snooze. The buttons below do the same, for one thumb or for VoiceOver.
  const down = (e: React.PointerEvent) => { if (e.pointerType === 'mouse') return; st.current = { x: e.clientX, y: e.clientY, t: e.timeStamp, id: e.pointerId, live: false }; };
  const move = (e: React.PointerEvent) => {
    const g = st.current; if (!g) return;
    const mx = e.clientX - g.x, my = e.clientY - g.y;
    if (!g.live && isHorizontal(mx, my)) { g.live = true; setDrag(true); (e.currentTarget as HTMLElement).setPointerCapture(g.id); }
    if (g.live) setDx(mx);
  };
  const end = (e: React.PointerEvent) => {
    const g = st.current; st.current = null;
    if (!g?.live) return;
    setDrag(false);
    const r = swipeResult(e.clientX - g.x, e.clientY - g.y, e.timeStamp - g.t, 110);
    if (r === 'done') { setDx(600); setTimeout(() => { void c.archive([cur]); mark(cur); setDx(0); }, 200); }
    else if (r === 'delete') { setDx(0); setSnooze(true); }
    else setDx(0);
  };
  const stamp = Math.min(1, Math.abs(dx) / 90);
  return (
    <div className="pg">
      <div className="nav">
        <button className="back" onClick={() => back()}><Icon n="back" />Inbox</button>
        <span className="sp" style={{ textAlign: 'center', fontFamily: 'Bricolage Grotesque', fontWeight: 700, fontSize: 20 }}>{index} <span style={{ color: 'var(--mu)', fontSize: 14 }}>of {total}</span></span>
        <button className="back" onClick={() => mark(cur)} disabled={!next} style={{ opacity: next ? 1 : .4 }}>Skip<Icon n="skip" /></button>
      </div>
      <div className="prog" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={index - 1}><i style={{ width: `${((index - 1) / Math.max(1, total)) * 100}%` }} /></div>
      <div className="stack">
        {next && <div className="tcard b1" aria-hidden="true" />}
        <article className="tcard" aria-label={`Message ${index} of ${total}`} onPointerDown={down} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
          style={{ transform: dx ? `translateX(${dx}px) rotate(${dx / 22}deg)` : undefined, transition: drag ? 'none' : 'transform .2s ease' }}>
          <span className="tstamp r" style={{ opacity: dx > 0 ? stamp : 0 }}>Archive</span><span className="tstamp l" style={{ opacity: dx < 0 ? stamp : 0 }}>Snooze</span>
          <div className="r1"><span className="chip"><i style={{ background: badgeOf(cur.account)?.colour ?? 'var(--at)' }} />{labelOf(s, cur.account)}</span><span className="tm">{shortTime(cur.received)}</span></div>
          <div className="r1" style={{ marginTop: 14, gap: 12 }}><div className={`av${cur.kind === 'person' ? '' : ' sq'}`}>{initials(cur.fromName, cur.fromAddress)}</div><div><b style={{ display: 'block', fontSize: 16 }}>{displayName(cur.fromName, cur.fromAddress)}</b><span style={{ fontSize: 12.5, color: 'var(--mu)' }}>{cur.fromAddress}</span></div></div>
          <h1 className="sjb">{cur.subject || '(no subject)'}</h1>
          <div className="tb">{text}<div className="fade" /></div>
          <button className="open" onClick={() => go({ name: 'message', account: cur.account, id: cur.id })}>Open the whole message<Icon n="chev" size={16} /></button>
        </article>
      </div>
      <div className="nx">{next ? <>Next: <b>{displayName(next.fromName, next.fromAddress)}</b> · {next.subject}</> : 'This is the last one'}</div>
      <div className="grid">
        <button className="g pri" onClick={() => { void c.archive([cur]); mark(cur); }}><Icon n="archive" /><span>Archive<small>then next</small></span></button>
        <button className="g" onClick={() => setSnooze(true)}><Icon n="clock" /><span>Snooze<small>pick a time</small></span></button>
        <button className="g" onClick={() => { void c.setFlag(cur, true); void c.setRead({ ...cur, flagged: true }, true); mark(cur); }}><Icon n="reply" /><span>Reply later<small>keeps it for you</small></span>{laterCount > 0 && <span className="b">{laterCount}</span>}</button>
        <button className="g" onClick={() => go({ name: 'compose', mode: 'reply', account: cur.account, id: cur.id })}><Icon n="edit" /><span>Reply now<small>quick answer</small></span></button>
      </div>
      {snooze && <SnoozeSheet onClose={() => setSnooze(false)} onPick={(at, label) => { void c.snooze(cur, at, label); mark(cur); setSnooze(false); }} />}
    </div>
  );
}
