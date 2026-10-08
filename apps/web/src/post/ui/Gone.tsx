import type { State } from '../core/controller.ts';
import { leftLine, type LeftEntry } from '../core/leftlog.ts';
import { ago } from '../core/health.ts';
import { Icon } from './ui.tsx';
import { go, useC, useNow } from './ctx.tsx';

/** "Where did my mail go?": every message that left the inbox list or changed tab lately, and who did it (you, Post, or Outlook). */
export function Gone({ s }: { s: State }) {
  const c = useC();
  const now = useNow(30_000);
  const here = new Set(s.mail.map((m) => m.key));
  const open = (e: LeftEntry) => {
    const bar = e.key.indexOf('|');
    if (bar > 0 && here.has(e.key)) go({ name: 'message', account: e.key.slice(0, bar), id: e.key.slice(bar + 1) });
  };
  return (
    <div className="pg">
      <div className="nav"><button className="back" onClick={() => go({ name: 'settings', page: '' })}><Icon n="back" />Settings</button></div>
      <div className="ttl"><h1 className="h1">Where did my mail go?</h1></div>
      <div className="scroll">
        {s.left.length ? (
          <>
            <p className="note" style={{ marginTop: 8 }}>Every message that left your inbox list or moved to another tab lately, newest first, and what moved it. “Moved or deleted at Outlook” means Post did not do it: a rule, the junk filter, or another app or device did.</p>
            <div className="card" style={{ marginTop: 12 }}>
              {s.left.map((e, i) => {
                const live = here.has(e.key) && e.key !== '*';
                const body = <span className="rw">{e.subject}<small>{e.who ? `${e.who} · ` : ''}{ago(e.at, now)}</small><small>{leftLine(e)}</small></span>;
                return live
                  ? <button key={`${e.key}${e.at}${i}`} className="it subrow" onClick={() => open(e)}>{body}<span className="v"><Icon n="chev" /></span></button>
                  : <div key={`${e.key}${e.at}${i}`} className="it subrow">{body}</div>;
              })}
            </div>
            <p className="note">The last 80 are kept, on this phone. Tap a message that is still in your inbox to open it.</p>
            <p className="note"><button className="link" onClick={() => c.clearLeft()}>Clear this list</button></p>
          </>
        ) : <p className="note" style={{ marginTop: 8 }}>Nothing has left your inbox list lately. When a message does, it is written here with the reason, so you can tell Post’s own doing from Outlook’s.</p>}
      </div>
    </div>
  );
}
