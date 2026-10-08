import { useEffect, useMemo, useState } from 'react';
import type { State } from '../core/controller.ts';
import { neverOpened, rate, subscriptions, type Subscription } from '../core/subscriptions.ts';
import { parseUnsubscribe, type Unsub } from '../core/unsubscribe.ts';
import { Avatar, Icon, Seg, Sheet } from './ui.tsx';
import { BlockSheet, SweepSheet } from './SenderSheets.tsx';
import { go, useC, useNow } from './ctx.tsx';

const PAGE = 20;

/** The Settings row's line: how many senders keep mailing you. */
export function useSubscriptionsLine(s: State): string {
  const now = useNow(60_000);
  const n = useMemo(() => subscriptions(s.mail, s.blocked, now).length, [s.mail, s.blocked, now]);
  return n ? `${n} sender${n > 1 ? 's' : ''}` : 'None';
}

const mails = (n: number) => `${n} mail${n === 1 ? '' : 's'}`;

/** Who mails you the most: the senders of newsletters and offers in the inbox on this phone, busiest first, each with Sweep, Unsubscribe and Block. */
export function Subscriptions({ s }: { s: State }) {
  const now = useNow(60_000);
  const all = useMemo(() => subscriptions(s.mail, s.blocked, now), [s.mail, s.blocked, now]);
  const quiet = useMemo(() => neverOpened(all), [all]);
  const [show, setShow] = useState<'most' | 'never'>('most');
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<string | null>(null);
  const list = show === 'never' ? quiet : all;
  const total = all.reduce((n, x) => n + x.count, 0);
  const picked = open ? all.find((x) => x.key === open) ?? null : null;
  return (
    <div className="pg">
      <div className="nav"><button className="back" onClick={() => go({ name: 'settings', page: '' })}><Icon n="back" />Settings</button></div>
      <div className="ttl"><h1 className="h1">Subscriptions</h1></div>
      <div className="scroll">
        {all.length ? (
          <>
            <p className="note" style={{ marginTop: 8 }}>{all.length} sender{all.length > 1 ? 's' : ''} of newsletters and offers have {mails(total)} in your inbox on this phone. Tap one to sweep, unsubscribe or block. Mail from people is never listed.</p>
            <div className="panel" style={{ marginTop: 12 }}><Seg label="Show" value={show} options={[['most', 'Most mail'], ['never', `Never opened${quiet.length ? ` (${quiet.length})` : ''}`]]} onChange={(v) => { setShow(v); setLimit(PAGE); }} /></div>
            {list.length ? (
              <div className="card" style={{ marginTop: 12 }}>
                {list.slice(0, limit).map((x) => (
                  <button key={x.key} className="it subrow" onClick={() => setOpen(x.key)} aria-label={`${x.name}, ${mails(x.count)}`}>
                    <Avatar m={x.newest} />
                    <span className="rw">{x.name}<small>{x.address}</small><small>{mails(x.count)} · {rate(x.perWeek)}{x.unread ? ` · ${x.unread} unread` : ''}</small></span>
                    <span className="v"><Icon n="chev" /></span>
                  </button>
                ))}
                {list.length > limit && <button className="it" onClick={() => setLimit(limit + PAGE)}>Show more<span className="v">{list.length - limit} left</span></button>}
              </div>
            ) : <p className="note">{show === 'never' ? 'Every sender here has at least one mail you opened.' : 'Nobody to show.'}</p>}
            {show === 'never' && quiet.length > 0 && <p className="note">Senders with two or more mails where you have not opened a single one: the likeliest to be worth leaving.</p>}
          </>
        ) : <p className="note" style={{ marginTop: 8 }}>No newsletters or offers in your inbox on this phone right now. Senders appear here once their mail piles up.</p>}
        <p className="note">Counts cover the inbox on this phone (the last 45 days), not all of Outlook. Sweep and Block can be undone; Unsubscribe is up to the sender and cannot.</p>
      </div>
      {picked && <SubscriptionSheet s={s} x={picked} onClose={() => setOpen(null)} />}
    </div>
  );
}

function SubscriptionSheet({ s, x, onClose }: { s: State; x: Subscription; onClose: () => void }) {
  const c = useC();
  const [sheet, setSheet] = useState<'sweep' | 'block' | null>(null);
  // The unsubscribe link lives in the hidden headers of one message: ask Outlook for them as the sheet opens, so the button is ready to tap.
  const [unsub, setUnsub] = useState<Unsub | null | 'loading'>(x.unsubMail ? 'loading' : null);
  useEffect(() => {
    if (!x.unsubMail) return;
    let live = true;
    c.headersOf(x.unsubMail).then((h) => { if (live) setUnsub(parseUnsubscribe(h)); }).catch(() => { if (live) setUnsub(null); });
    return () => { live = false; };
  }, [x.key]);
  const leave = () => {
    if (!unsub || unsub === 'loading') return;
    if (unsub.https) window.open(unsub.https, '_blank', 'noopener');
    else if (unsub.mailto && x.unsubMail) void c.unsubscribe(x.unsubMail, unsub.mailto);
    onClose();
  };
  if (sheet === 'sweep') return <SweepSheet s={s} m={x.newest} onClose={() => setSheet(null)} onSwept={() => onClose()} />;
  if (sheet === 'block') return <BlockSheet s={s} m={x.newest} onClose={() => setSheet(null)} onBlocked={() => onClose()} />;
  return (
    <Sheet title={x.name} onClose={onClose}>
      <p className="note">{x.address}<br />{mails(x.count)} in your inbox · {rate(x.perWeek)}{x.unread ? ` · ${x.unread} unread` : ' · all read'}</p>
      <div className="card">
        <button className="it" onClick={() => { onClose(); go({ name: 'search', q: `from:${x.address}` }); }}><span className="ico"><Icon n="search" /></span><span className="rw">See their mail<small>Search for everything from {x.address}</small></span></button>
        <button className="it" onClick={() => setSheet('sweep')}><span className="ico"><Icon n="archive" /></span><span className="rw">Sweep<small>Archive or delete what they sent, with Undo</small></span></button>
        {x.canUnsubscribe && (
          <button className="it" disabled={unsub === null || unsub === 'loading'} onClick={leave}><span className="ico"><Icon n="x" /></span>
            <span className="rw">Unsubscribe<small>{unsub === 'loading' ? 'Looking for the link…' : unsub === null ? 'No usable link found in their mail' : unsub.https ? 'Opens their page to confirm' : 'Sends a request from your account'}</small></span></button>
        )}
        <button className="it danger" onClick={() => setSheet('block')}><span className="ico"><Icon n="ban" /></span><span className="rw">Block<small>Their mail goes to Junk from then on</small></span></button>
        <button className="it" onClick={onClose}>Cancel</button>
      </div>
      {!x.canUnsubscribe && <p className="note">This sender's mail has no unsubscribe link. Blocking is the way to stop it.</p>}
    </Sheet>
  );
}
