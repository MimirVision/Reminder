import { useState } from 'react';
import type { State } from '../core/controller.ts';
import { isFreemail, orgDomain } from '../core/classify.ts';
import { SWEEP_OLDER_DAYS, sweepCompany, sweepPlan, type SweepScope, type SweepWay } from '../core/sweep.ts';
import type { Mail } from '../core/types.ts';
import { Icon, Seg, Sheet } from './ui.tsx';
import { useC, useNow } from './ctx.tsx';

// The two "do something about this sender" sheets, used from the reader (More) and from the Subscriptions page.

/**
 * Block this sender, or everything from their company. Their mail then goes to Junk, now and whenever Post is open; nothing is deleted, and
 * Undo (or Settings, Sorting, Blocked senders) lifts it again. The company choice is not offered for a shared mail provider.
 */
export function BlockSheet({ s, m, onClose, onBlocked }: { s: State; m: Mail; onClose: () => void; onBlocked: () => void }) {
  const c = useC();
  const domain = orgDomain(m.fromAddress);
  const canCompany = !!domain && !isFreemail(domain);
  const addr = m.fromAddress.trim().toLowerCase();
  const doBlock = (scope: 'sender' | 'company') => { void c.blockSender(m.fromAddress, scope); onClose(); onBlocked(); };
  const already = (k: string) => s.blocked.includes(k);
  return (
    <Sheet title="Block this sender?" onClose={onClose}>
      <p className="note">Their mail goes to Junk, now and whenever Post is open. Nothing is deleted, and you can undo it here or in Settings, Sorting.</p>
      <div className="card">
        <button className="it" disabled={already(addr)} onClick={() => doBlock('sender')}><span className="ico"><Icon n="ban" /></span><span className="rw">Block {addr}<small>{already(addr) ? 'Already blocked' : 'Only this address'}</small></span></button>
        {canCompany && <button className="it" disabled={already(`@${domain}`)} onClick={() => doBlock('company')}><span className="ico"><Icon n="ban" /></span><span className="rw">Block everything from {domain}<small>{already(`@${domain}`) ? 'Already blocked' : 'Every address and sub-domain of the company'}</small></span></button>}
        <button className="it" onClick={onClose}>Cancel</button>
      </div>
    </Sheet>
  );
}

/** Clear what a sender (or a company) has piled up in the inbox, with one Undo: archive it all, delete it all, keep only the newest, or only the old ones. */
export function SweepSheet({ s, m, onClose, onSwept }: { s: State; m: Mail; onClose: () => void; onSwept: (openedGone: boolean) => void }) {
  const c = useC();
  const now = useNow();
  const company = sweepCompany(m.fromAddress);
  const addr = m.fromAddress.trim().toLowerCase();
  const [scope, setScope] = useState<SweepScope>('sender');
  const plan = (way: SweepWay) => sweepPlan(s.mail, addr, scope, way, now, s.settings.threads);
  const WAYS: [SweepWay, string, string, string][] = [
    ['archive', 'archive', 'Archive everything', 'All of it goes to Archive'],
    ['keepNewest', 'inbox', 'Keep the newest, archive the rest', 'The latest one stays in the inbox'],
    ['older', 'archive', `Archive what is older than ${SWEEP_OLDER_DAYS} days`, 'Newer mail stays'],
    ['delete', 'trash', 'Delete everything', 'All of it goes to Deleted'],
  ];
  const run = (way: SweepWay) => {
    const p = plan(way);
    if (!p.items.length) return;
    const gone = p.items.some((x) => x.key === m.key);
    if (way === 'delete') void c.trash(p.items, p.rows); else void c.archive(p.items, p.rows);
    onClose();
    onSwept(gone);
  };
  return (
    <Sheet title="Sweep this sender" onClose={onClose}>
      <p className="note">Clears what is in your inbox from them, in one move with Undo. Mail you flagged stays, and nothing is deleted for good.</p>
      {company && <Seg label="Who to sweep" value={scope} options={[['sender', addr], ['company', `All of ${company}`]]} onChange={setScope} />}
      <div className="card">
        {WAYS.map(([way, icon, title, sub]) => { const n = plan(way); return (
          <button key={way} className={`it${way === 'delete' ? ' danger' : ''}`} disabled={!n.items.length} onClick={() => run(way)}><span className="ico"><Icon n={icon} /></span><span className="rw">{title}<small>{n.items.length ? sub : 'Nothing to sweep'}</small></span><span className="v">{n.rows || ''}</span></button>
        ); })}
        <button className="it" onClick={onClose}>Cancel</button>
      </div>
    </Sheet>
  );
}
