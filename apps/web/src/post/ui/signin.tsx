import { useEffect, useState } from 'react';
import { parseCallback, startSignIn } from '../core/auth.ts';
import { makeSetupCode, parseSetupCode, validConfig, type Config } from '../core/setup.ts';
import { isStandalone } from '../push.ts';
import { Icon, Mark, Sheet } from './ui.tsx';
import { useC, useS } from './ctx.tsx';

export const REDIRECT = () => `${location.origin}/post/`;
const KEY = 'post.signin';

const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } },
  del: (k: string) => { try { localStorage.removeItem(k); } catch { /* storage blocked */ } },
};

/** Sends this tab to Microsoft. Only ever called in a normal browser tab: iOS cuts off sign-in pages inside a Home Screen app. */
export async function beginSignIn(clientId: string, hint: string, label?: string) {
  const si = await startSignIn({ clientId, redirectUri: REDIRECT(), loginHint: hint || undefined });
  store.set(KEY, JSON.stringify({ verifier: si.verifier, state: si.state, label: label || undefined }));
  location.assign(si.url);
}

/** Turns what Microsoft sent back into an account. Returns null when this page load was not a sign-in return. */
export function readCallback(): { code: string; verifier: string; label?: string } | { error: string } | null {
  const saved = (() => { try { return JSON.parse(store.get(KEY) ?? 'null'); } catch { return null; } })();
  const r = parseCallback(location.search, saved?.state ?? null);
  if (r.kind === 'none') return null;
  store.del(KEY);
  if (r.kind === 'error') return { error: r.message };
  return { code: r.code, verifier: saved.verifier, label: saved.label };
}

export function cleanUrl() { history.replaceState(null, '', `${location.pathname}#/`); }

function Copy({ text, label }: { text: string; label: string }) {
  const c = useC();
  return <button className="alt" onClick={() => void navigator.clipboard?.writeText(text).then(() => c.toast('Copied'), () => c.toast('Copy failed. Long-press the text instead.'))}><Icon n="copy" size={18} /> {label}</button>;
}

/** First run on a phone that has no setup yet: paste the setup code, or type the three values once. */
export function Welcome() {
  const c = useC();
  const [code, setCode] = useState('');
  const [manual, setManual] = useState(false);
  const [v, setV] = useState({ url: '', key: '', clientId: '' });
  const [err, setErr] = useState('');
  const apply = (cfg: Config | null) => { if (!cfg) { setErr('That does not look right. Check the three values and try again.'); return; } c.setConfig(cfg); };
  return (
    <div className="welcome">
      <div className="mark"><Mark size={44} /></div>
      <h1 className="h1">Post</h1>
      <p className="tag">Mail that stays out of your way, and gets out of your inbox fast.</p>
      <div className="form">
        <label className="lbl" style={{ margin: '0 0 6px' }} htmlFor="sc">Setup code</label>
        <textarea id="sc" className="field" rows={3} placeholder="post1.…" value={code} onChange={(e) => { setCode(e.target.value); setErr(''); }} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
        <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
          <button className="alt" style={{ marginTop: 0 }} onClick={() => void navigator.clipboard?.readText().then((t) => { setCode(t); const cfg = parseSetupCode(t); if (cfg) apply(cfg); }, () => setErr('Could not read the clipboard. Paste into the box instead.'))}>Paste</button>
          <button className="cta" style={{ height: 52, fontSize: 15, flex: 1 }} disabled={!code.trim()} onClick={() => apply(parseSetupCode(code))}>Continue</button>
        </div>
        {err && <p className="note" style={{ color: 'var(--bad)' }} role="alert">{err}</p>}
        <p className="note" style={{ marginTop: 14 }}>No code yet? <button className="link" onClick={() => setManual((x) => !x)}>Type the three values</button> from your own setup (docs/POST.md).</p>
        {manual && (
          <div style={{ marginTop: 8, display: 'grid', gap: 10 }}>
            <input className="field" aria-label="Alert server address" placeholder="https://….supabase.co/functions/v1/post-alerts" value={v.url} onChange={(e) => setV({ ...v, url: e.target.value })} autoCapitalize="none" autoCorrect="off" />
            <input className="field" aria-label="Alerts key" placeholder="Alerts key" value={v.key} onChange={(e) => setV({ ...v, key: e.target.value })} autoCapitalize="none" autoCorrect="off" />
            <input className="field" aria-label="Azure application id" placeholder="Azure application (client) id" value={v.clientId} onChange={(e) => setV({ ...v, clientId: e.target.value })} autoCapitalize="none" autoCorrect="off" />
            <button className="cta" style={{ height: 52, fontSize: 15 }} onClick={() => apply(validConfig(v) ? { url: v.url.trim(), key: v.key.trim(), clientId: v.clientId.trim() } : null)}>Save</button>
            <p className="note" style={{ margin: 0 }}>Redirect address to add in Azure (Mobile and desktop platform):</p>
            <div className="code">{REDIRECT()}</div>
          </div>
        )}
      </div>
      <div className="trust"><Icon n="lock" size={22} /><div><b>Your mail goes straight from Outlook to this phone.</b> Your own alert server only holds the sign-in, so it can tell you about new mail. Nothing is sold, tracked or read.</div></div>
    </div>
  );
}

/** Add an account. In Safari it signs in right here; in the Home Screen app it hands over to Safari (see the note on beginSignIn). */
export function Connect({ first, again }: { first: boolean; again?: string }) {
  const s = useS();
  const c = useC();
  const [email, setEmail] = useState(again ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const standalone = isStandalone();
  const cfg = s.config!;
  const hand = `${location.origin}/post/#add:${makeSetupCode(cfg)}`;
  const go = async () => {
    setBusy(true); setErr('');
    try { await beginSignIn(cfg.clientId, email.trim()); } catch (e) { setErr(e instanceof Error ? e.message : 'Could not start the sign-in'); setBusy(false); }
  };
  void c;
  return (
    <div className="welcome">
      <div className="mark"><Mark size={44} /></div>
      <h1 className="h1">{again ? 'Sign in again' : first ? 'Add your mail' : 'Add an account'}</h1>
      <p className="tag">Type your email address. Post signs you in with Microsoft, so there is no password to type here.</p>
      <div className="form">
        <label className="lbl" style={{ margin: '0 0 6px' }} htmlFor="em">Your email address</label>
        <input id="em" className="field" type="email" inputMode="email" autoCapitalize="none" autoCorrect="off" placeholder="you@outlook.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        {standalone ? (
          <>
            <a className="cta" style={{ marginTop: 18, textDecoration: 'none' }} href={`${hand}`} target="_blank" rel="noopener">Continue in Safari<Icon n="chev" /></a>
            <p className="note">Microsoft’s sign-in page does not work inside a Home Screen app, so Safari does this one step. When it says <b>Connected</b>, come back here: Post picks the new account up by itself.</p>
            <Copy text={hand} label="Copy the Safari link" />
          </>
        ) : (
          <button className="cta" style={{ marginTop: 18 }} disabled={busy} onClick={() => void go()}>{busy ? 'Opening Microsoft…' : 'Continue with Microsoft'}<Icon n="chev" /></button>
        )}
        {err && <p className="note" style={{ color: 'var(--bad)' }} role="alert">{err}</p>}
      </div>
      <div className="trust"><Icon n="lock" size={22} /><div><b>Work and school accounts work too</b>, if your organisation allows it. Your mail stays in Outlook; Post only reads and changes it for you.</div></div>
    </div>
  );
}

/** Shown while the sign-in code is being exchanged. */
export function Connecting({ message }: { message: string }) {
  return <div className="welcome"><div className="mark"><Mark size={44} /></div><h1 className="h1">One moment</h1><p className="tag">{message}</p></div>;
}

export function SignInFailed({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="welcome"><div className="mark"><Mark size={44} /></div><h1 className="h1">That did not work</h1><p className="tag" role="alert">{message}</p>
      <div className="form"><button className="cta" onClick={onRetry}>Try again</button></div></div>
  );
}

/** After connecting in Safari (not in the Home Screen app): tell the person what to do next. */
export function Connected({ email, onContinue }: { email: string; onContinue: () => void }) {
  const s = useS();
  const code = s.config ? makeSetupCode(s.config) : '';
  return (
    <div className="welcome">
      <div className="mark"><Mark size={44} /></div>
      <h1 className="h1">Connected</h1>
      <p className="tag"><b>{email}</b> is ready.</p>
      <ol className="steps">
        <li>Tap the Share button in Safari, then <b>Add to Home Screen</b> (skip this if Post is already there).</li>
        <li>Open Post from the Home Screen. If it asks for a setup code, tap Copy below first, then Paste.</li>
        <li>Allow notifications when Post asks. In iOS Settings, Notifications, Post, you can leave only <b>Badges</b> on: the number on the icon is all you need.</li>
      </ol>
      <div className="form"><Copy text={code} label="Copy setup code" /><button className="alt" onClick={onContinue}>Read mail here for now</button></div>
    </div>
  );
}

/** A link from the Home Screen app carries the setup code in the address (#add:post1.…). Take it, then tidy the address. */
export function useHandoff(ready: boolean): { done: boolean; wantAdd: boolean } {
  const c = useC();
  const [st, setSt] = useState({ done: false, wantAdd: false });
  useEffect(() => {
    if (!ready) return;
    const cfg = parseSetupCode(location.hash);
    const wantAdd = location.hash.startsWith('#add:');
    if (cfg) { c.setConfig(cfg); history.replaceState(null, '', location.pathname + '#/'); }
    setSt({ done: true, wantAdd: wantAdd && !!cfg });
  }, [c, ready]);
  return st;
}

export function SignInSheet({ onClose }: { onClose: () => void }) {
  return <Sheet title="Add an account" onClose={onClose}><Connect first={false} /></Sheet>;
}
