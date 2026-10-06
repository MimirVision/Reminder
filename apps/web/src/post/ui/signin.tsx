import { useState, type ReactNode } from 'react';
import { parseCallback } from '../core/auth.ts';
import { Icon, Mark } from './ui.tsx';
import { useC, useS } from './ctx.tsx';


const FEATURES: [string, string, string][] = [
  ['mail', 'One inbox for every Outlook account', 'Personal and work side by side, with a small coloured letter on each message.'],
  ['archive', 'Clear it fast', 'Swipe or press a key to archive, snooze or reply, with Undo on everything.'],
  ['bell', 'The number on your icon', 'New mail shows as a number on the Home Screen icon, with alert hours per account.'],
  ['lock', 'Private by default', 'Tracking pixels blocked, no read receipts, and mail shown in a sandbox.'],
];

/** The frame every sign-in screen shares: a brand panel beside the card on a computer, a single centred card on a phone. */
function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="auth">
      <aside className="auth-brand" aria-hidden="false">
        <div className="auth-logo"><span className="auth-mark"><Mark size={26} /></span><span>Post</span></div>
        <h2 className="auth-pitch">Email that stays out of your way.</h2>
        <ul className="auth-feats">
          {FEATURES.map(([ic, t, d]) => <li key={t}><span className="auth-fi"><Icon n={ic} size={18} /></span><div><b>{t}</b><span>{d}</span></div></li>)}
        </ul>
      </aside>
      <main className="auth-main"><div className="auth-card">{children}</div></main>
    </div>
  );
}

function Head({ title, tag }: { title: string; tag: ReactNode }) {
  return (
    <>
      <div className="auth-mark big"><Mark size={34} /></div>
      <h1 className="auth-h">{title}</h1>
      <p className="auth-tag">{tag}</p>
    </>
  );
}

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
  const title = mode === 'again' ? 'Sign in again' : mode === 'add' ? 'Add an account' : 'Welcome to Post';
  const tag = mode === 'again' ? `Sign in to ${hint ?? 'your account'} to keep the mail coming. Nothing is lost.` : mode === 'add' ? 'Sign in with the account you want to add.' : 'Sign in with your Outlook account to get started.';
  return (
    <AuthShell>
      <Head title={title} tag={tag} />
      {!s.serverReady && <p className="auth-err" role="alert">This site is not connected to its Post server yet (the Supabase address is missing from the build). See docs/POST.md.</p>}
      <button className="auth-ms" disabled={busy || !s.serverReady} onClick={() => void go()}><MicrosoftLogo />{busy ? 'Opening Microsoft…' : 'Continue with Microsoft'}</button>
      {err && <p className="auth-err" role="alert">{err}</p>}
      {mode !== 'first' && onCancel && <button className="auth-alt" onClick={onCancel}>Cancel</button>}
      <p className="auth-fine">Works with Outlook.com, Hotmail, Microsoft 365 and work or school accounts.</p>
      <div className="auth-trust"><Icon n="lock" size={18} /><p><b>You sign in on Microsoft’s own page.</b> Post never sees your password, and “Sign out” in Settings forgets the sign-in on this device.</p></div>
    </AuthShell>
  );
}

export function Connecting({ message, title = 'One moment' }: { message: string; title?: string }) {
  return <AuthShell><Head title={title} tag={message} /><div className="auth-spin" aria-hidden="true" /></AuthShell>;
}

export function SignInFailed({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <AuthShell>
      <Head title="That did not work" tag={<span role="alert">{message}</span>} />
      <button className="auth-cta" onClick={onRetry}>Try again</button>
    </AuthShell>
  );
}

/** The sign-in finished in a different window from the app (iOS can open Microsoft separately): the app collects it by itself. */
export function SignedInElsewhere({ email }: { email: string }) {
  return (
    <AuthShell>
      <Head title="Signed in" tag={<><b>{email}</b> is ready. Go back to <b>Post</b>: it picks the sign-in up by itself in a moment, and you can close this window.</>} />
    </AuthShell>
  );
}

/** The app was left to sign in somewhere else and has not heard back yet. */
export function WaitingForMicrosoft({ onRetry }: { onRetry: () => void }) {
  const c = useC();
  return (
    <AuthShell>
      <Head title="Waiting for Microsoft" tag="Finish signing in on Microsoft’s page. This screen continues by itself when you are done." />
      <button className="auth-cta" onClick={() => void c.collectSignIn()}>I have signed in</button>
      <button className="auth-alt" onClick={onRetry}>Start again</button>
    </AuthShell>
  );
}
