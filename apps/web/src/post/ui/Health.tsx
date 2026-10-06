import { useEffect, useState } from 'react';
import type { Controller, State } from '../core/controller.ts';
import { ago, findings, healthReport, type Finding, type HealthInput } from '../core/health.ts';
import { isStandalone } from '../push.ts';
import { copyText, reloadPost } from './recover.ts';
import { Icon } from './ui.tsx';
import { go, useC, useNow } from './ctx.tsx';

declare const __BUILD__: string;
const build = () => (typeof __BUILD__ === 'string' ? __BUILD__ : 'dev');

type Room = NonNullable<HealthInput['device']['room']>;

/** How much room the phone says Post may use, and whether it promised to keep what is saved. Not every browser can say, and then this is nothing. */
function useRoom(): Room | undefined {
  const [room, setRoom] = useState<Room>();
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const { usage, quota } = (await navigator.storage?.estimate?.()) ?? {};
        const persisted = await navigator.storage?.persisted?.();
        if (live && typeof usage === 'number' && typeof quota === 'number') setRoom({ usage, quota, persisted });
      } catch { /* the phone would not say */ }
    })();
    return () => { live = false; };
  }, []);
  return room;
}

/** Everything the Health page and the problem report are made from. */
export function healthInput(c: Controller, s: State, now: number, room?: Room): HealthInput {
  return { build: build(), now, state: s, storage: c.storageStatus(), problems: c.problems(), device: { userAgent: navigator.userAgent, standalone: isStandalone(), language: navigator.language, room } };
}

/** The one line the Settings page shows next to "Health". */
export function useHealthLine(s: State): { level: Finding['level']; text: string } {
  const c = useC();
  const now = useNow(30_000);
  const list = findings(healthInput(c, s, now));
  const worst = list[0];
  return { level: worst.level, text: worst.level === 'ok' ? 'All good' : list.length > 1 ? `${list.length} things to look at` : 'Needs a look' };
}

export const dotOf = (level: Finding['level']) => (level === 'ok' ? 'ok-dot' : level === 'warn' ? 'warn-dot' : 'bad-dot');

const clock = (t: number) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** How Post is doing, in plain words, with the buttons that fix the usual things, and a report to paste into a message when they do not. */
export function Health({ s }: { s: State }) {
  const c = useC();
  const now = useNow(10_000);
  const room = useRoom();
  const input = healthInput(c, s, now, room);
  const list = findings(input);
  const problems = c.problems().reverse();
  const [report, setReport] = useState<string | null>(null);
  const [said, setSaid] = useState('');
  const [sure, setSure] = useState(false);
  const [, cleared] = useState(0); // the list of what was written down is not part of Post's state: clearing it asks for a new drawing
  const copy = async () => {
    const text = healthReport(healthInput(c, s, Date.now(), room));
    setReport(text);
    setSaid((await copyText(text)) ? 'Copied. Paste it where you report problems.' : 'Press and hold the text below to copy it.');
  };
  const mb = (n: number) => `${(n / 1024 / 1024).toFixed(n >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
  return (
    <div className="pg">
      <div className="nav"><button className="back" onClick={() => go({ name: 'settings', page: '' })}><Icon n="back" />Settings</button></div>
      <div className="ttl"><h1 className="h1">Health</h1></div>
      <div className="scroll">
        <div className="lbl">Right now</div>
        <div className="card">
          {list.map((f, i) => <div key={i} className="it"><i className={dotOf(f.level)} /><span className="rw">{f.title}{f.detail && <small>{f.detail}</small>}</span></div>)}
        </div>

        <div className="lbl">What Post knows</div>
        <div className="card">
          <div className="it">Last read of your mail<span className="v">{s.sync.running ? 'Reading now' : ago(s.sync.at, now)}</span></div>
          <div className="it">Waiting to go to Outlook<span className="v">{s.waiting}</span></div>
          <div className="it">Messages waiting to be sent<span className="v">{s.outbox.length}</span></div>
          <div className="it">Saved on this phone<span className="v">{input.storage.kind === 'device' ? 'Yes' : 'No, memory only'}</span></div>
          {room && <div className="it">Room used<span className="v">{mb(room.usage)} of {mb(room.quota)}</span></div>}
          <div className="it">Version<span className="v">{input.build}</span></div>
        </div>

        <div className="lbl">Fix it</div>
        <div className="card">
          <button className="it" disabled={s.sync.running} onClick={() => void c.sync()}><span className="ico"><Icon n="refresh" /></span>{s.sync.running ? 'Reading your mail…' : 'Read my mail now'}</button>
          {sure
            ? <div className="it" style={{ flexWrap: 'wrap' }}>Read everything again from Outlook? What waits to be sent is kept.<span className="v"><button className="link" onClick={() => setSure(false)}>Cancel</button><button className="link" onClick={() => { setSure(false); void c.readAgain(); }}>Read again</button></span></div>
            : <button className="it" onClick={() => setSure(true)}><span className="ico"><Icon n="inbox" /></span>Read all mail again from Outlook</button>}
          <button className="it" onClick={() => void reloadPost()}><span className="ico"><Icon n="download" /></span>Start Post over</button>
        </div>
        <p className="note">Reading again is the cure when this phone shows something different from Outlook. Starting over loads Post's own files again; mail, settings and waiting messages are not touched.</p>

        <div className="lbl">Report a problem</div>
        <div className="card"><button className="it" onClick={() => void copy()}><span className="ico"><Icon n="copy" /></span>Copy problem report</button></div>
        <p className="note">What Post can tell about itself: versions, times and counts. Never subjects, names, addresses or message text.</p>
        {said && <p className="note" role="status" style={{ color: 'var(--ink)' }}>{said}</p>}
        {report && <textarea className="field code-box" readOnly aria-label="Problem report" rows={12} value={report} onFocus={(e) => e.currentTarget.select()} />}

        <div className="lbl">Written down</div>
        {problems.length ? (
          <>
            <div className="card">
              {problems.map((p, i) => <div key={i} className="it"><span className="rw">{p.text}<small>{clock(p.at)} · {p.kind}{p.count > 1 ? ` · ${p.count} times` : ''}</small></span></div>)}
            </div>
            <p className="note"><button className="link" onClick={() => { c.clearProblems(); cleared((n) => n + 1); setReport(null); setSaid('Cleared.'); }}>Clear this list</button></p>
          </>
        ) : <p className="note" style={{ marginTop: 0 }}>Nothing has gone wrong since Post was opened.</p>}
      </div>
    </div>
  );
}
