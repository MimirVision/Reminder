import { FormEvent, useState } from 'react';
import { createHousehold, joinHousehold } from '../lib/api';

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('');
  const [houseName, setHouseName] = useState('Home');
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page narrow">
      <h1>Welcome</h1>
      <input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
      <h2 style={{ marginTop: 12 }}>Start a new household</h2>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); void run(() => createHousehold(houseName, name)); }}>
        <input placeholder="Household name" required value={houseName} onChange={(e) => setHouseName(e.target.value)} />
        <button className="btn primary" disabled={busy}>Create</button>
      </form>
      <h2 style={{ marginTop: 12 }}>…or join one</h2>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); void run(() => joinHousehold(code, name)); }}>
        <input placeholder="Invite code from your partner" required value={code} onChange={(e) => setCode(e.target.value)} />
        <button className="btn" disabled={busy}>Join</button>
      </form>
      {err && <p className="error">{err}</p>}
    </main>
  );
}
