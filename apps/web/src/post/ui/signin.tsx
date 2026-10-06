import { useState } from 'react';
import { parseCallback } from '../core/auth.ts';
import { Icon, Mark } from './ui.tsx';
import { useC, useS } from './ctx.tsx';

export const REDIRECT = () => `${location.origin}/post/`;

export function MicrosoftLogo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 21 21" aria-hidden="true"><rect x="1" y="1" width="9" height="9" fill="#F25022" /><rect x="11" y="1" width="9" height="9" fill="#7FBA00" /><rect x="1" y="11" width="9" height="9" fill="#00A4EF" /><rect x="11" y="11" width="9" height="9" fill="#FFB900" /></svg>
  );
}

/** What Microsoft put in the address on the way back (or null when this page load is not a sign-in return). */
export function readCallback(): { code: string; state: string } | { error: string } | null {
  const r = parseCallback(location.search);
  if (r.kind === 'none') return null;
  return r.kind === 'error' ? { error: r.message } : { code: r.code, state: r.state };
}

export function cleanUrl() { history.replaceState(null, '', `${location.pathname}#/`); }

/** The first screen, and the same screen for adding another account: one button, nothing to type, the same on a phone and a computer. */
export function Login({ mode = 'first', hint, onCancel }: { mode?: 'first' | 'add' | 'again'; hint?: string; onCancel?: () => void }) {
  const s = useS();
  const c = useC();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const go = async () => {
    setBusy(true); setErr('');
    try { location.assign(await c.startSignIn(REDIRECT(), hint)); } catch (e) { setErr(e instanceof Error ? e.message : 'Could not start the sign-in'); setBusy(false); }
  };
  const title = mode === 'again' ? 'Sign in again' : mode === 'add' ? 'Add an account' : 'Post';
  return (
    <div className="welcome">
      <div className="mark"><Mark size={44} /></div>
      <h1 className="h1">{title}</h1>
      <p className="tag">{mode === 'again' ? `Sign in to ${hint ?? 'your account'} to keep the mail coming. Nothing is lost.` : mode === 'add' ? 'Sign in with the account you want to add.' : 'Mail that stays out of your way, and gets out of your inbox fast.'}</p>
      <div className="form">
        {!s.serverReady && <p className="note" role="alert" style={{ color: 'var(--bad)', margin: '0 0 12px' }}>This site is not connected to its Post server yet (the Supabase address is missing from the build). See docs/POST.md.</p>}
        <button className="cta ms" disabled={busy || !s.serverReady} onClick={() => void go()}><MicrosoftLogo />{busy ? 'Opening Microsoft…' : 'Continue with Microsoft'}</button>
        <p className="note" style={{ margin: '12px 4px 0', textAlign: 'center' }}>Outlook, Hotmail, Microsoft 365 and work or school accounts.</p>
        {mode !== 'first' && onCancel && <button className="alt" onClick={onCancel}>Cancel</button>}
        {err && <p className="note" role="alert" style={{ color: 'var(--bad)' }}>{err}</p>}
      </div>
      <div className="trust"><Icon n="lock" size={22} /><div><b>You sign in on Microsoft’s own page.</b> Post never sees your password. Your mail goes straight from Outlook to this device, and “Sign out” in Settings forgets the sign-in.</div></div>
    </div>
  );
}

export function Connecting({ message, title = 'One moment' }: { message: string; title?: string }) {
  return <div className="welcome"><div className="mark"><Mark size={44} /></div><h1 className="h1">{title}</h1><p className="tag">{message}</p></div>;
}

export function SignInFailed({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="welcome"><div className="mark"><Mark size={44} /></div><h1 className="h1">That did not work</h1><p className="tag" role="alert">{message}</p>
      <div className="form"><button className="cta" onClick={onRetry}>Try again</button></div></div>
  );
}

/** The sign-in finished in a different window from the app (iOS can open Microsoft separately): the app collects it by itself. */
export function SignedInElsewhere({ email }: { email: string }) {
  return (
    <div className="welcome">
      <div className="mark"><Mark size={44} /></div>
      <h1 className="h1">Signed in</h1>
      <p className="tag"><b>{email}</b> is ready. Go back to <b>Post</b>: it picks the sign-in up by itself in a moment, and you can close this window.</p>
    </div>
  );
}

/** The app was left to sign in somewhere else and has not heard back yet. */
export function WaitingForMicrosoft({ onRetry }: { onRetry: () => void }) {
  const c = useC();
  return (
    <div className="welcome">
      <div className="mark"><Mark size={44} /></div>
      <h1 className="h1">Waiting for Microsoft</h1>
      <p className="tag">Finish signing in on Microsoft’s page. This screen continues by itself when you are done.</p>
      <div className="form">
        <button className="cta" onClick={() => void c.collectSignIn()}>I have signed in</button>
        <button className="alt" onClick={onRetry}>Start again</button>
      </div>
    </div>
  );
}
