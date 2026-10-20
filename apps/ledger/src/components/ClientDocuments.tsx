// Documents to collect from a client: bank statements, signed letters, inventory sheets. Each is requested, then
// received; the list shows what is still outstanding and since when.
import { useState } from 'react';
import { Check, FileText, Plus, X } from 'lucide-react';
import { useStore } from '../data/store';
import { diffDays, type ISODate } from '../lib/dates';
import { formatDate } from '../lib/format';
import type { Client, ClientDocument } from '../lib/types';
import { cn } from '../ui/cn';
import { EmptyState } from '../ui/states';
import { newItemId } from './Checklist';

export const outstanding = (c: Pick<Client, 'documents'> | undefined) => (c?.documents ?? []).filter((d) => !d.received);

export function ClientDocuments({ client, disabled }: { client: Client; disabled?: boolean }) {
  const { run, today } = useStore();
  const [text, setText] = useState('');
  const [showReceived, setShowReceived] = useState(false);
  const docs = client.documents ?? [];
  const open = docs.filter((d) => !d.received);
  const received = docs.filter((d) => d.received);

  const save = (next: ClientDocument[], success?: string) => run((r) => r.updateClient(client.id, { documents: next }), { success });
  const add = () => {
    const t = text.trim().slice(0, 300);
    if (!t || docs.length >= 100) return;
    setText('');
    void save([...docs, { id: newItemId(), text: t, received: false, requestedOn: today, receivedOn: null }]);
  };
  const toggle = (d: ClientDocument) => void save(docs.map((x) => (x.id === d.id
    ? { ...x, received: !x.received, receivedOn: x.received ? null : today } : x)), d.received ? 'Marked as outstanding' : `Received: ${d.text}`);
  const remove = (d: ClientDocument) => void save(docs.filter((x) => x.id !== d.id), 'Document removed');

  const row = (d: ClientDocument) => (
    <li key={d.id} className="group flex items-center gap-3 px-4 py-2.5">
      <button role="checkbox" aria-checked={d.received} disabled={disabled} aria-label={`${d.received ? 'Mark as outstanding' : 'Mark as received'}: ${d.text}`} onClick={() => toggle(d)}
        className={cn('flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border-[1.5px] transition-colors',
          d.received ? 'border-ok bg-ok text-white' : 'border-line-strong hover:border-ok')}>
        {d.received && <Check className="size-3" strokeWidth={3} />}
      </button>
      <span className={cn('min-w-0 flex-1 truncate text-[13px]', d.received && 'text-ink-3')}>{d.text}</span>
      <span className="num shrink-0 text-[12px] text-ink-3">
        {d.received ? (d.receivedOn ? `Received ${formatDate(d.receivedOn)}` : 'Received') : d.requestedOn ? <Waiting since={d.requestedOn} today={today} /> : 'Requested'}
      </span>
      {!disabled && (
        <button aria-label={`Remove ${d.text}`} onClick={() => remove(d)}
          className="flex size-7 items-center justify-center rounded-md text-ink-3 opacity-0 group-hover:opacity-100 hover:bg-sunken hover:text-danger focus-visible:opacity-100">
          <X className="size-3.5" />
        </button>
      )}
    </li>
  );

  return (
    <div className="overflow-clip rounded-xl border border-line bg-surface">
      {!disabled && (
        <div className="flex items-center gap-2 border-b border-line px-4">
          <Plus className="size-4 shrink-0 text-ink-3" />
          <input value={text} maxLength={300} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
            placeholder="Request a document… e.g. “Bank statements, October”" aria-label="Request a document"
            className="h-11 min-w-0 flex-1 bg-transparent text-[13px] placeholder:text-ink-3 focus:outline-none" />
          {text.trim() && <button onClick={add} className="h-7 rounded-md bg-accent px-2.5 text-[12px] font-medium text-on-accent hover:bg-accent-hover">Add</button>}
        </div>
      )}
      {docs.length === 0 ? (
        <EmptyState compact icon={FileText} title="No documents requested" body="Keep track of what you’re waiting for from this client: statements, signed letters, exports." />
      ) : (
        <>
          {open.length > 0 ? <ul className="divide-y divide-line/70" aria-label="Outstanding documents">{open.map(row)}</ul>
            : <p className="px-4 py-3 text-[12.5px] text-ok">Everything requested has arrived.</p>}
          {received.length > 0 && (
            <>
              <button onClick={() => setShowReceived((v) => !v)} aria-expanded={showReceived}
                className="flex h-9 w-full items-center gap-2 border-t border-line px-4 text-left text-[12.5px] text-ink-3 hover:bg-hover/60 hover:text-ink">
                <Check className="size-3.5 text-ok" /> <span className="tnum">{received.length}</span> received
              </button>
              {showReceived && <ul className="divide-y divide-line/70 border-t border-line" aria-label="Received documents">{received.map(row)}</ul>}
            </>
          )}
        </>
      )}
    </div>
  );
}

function Waiting({ since, today }: { since: ISODate; today: ISODate }) {
  const n = Math.max(0, diffDays(today, since));
  return <span className={n >= 7 ? 'text-warn' : undefined} title={`Requested ${formatDate(since)}`}>{n === 0 ? 'Requested today' : `Requested ${n}d ago`}</span>;
}
