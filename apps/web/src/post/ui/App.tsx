import { useContext, useEffect, useRef, useState } from 'react';
import type { Controller } from '../core/controller.ts';
import { themeVars } from '../core/settings.ts';
import { Compose } from './Compose.tsx';
import { Inbox } from './Inbox.tsx';
import { Later, Search } from './SearchLater.tsx';
import { Reader } from './Reader.tsx';
import { Triage } from './Triage.tsx';
import { Appearance, Settings } from './Settings.tsx';
import { Alerts, Hours } from './Alerts.tsx';
import { AccountsSheet } from './Accounts.tsx';
import { Connect, Connected, Connecting, SignInFailed, Welcome, beginSignIn, cleanUrl, readCallback, useHandoff } from './signin.tsx';
import { Ctx, go, useDark, useRoute, useS } from './ctx.tsx';
import { Mark } from './ui.tsx';
import { isStandalone } from '../push.ts';

function Toasts() {
  const s = useS();
  const t = s.toast;
  if (!t) return null;
  return (
    <div className="toast-dock" aria-live="polite">
      <div className="toast" key={t.id} role="status"><span>{t.text}</span>{t.undo && <button className="undo" onClick={() => { const u = t.undo!; u(); }}>Undo</button>}</div>
    </div>
  );
}

type Phase = { kind: 'run' } | { kind: 'connecting' } | { kind: 'failed'; message: string } | { kind: 'connected'; email: string };

const useCtl = () => useContext(Ctx);

function Shell() {
  const s = useS();
  const route = useRoute();
  const handoff = useHandoff(s.ready);
  const [phase, setPhase] = useState<Phase>({ kind: 'run' });
  const [adding, setAdding] = useState<{ hint?: string } | null>(null);
  const ctl = useCtl();
  const handled = useRef(false);

  // Coming back from Microsoft's sign-in page.
  useEffect(() => {
    if (!s.ready || !s.config || handled.current) return;
    const cb = readCallback();
    handled.current = true;
    if (!cb) return;
    if ('error' in cb) { setPhase({ kind: 'failed', message: cb.error }); cleanUrl(); return; }
    setPhase({ kind: 'connecting' });
    ctl.connect({ code: cb.code, verifier: cb.verifier, redirectUri: `${location.origin}/post/`, label: cb.label })
      .then((r) => { cleanUrl(); setPhase(isStandalone() ? { kind: 'run' } : { kind: 'connected', email: r.email }); })
      .catch((e) => { cleanUrl(); setPhase({ kind: 'failed', message: e instanceof Error ? e.message : 'Could not finish the sign-in' }); });
  }, [s.ready, s.config, ctl]);

  // "I have looked": opening or returning to Post clears the icon number, and mail is fetched at once, then every minute while it is open.
  useEffect(() => {
    if (!s.config) return;
    const on = () => { if (document.visibilityState === 'visible') void ctl.opened(); };
    document.addEventListener('visibilitychange', on);
    window.addEventListener('online', on);
    const t = setInterval(() => { if (document.visibilityState === 'visible') void ctl.sync(); }, 60_000);
    // A push while Post is on screen: read the new mail now, and tell the server it was seen so the number does not creep up behind you.
    const onMsg = (e: MessageEvent) => { if (e.data?.type === 'push') void (e.data.looking ? ctl.opened() : ctl.sync()); };
    navigator.serviceWorker?.addEventListener('message', onMsg);
    return () => { document.removeEventListener('visibilitychange', on); window.removeEventListener('online', on); clearInterval(t); navigator.serviceWorker?.removeEventListener('message', onMsg); };
  }, [s.config, ctl]);

  if (!s.ready || !handoff.done) return <div className="welcome"><div className="mark"><Mark size={44} /></div></div>;
  if (phase.kind === 'connecting') return <Connecting message="Setting up your account. The first read of your inbox takes a moment." />;
  if (phase.kind === 'failed') return <SignInFailed message={phase.message} onRetry={() => { setPhase({ kind: 'run' }); setAdding({}); }} />;
  if (!s.config) return <Welcome />;
  if (phase.kind === 'connected') return <Connected email={phase.email} onContinue={() => setPhase({ kind: 'run' })} />;
  if (handoff.wantAdd || adding) return <Connect first={!s.accounts.length} again={adding?.hint} />;
  if (!s.accounts.length) {
    if (s.sync.at === null && !s.sync.error) return <div className="welcome"><div className="mark"><Mark size={44} /></div><p className="tag">Loading…</p></div>;
    if (s.sync.error && !s.online) return <Connecting message="No connection. Post needs the internet once to set up." />;
    return <Connect first />;
  }

  const startAdd = (hint?: string) => {
    if (!s.config) return;
    if (isStandalone()) setAdding({ hint }); else void beginSignIn(s.config.clientId, hint ?? '').catch(() => setAdding({ hint }));
  };

  switch (route.name) {
    case 'message': return <Reader s={s} account={route.account} id={route.id} />;
    case 'search': return <Search s={s} q={route.q} />;
    case 'later': return <Later s={s} />;
    case 'triage': return <Triage s={s} />;
    case 'compose': return <Compose s={s} mode={route.mode} account={route.account} id={route.id} />;
    case 'settings': return route.page === 'alerts' ? <Alerts s={s} /> : route.page === 'hours' ? <Hours s={s} email={route.account ?? ''} /> : route.page === 'appearance' ? <Appearance s={s} /> : <Settings s={s} />;
    case 'accounts': return <><Inbox s={s} /><AccountsSheet s={s} onAdd={startAdd} onClose={() => go({ name: 'inbox' })} /></>;
    default: return <Inbox s={s} />;
  }
}

export function App({ controller }: { controller: Controller }) {
  return (
    <Ctx.Provider value={controller}>
      <Themed />
    </Ctx.Provider>
  );
}

function Themed() {
  const s = useS();
  const dark = useDark(s.settings.theme);
  const vars = themeVars(s.settings, dark);
  useEffect(() => {
    const r = document.documentElement;
    for (const [k, v] of Object.entries(vars)) r.style.setProperty(k, v);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', vars['--bg']);
  }, [vars]);
  return (
    <div className={`post${dark ? ' dark' : ''}`} style={vars as React.CSSProperties}>
      <Shell />
      <Toasts />
    </div>
  );
}
