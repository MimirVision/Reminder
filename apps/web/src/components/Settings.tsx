import { useCallback, useEffect, useState } from 'react';
import { createCaptureKey, deleteCaptureKey, listCaptureKeys, type CaptureKey } from '../lib/api';
import { applyGlass, getGlass, GLASS_LEVELS, type GlassLevel } from '../lib/glass';
import { supabase } from '../lib/supabase';
import type { Household } from '../lib/types';

export function Settings({ household }: { household: Household }) {
  const [keys, setKeys] = useState<CaptureKey[]>([]);
  const [label, setLabel] = useState('iPhone Shortcut');
  const [fresh, setFresh] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [glass, setGlass] = useState<GlassLevel>(getGlass);

  const load = useCallback(async () => {
    try { setKeys(await listCaptureKeys()); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function run(fn: () => Promise<void>) {
    try { setErr(null); await fn(); await load(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }

  const endpoint = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/rpc/capture_memory`;

  return (
    <main className="page">
      <h1>Settings</h1>
      {err && <p className="error">{err}</p>}

      <section className="card">
        <h2>Glass</h2>
        <span className="muted">How see-through the floating bars are.</span>
        <div className="row">
          {GLASS_LEVELS.map((g) => (
            <button key={g.id} className={`btn small${glass === g.id ? ' primary' : ''}`} onClick={() => { setGlass(g.id); applyGlass(g.id); }}>{g.label}</button>
          ))}
        </div>
        <div className="glass" style={{ borderRadius: 22, padding: 14 }}>Preview: this is how the bars look</div>
      </section>

      <section className="card">
        <h2>Quick add (Siri, Action button, share sheet)</h2>
        <span className="muted">
          A key lets an iOS Shortcut or a script add a to-do without opening the app. See <code>docs/CAPTURE.md</code> for the recipe.
        </span>
        {keys.length === 0 && <span className="muted">No keys yet.</span>}
        {keys.map((k) => (
          <div key={k.id} className="row spread">
            <span>{k.label}<span className="muted"> · {k.last_used_at ? `last used ${new Date(k.last_used_at).toLocaleDateString()}` : 'never used'}</span></span>
            <button className="btn small danger" onClick={() => confirm('Revoke this key? Shortcuts using it will stop working.') && void run(() => deleteCaptureKey(k.id))}>Revoke</button>
          </div>
        ))}
        <form className="row" onSubmit={(e) => { e.preventDefault(); void run(async () => setFresh(await createCaptureKey(household.id, label))); }}>
          <input style={{ flex: 1 }} value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Key label" />
          <button className="btn primary small">Create key</button>
        </form>
        {fresh && <div><span className="muted">Copy this key now. It is shown only once:</span><br /><code>{fresh}</code></div>}
        <span className="muted">Endpoint for the Shortcut:</span>
        <code>{endpoint}</code>
      </section>

      <section className="card">
        <h2>Household</h2>
        <span>{household.name}</span>
        <span className="muted">Invite code for your partner: <code>{household.invite_code}</code></span>
      </section>

      <button className="btn danger" onClick={() => supabase.auth.signOut()}>Sign out</button>
    </main>
  );
}
