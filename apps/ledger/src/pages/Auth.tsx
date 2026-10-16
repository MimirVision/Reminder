import { useState } from 'react';
import { AlertCircle, Copy, Database } from 'lucide-react';
import { setDemoChoice, supabase } from '../data/config';
import { friendlyError } from '../data/repo';
import { Button } from '../ui/button';
import { Field, Input } from '../ui/field';

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-lg bg-ink text-[14px] font-semibold text-canvas" aria-hidden>L</div>
          <span className="text-[16px] font-semibold tracking-[-0.01em]">Ledger</span>
        </div>
        {children}
      </div>
    </div>
  );
}

export function SignIn() {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null); setInfo(null);
    if (!/^\S+@\S+\.\S+$/.test(email)) { setError('Enter your email address.'); return; }
    if (password.length < (mode === 'up' ? 8 : 1)) { setError(mode === 'up' ? 'Use at least 8 characters.' : 'Enter your password.'); return; }
    setBusy(true);
    const auth = supabase().auth;
    const { data, error } = mode === 'in' ? await auth.signInWithPassword({ email, password }) : await auth.signUp({ email, password });
    setBusy(false);
    if (error) setError(/Invalid login/i.test(error.message) ? 'Email or password is incorrect.' : friendlyError(error));
    else if (mode === 'up' && !data.session) setInfo('Check your email to confirm the account, then sign in.');
  };

  return (
    <Frame>
      <h1 className="text-[20px] font-semibold tracking-[-0.02em]">{mode === 'in' ? 'Sign in' : 'Create an account'}</h1>
      <p className="mt-1 mb-6 text-[13px] text-ink-3">Your accounting workspace. The same account as Home Memory works here; the data is kept separately.</p>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <Field label="Email">{(p) => <Input {...p} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
        <Field label="Password">{(p) => <Input {...p} type="password" autoComplete={mode === 'in' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
        {error && <p role="alert" className="flex items-center gap-1.5 text-[12.5px] text-danger"><AlertCircle className="size-3.5" />{error}</p>}
        {info && <p role="status" className="text-[12.5px] text-ok">{info}</p>}
        <Button type="submit" variant="primary" loading={busy}>{mode === 'in' ? 'Sign in' : 'Create account'}</Button>
      </form>
      <div className="mt-5 flex flex-col gap-2 text-[12.5px] text-ink-3">
        <button className="text-left hover:text-ink" onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setError(null); }}>
          {mode === 'in' ? 'No account? Create one' : 'Have an account? Sign in'}
        </button>
        <button className="text-left hover:text-ink" onClick={() => { setDemoChoice(true); location.reload(); }}>
          Explore with fictional demo data instead (stored in this browser only)
        </button>
      </div>
    </Frame>
  );
}

/** Shown when the Supabase project is reachable but Ledger's tables have not been created yet. */
export function NotInstalled() {
  const [copied, setCopied] = useState(false);
  return (
    <Frame>
      <h1 className="flex items-center gap-2 text-[20px] font-semibold tracking-[-0.02em]"><Database className="size-5 text-ink-3" /> One-time database setup</h1>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
        You’re signed in, but Ledger’s tables don’t exist in this Supabase project yet. Open <strong>Supabase → SQL Editor → New query</strong>,
        paste the contents of <code className="rounded bg-sunken px-1">apps/ledger/supabase/ledger.sql</code> and press <strong>Run</strong>.
      </p>
      <p className="mt-2 text-[12.5px] text-ink-3">It only creates objects named <code>ledger_*</code> and never changes Home Memory or Post. It is safe to run again.</p>
      <div className="mt-5 flex gap-2">
        <Button variant="primary" onClick={() => location.reload()}>I’ve run it, reload</Button>
        <Button onClick={() => { void navigator.clipboard?.writeText('apps/ledger/supabase/ledger.sql'); setCopied(true); }}><Copy /> {copied ? 'Copied' : 'Copy file path'}</Button>
      </div>
      <button className="mt-4 text-[12.5px] text-ink-3 hover:text-ink" onClick={() => void supabase().auth.signOut().then(() => location.reload())}>Sign out</button>
    </Frame>
  );
}

export function LoadError({ message, retry }: { message: string; retry: () => void }) {
  return (
    <Frame>
      <h1 className="flex items-center gap-2 text-[18px] font-semibold"><AlertCircle className="size-5 text-danger" /> Couldn’t load your workspace</h1>
      <p className="mt-2 text-[13px] text-ink-2">{message}</p>
      <p className="mt-1 text-[12.5px] text-ink-3">Nothing has been changed. Your data is safe in the database.</p>
      <Button className="mt-5" variant="primary" onClick={retry}>Try again</Button>
    </Frame>
  );
}
