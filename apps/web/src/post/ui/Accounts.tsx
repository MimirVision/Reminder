import { useState } from 'react';
import type { State } from '../core/controller.ts';
import { accountColour } from '../core/settings.ts';
import { Icon, Sheet } from './ui.tsx';
import { go, useC } from './ctx.tsx';

export function AccountsSheet({ s, onAdd, onClose }: { s: State; onAdd: (hint?: string) => void; onClose: () => void }) {
  const c = useC();
  const [removing, setRemoving] = useState<string | null>(null);
  const emails = s.accounts.map((a) => a.email);
  const pick = (email: string | null) => { c.setAccountFilter(email); onClose(); };
  const status = (a: State['accounts'][number]) => a.needsSignIn ? 'Sign in again to keep syncing' : s.sync.running ? 'Syncing…' : s.sync.at ? 'Synced' : 'Waiting for the first sync';
  return (
    <Sheet title="Accounts" onClose={onClose} action={<button onClick={() => { onClose(); go({ name: 'settings', page: '' }); }}>Settings</button>}>
      <div className="card">
        <button className="it" style={{ minHeight: 64 }} onClick={() => pick(null)}><span className="dotc" style={{ background: 'var(--ink)' }}><Icon n="inbox" size={18} /></span><span><b style={{ display: 'block' }}>All accounts</b><small>Mixed inbox, newest first</small></span>{s.accountFilter === null && <span className="v"><Icon n="check" /></span>}</button>
        {s.accounts.map((a) => (
          <div key={a.email}>
            <div className="it" style={{ minHeight: 64, padding: 0 }}>
              <button className="it" style={{ border: 0, flex: 1, minHeight: 64, background: 'transparent' }} onClick={() => (a.needsSignIn ? onAdd(a.email) : pick(a.email))}>
                <span className="dotc" style={{ background: accountColour(a.email, emails, s.settings.accountColours) }}>{a.label[0]}</span>
                <span><b style={{ display: 'block' }}>{a.email}</b><small><i className={`ok-dot${a.needsSignIn ? ' bad-dot' : ''}`} style={{ width: 8, height: 8, marginRight: 6 }} />{status(a)}</small></span>
                {s.accountFilter === a.email && <span className="v"><Icon n="check" /></span>}
              </button>
              <button className="btn plain" aria-label={`Remove ${a.email}`} onClick={() => setRemoving(removing === a.email ? null : a.email)}><Icon n="more" /></button>
            </div>
            {removing === a.email && (
              <div className="it danger" style={{ flexWrap: 'wrap', background: 'var(--card)' }}>Stop using {a.email} in Post? Your mail stays in Outlook.
                <span className="v"><button className="link" onClick={() => setRemoving(null)}>Cancel</button><button className="link" style={{ color: 'var(--bad)' }} onClick={() => { setRemoving(null); void c.removeAccount(a.email); }}>Remove</button></span></div>
            )}
          </div>
        ))}
      </div>
      <button className="cta" style={{ marginTop: 14, height: 54, fontSize: 16 }} onClick={() => onAdd()}><Icon n="plus" />Add account</button>
    </Sheet>
  );
}
