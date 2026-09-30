import { FormEvent, useState } from 'react';
import { supabase } from '../lib/supabase';
import { LanguageSwitch, useI18n } from '../i18n';

export function Auth() {
  const { t } = useI18n();
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
    else if (mode === 'up' && !res.data.session) setMsg(t('auth.confirmEmail'));
  }

  return (
    <main className="page narrow">
      <h1>Home Memory</h1>
      <span className="muted">{t('auth.tagline')}</span>
      <form onSubmit={submit}>
        <input type="email" placeholder={t('auth.email')} autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <input
          type="password"
          placeholder={t('auth.password')}
          autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
          minLength={8}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button className="btn primary big" disabled={busy}>{mode === 'in' ? t('auth.signIn') : t('auth.create')}</button>
      </form>
      {msg && <p className="error" role="alert">{msg}</p>}
      <button className="link left" onClick={() => setMode(mode === 'in' ? 'up' : 'in')}>
        {mode === 'in' ? t('auth.toCreate') : t('auth.toSignIn')}
      </button>
      <LanguageSwitch />
    </main>
  );
}
