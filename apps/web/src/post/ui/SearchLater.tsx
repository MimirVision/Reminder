import { useEffect, useRef, useState } from 'react';
import type { State } from '../core/controller.ts';
import { replyLaterMail, snoozedMail } from '../core/controller.ts';
import { shortTime } from '../core/format.ts';
import type { Mail } from '../core/types.ts';
import { Icon } from './ui.tsx';
import { Row } from './Inbox.tsx';
import { Tabs } from './Tabs.tsx';
import { go, useC, useNow } from './ctx.tsx';

const TIPS = ['from:anna', 'is:unread', 'has:attachment', 'in:newsletters', 'account:work'];

export function Search({ s, q: initial, pane = false }: { s: State; q: string; pane?: boolean }) {
  const c = useC();
  const [q, setQ] = useState(initial);
  const [remote, setRemote] = useState<Mail[] | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  useEffect(() => { setRemote(null); }, [q]);
  const local = q.trim() ? c.searchLocal(q) : [];
  const open = (m: Mail) => go({ name: 'message', account: m.account, id: m.id });
  const askOutlook = async () => { setBusy(true); try { setRemote(await c.searchRemote(q)); } finally { setBusy(false); } };

  return (
    <div className="pg">
      <div className="nav" style={{ paddingBottom: 4 }}>
        <div className="find" style={{ margin: 0, flex: 1, width: 'auto', color: 'var(--ink)' }}>
          <Icon n="search" />
          <input ref={ref} aria-label="Search mail" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search mail" enterKeyHint="search" autoCapitalize="none" autoCorrect="off" style={{ flex: 1, minWidth: 0, border: 0, background: 'transparent', outline: 'none', height: 44 }} />
          {q && <button className="btn plain" style={{ width: 32, height: 32 }} aria-label="Clear" onClick={() => { setQ(''); ref.current?.focus(); }}><Icon n="x" size={18} /></button>}
        </div>
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
            {local.length > 0 && <div className="card">{local.map((m) => <div key={m.key} className="sw-row"><Row m={m} s={s} selecting={false} selected={false} onOpen={() => open(m)} onToggle={() => {}} /></div>)}</div>}
            {remote === null ? <button className="more" disabled={busy} onClick={() => void askOutlook()}>{busy ? 'Searching Outlook…' : 'Search all of Outlook'}</button> : (
              <>
                <div className="sec">{remote.length ? 'Older, from Outlook' : 'Nothing older in Outlook'}</div>
                {remote.length > 0 && <div className="card">{remote.map((m) => <div key={m.key} className="sw-row"><Row m={m} s={s} selecting={false} selected={false} onOpen={() => open(m)} onToggle={() => {}} /></div>)}</div>}
              </>
            )}
          </>
        )}
      </div>
      {!pane && <Tabs at="search" s={s} />}
    </div>
  );
}

export function Later({ s, pane = false }: { s: State; pane?: boolean }) {
  const c = useC();
  const now = useNow();
  const snoozed = snoozedMail(s.mail, now);
  const later = replyLaterMail(s.mail, now);
  const open = (m: Mail) => go({ name: 'message', account: m.account, id: m.id });
  return (
    <div className="pg">
      <header className="hd"><h1 className="h1">Later</h1></header>
      <div className="scroll">
        <div className="sec">Snoozed</div>
        {snoozed.length ? <div className="card">{snoozed.map((m) => (
          <div key={m.key} className="sw-row"><Row m={m} s={s} selecting={false} selected={false} onOpen={() => open(m)} onToggle={() => {}} />
            <div style={{ position: 'absolute', right: 12, top: 8 }}><button className="chip" onClick={() => void c.unsnooze(m)} aria-label="Bring back now"><Icon n="clock" size={14} />{shortTime(m.snoozedUntil!)} · now</button></div></div>
        ))}</div> : <p className="note">Nothing snoozed. Swipe a message left to snooze it.</p>}
        <div className="sec">Reply later</div>
        {later.length ? <div className="card">{later.map((m) => <div key={m.key} className="sw-row"><Row m={m} s={s} selecting={false} selected={false} onOpen={() => open(m)} onToggle={() => {}} /></div>)}</div> : <p className="note">Flagged messages show up here, so “I will answer that later” does not get lost.</p>}
      </div>
      {!pane && <Tabs at="later" s={s} />}
    </div>
  );
}
