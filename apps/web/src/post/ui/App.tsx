import { useContext, useEffect, useRef, useState } from 'react';
import type { Controller } from '../core/controller.ts';
import { themeVars } from '../core/settings.ts';
import { Compose } from './Compose.tsx';
import { Inbox } from './Inbox.tsx';
import { Later, Search } from './SearchLater.tsx';
import { Reader } from './Reader.tsx';
import { Triage } from './Triage.tsx';
import { Appearance, Settings, Sorting } from './Settings.tsx';
import { Alerts, Hours } from './Alerts.tsx';
import { AccountsSheet } from './Accounts.tsx';
import { Connecting, Login, SignedInElsewhere, SignInFailed, WaitingForMicrosoft, cleanUrl, readCallback } from './signin.tsx';
import { Desktop } from './Desktop.tsx';
import { Ctx, go, useDark, useRoute, useS, useWide } from './ctx.tsx';
import { Mark } from './ui.tsx';

function Toasts() {
  const s = useS();
  const route = useRoute();
  const t = s.toast;
  if (!t) return null;
  // On the triage screen the buttons are at the bottom, so the message goes to the top instead of covering them.
  return (
    <div className={`toast-dock${route.name === 'triage' ? ' top' : ''}`} aria-live="polite">
      <div className="toast" key={t.id} role="status"><span>{t.text}</span>{t.undo && <button className="undo" onClick={() => { const u = t.undo!; u(); }}>Undo</button>}</div>
    </div>
  );
}

type Phase = { kind: 'run' } | { kind: 'connecting' } | { kind: 'failed'; message: string } | { kind: 'elsewhere'; email: string };

const useCtl = () => useContext(Ctx);

function Shell() {
  const s = useS();
  const route = useRoute();
  const wide = useWide();
  const [phase, setPhase] = useState<Phase>({ kind: 'run' });
  const [adding, setAdding] = useState<{ hint?: string } | null>(null);
  const ctl = useCtl();
  const handled = useRef(false);

  // Coming back from Microsoft's sign-in page: finish it. Works in whichever window Microsoft sent us to.
  useEffect(() => {
    if (!s.ready || handled.current) return;
    handled.current = true;
    const cb = readCallback();
    if (!cb) return;
    if ('error' in cb) { setPhase({ kind: 'failed', message: cb.error }); cleanUrl(); return; }
    setPhase({ kind: 'connecting' });
    ctl.finishSignIn(cb.code, cb.state)
      .then((r) => { cleanUrl(); setPhase(r.fromThisApp ? { kind: 'run' } : { kind: 'elsewhere', email: r.email }); })
      .catch((e) => { cleanUrl(); setPhase({ kind: 'failed', message: e instanceof Error ? e.message : 'Could not finish the sign-in' }); });
  }, [s.ready, ctl]);

  // "I have looked": opening or returning to Post clears the icon number, and mail is fetched at once, then every minute while it is open.
  useEffect(() => {
    const on = () => { if (document.visibilityState === 'visible') void ctl.opened(); };
    document.addEventListener('visibilitychange', on);
    window.addEventListener('online', on);
    window.addEventListener('focus', on);
    const t = setInterval(() => { if (document.visibilityState === 'visible') void (s.signingIn ? ctl.collectSignIn() : ctl.sync()); }, s.signingIn ? 3000 : 60_000);
    // A push while Post is on screen: read the new mail now, and tell the server it was seen so the number does not creep up behind you.
    const onMsg = (e: MessageEvent) => { if (e.data?.type === 'push') void (e.data.looking ? ctl.opened() : ctl.sync()); };
    navigator.serviceWorker?.addEventListener('message', onMsg);
    return () => { document.removeEventListener('visibilitychange', on); window.removeEventListener('online', on); window.removeEventListener('focus', on); clearInterval(t); navigator.serviceWorker?.removeEventListener('message', onMsg); };
  }, [ctl, s.signingIn]);

  if (!s.ready) return <div className="welcome"><div className="mark"><Mark size={44} /></div></div>;
  if (phase.kind === 'connecting') return <Connecting message="Setting up your account. The first read of your inbox takes a moment." />;
  if (phase.kind === 'failed') return <SignInFailed message={phase.message} onRetry={() => { setPhase({ kind: 'run' }); setAdding({}); }} />;
  if (phase.kind === 'elsewhere') return <SignedInElsewhere email={phase.email} />;
  if (adding) return <Login mode={adding.hint ? 'again' : s.accounts.length ? 'add' : 'first'} hint={adding.hint} onCancel={s.accounts.length ? () => setAdding(null) : undefined} />;
  if (!s.accounts.length) return s.signingIn ? <WaitingForMicrosoft onRetry={() => { ctl.cancelSignIn(); setAdding({}); }} /> : <Login mode="first" />;

  const startAdd = (hint?: string) => setAdding({ hint });
  if (wide) return <Desktop s={s} onAdd={startAdd} />;

  switch (route.name) {
    case 'message': return <Reader s={s} account={route.account} id={route.id} />;
    case 'search': return <Search s={s} q={route.q} />;
    case 'later': return <Later s={s} />;
    case 'triage': return <Triage s={s} />;
    case 'compose': return <Compose s={s} mode={route.mode} account={route.account} id={route.id} />;
    case 'settings': return route.page === 'alerts' ? <Alerts s={s} /> : route.page === 'hours' ? <Hours s={s} email={route.account ?? ''} /> : route.page === 'appearance' ? <Appearance s={s} /> : route.page === 'sorting' ? <Sorting s={s} /> : <Settings s={s} />;
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
  const wide = useWide();
  return (
    <div className={`post${dark ? ' dark' : ''}${wide ? ' wide' : ''}`} style={vars as React.CSSProperties}>
      <Shell />
      <Toasts />
    </div>
  );
}
