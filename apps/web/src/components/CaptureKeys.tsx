import { useCallback, useEffect, useState } from 'react';
import { createCaptureKey, deleteCaptureKey, listCaptureKeys, type CaptureKey } from '../lib/api';
import type { Household } from '../lib/types';

export function CaptureKeys({ household }: { household: Household }) {
  const [keys, setKeys] = useState<CaptureKey[]>([]);
  const [label, setLabel] = useState('iPhone Shortcut');
  const [fresh, setFresh] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setKeys(await listCaptureKeys());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(fn: () => Promise<void>) {
    try {
      setErr(null);
      await fn();
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  const endpoint = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/rpc/capture_memory`;

  return (
    <main>
      <h2>Quick capture</h2>
      <p className="muted">
        A capture key lets an iOS Shortcut (Siri, Action button, share sheet) or a script drop a memory into your
        inbox without opening the app. See <code>docs/CAPTURE.md</code> for the step-by-step recipe.
      </p>
      {err && <p className="error">{err}</p>}
      <ul className="list">
        {keys.length === 0 && <li className="muted">No capture keys yet.</li>}
        {keys.map((k) => (
          <li key={k.id} className="item row spread">
            <span>
              <strong>{k.label}</strong>
              <span className="muted"> · created {new Date(k.created_at).toLocaleDateString()}
                {k.last_used_at ? ` · last used ${new Date(k.last_used_at).toLocaleDateString()}` : ' · never used'}</span>
            </span>
            <button className="danger" onClick={() => confirm('Revoke this key? Shortcuts using it will stop working.') && void run(() => deleteCaptureKey(k.id))}>Revoke</button>
          </li>
        ))}
      </ul>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => setFresh(await createCaptureKey(household.id, label)));
        }}
      >
        <input value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Key label" />
        <button className="primary">Create key</button>
      </form>
      {fresh && (
        <div className="item">
          <span className="muted">Copy this key now. It is shown only once:</span>
          <code style={{ wordBreak: 'break-all' }}>{fresh}</code>
        </div>
      )}
      <h3>Endpoint for the Shortcut</h3>
      <code style={{ wordBreak: 'break-all' }}>{endpoint}</code>
    </main>
  );
}
