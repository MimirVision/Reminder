import { useState } from 'react';
import { AlertCircle, Database } from 'lucide-react';
import { friendlyError, supabase } from '../data/config';
import { Button, Label, cn, inputClass } from '../components/ui';

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="pt-safe mx-auto flex min-h-full max-w-sm flex-col justify-center px-5 py-10">
      <div className="mb-8 flex items-center gap-3">
        <div className="hero grid size-12 place-items-center rounded-2xl text-[22px] font-bold text-white shadow-float" aria-hidden>V</div>
        <div>
          <div className="font-display text-[24px] leading-none font-semibold">Vakt</div>
          <div className="text-[13px] text-ink-3">Se hva vaktene dine er verdt</div>
        </div>
      </div>
      {children}
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
    if (!/^\S+@\S+\.\S+$/.test(email)) { setError('Skriv inn e-postadressen din.'); return; }
    if (password.length < (mode === 'up' ? 8 : 1)) { setError(mode === 'up' ? 'Passordet må ha minst 8 tegn.' : 'Skriv inn passordet.'); return; }
    setBusy(true);
    const auth = supabase().auth;
    const { data, error } = mode === 'in' ? await auth.signInWithPassword({ email, password }) : await auth.signUp({ email, password });
    setBusy(false);
    if (error) setError(/Invalid login/i.test(error.message) ? 'Feil e-post eller passord.' : /already registered/i.test(error.message) ? 'Det finnes allerede en konto med denne e-posten. Logg inn i stedet.' : friendlyError(error));
    else if (mode === 'up' && !data.session) setInfo('Sjekk e-posten din og bekreft kontoen, så kan du logge inn.');
  };

  return (
    <Frame>
      <h1 className="text-[22px] font-bold">{mode === 'in' ? 'Logg inn' : 'Lag en konto'}</h1>
      <p className="mt-1 mb-6 text-[14px] text-ink-3">{mode === 'in' ? 'Vaktene dine lagres på kontoen, så de aldri forsvinner.' : 'Gratis. Vaktene dine lagres trygt, og bare du ser dem.'}</p>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <div><Label>E-post</Label><input className={inputClass} type="email" autoComplete="email" aria-label="E-post" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div><Label>Passord</Label><input className={inputClass} type="password" autoComplete={mode === 'in' ? 'current-password' : 'new-password'} aria-label="Passord" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
        {error && <p role="alert" className="flex items-center gap-1.5 text-[14px] text-danger"><AlertCircle className="size-4 shrink-0" />{error}</p>}
        {info && <p role="status" className="rounded-2xl bg-ok-soft px-4 py-3 text-[14px] text-ok">{info}</p>}
        <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Et øyeblikk …' : mode === 'in' ? 'Logg inn' : 'Lag konto'}</Button>
      </form>
      <button className={cn('mt-5 text-[14.5px] font-semibold text-accent-ink')} onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setError(null); setInfo(null); }}>
        {mode === 'in' ? 'Ny her? Lag en konto' : 'Har du konto? Logg inn'}
      </button>
    </Frame>
  );
}

/** Shown when the Supabase project is reachable but Vakt's tables have not been created yet. */
export function NotInstalled({ upgrade }: { upgrade?: boolean }) {
  return (
    <Frame>
      <h1 className="flex items-center gap-2 text-[20px] font-bold"><Database className="size-5 text-ink-3" /> {upgrade ? 'Databasen må oppdateres' : 'Databasen må settes opp'}</h1>
      <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
        {upgrade ? 'Denne versjonen av Vakt trenger noen nye felt i databasen. Ingenting av det du har lagt inn forsvinner.' : 'Du er logget inn, men Vakt sine tabeller finnes ikke i Supabase ennå.'} Åpne <strong>Supabase → SQL Editor → New query</strong>,
        lim inn innholdet i <code className="rounded bg-sunken px-1">apps/vakt/supabase/vakt.sql</code> og trykk <strong>Run</strong>.
      </p>
      <p className="mt-2 text-[13px] text-ink-3">Den lager bare tabeller som heter vakt_* og rører ikke de andre appene.</p>
      <Button className="mt-6 w-full" variant="primary" onClick={() => location.reload()}>Jeg har gjort det – last inn på nytt</Button>
      <button className="mt-4 text-[14px] text-ink-3" onClick={() => void supabase().auth.signOut().then(() => location.reload())}>Logg ut</button>
    </Frame>
  );
}

export function LoadError({ message, retry }: { message: string; retry: () => void }) {
  return (
    <Frame>
      <h1 className="flex items-center gap-2 text-[20px] font-bold"><AlertCircle className="size-5 text-danger" /> Fikk ikke lastet vaktene</h1>
      <p className="mt-2 text-[14px] text-ink-2">{message}</p>
      <p className="mt-1 text-[13px] text-ink-3">Ingenting er endret. Dataene dine ligger trygt i databasen.</p>
      <Button className="mt-6 w-full" variant="primary" onClick={retry}>Prøv igjen</Button>
    </Frame>
  );
}
