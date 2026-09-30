import { FormEvent, useState } from 'react';
import { supabase } from '../lib/supabase';

export function Auth() {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const res =
      mode === 'in'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });
    setBusy(false);
    if (res.error) setMsg(res.error.message);
    else if (mode === 'up' && !res.data.session) setMsg('Check your email to confirm the account, then sign in.');
  }

  return (
    <main className="page narrow">
      <h1>Home Memory</h1>
      <span className="muted">To-dos that remind you in the right place, and a calendar for the house.</span>
      <form onSubmit={submit}>
        <input type="email" placeholder="Email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <input
          type="password"
          placeholder="Password (min 8 characters)"
          autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
          minLength={8}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button className="btn primary" disabled={busy}>{mode === 'in' ? 'Sign in' : 'Create account'}</button>
      </form>
      {msg && <p className="error">{msg}</p>}
      <button className="link" style={{ textAlign: "left" }} onClick={() => setMode(mode === 'in' ? 'up' : 'in')}>
        {mode === 'in' ? 'New here? Create an account' : 'Have an account? Sign in'}
      </button>
    </main>
  );
}
