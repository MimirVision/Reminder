import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Building2, Plus, Search } from 'lucide-react';
import { Page } from '../components/Shell';
import { ClientDialog } from '../components/TaskForms';
import { useStore } from '../data/store';
import { diffDays } from '../lib/dates';
import { formatDue } from '../lib/format';
import { isOpen, type Client } from '../lib/types';
import { Link, useRoute } from '../router';
import { Pill } from '../ui/badges';
import { Button } from '../ui/button';
import { cn } from '../ui/cn';
import { Checkbox } from '../ui/field';
import { EmptyState } from '../ui/states';

type Sort = 'name' | 'open' | 'overdue' | 'next';

export interface ClientStats { open: number; overdue: number; next: string | null; schedules: number }

export function useClientStats(): Map<string, ClientStats> {
  const { snap, today } = useStore();
  return useMemo(() => {
    const m = new Map<string, ClientStats>(snap.clients.map((c) => [c.id, { open: 0, overdue: 0, next: null, schedules: 0 }]));
    for (const o of snap.occurrences) {
      const s = m.get(o.clientId);
      if (!s || !isOpen(o.status)) continue;
      s.open++;
      if (o.dueDate < today) s.overdue++;
      else if (!s.next || o.dueDate < s.next) s.next = o.dueDate;
    }
    for (const sc of snap.schedules) { const s = m.get(sc.clientId); if (s && sc.status !== 'ended') s.schedules++; }
    return m;
  }, [snap.clients, snap.occurrences, snap.schedules, today]);
}

export function Clients() {
  const { snap, today } = useStore();
  const stats = useClientStats();
  const { navigate } = useRoute();
  const [q, setQ] = useState('');
  const [archived, setArchived] = useState(false);
  const [sort, setSort] = useState<{ key: Sort; dir: 1 | -1 }>({ key: 'name', dir: 1 });
  const [creating, setCreating] = useState(false);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = snap.clients.filter((c) => (archived || c.status === 'active') && (!s || `${c.name} ${c.reference ?? ''}`.toLowerCase().includes(s)));
    const val = (c: Client) => {
      const st = stats.get(c.id)!;
      return sort.key === 'name' ? c.name.toLowerCase() : sort.key === 'open' ? st.open : sort.key === 'overdue' ? st.overdue : st.next ?? '9999';
    };
    return list.sort((a, b) => {
      const x = val(a), y = val(b);
      return (x < y ? -1 : x > y ? 1 : a.name.localeCompare(b.name)) * sort.dir;
    });
  }, [snap.clients, q, archived, sort, stats]);

  const header = (key: Sort, label: string, cls = '') => (
    <th className={cn('pr-3 font-medium', cls)} aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button className={cn('inline-flex items-center gap-1 hover:text-ink', sort.key === key && 'text-ink')}
        onClick={() => setSort((s) => ({ key, dir: s.key === key ? (-s.dir as 1 | -1) : key === 'name' || key === 'next' ? 1 : -1 }))}>
        {label}{sort.key === key && (sort.dir === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
      </button>
    </th>
  );
  const archivedCount = snap.clients.filter((c) => c.status === 'archived').length;

  return (
    <Page title="Clients" actions={<Button onClick={() => setCreating(true)}><Plus /> New client</Button>}>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-3" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or reference" aria-label="Search clients"
            className="h-8 w-full rounded-md border border-line-strong bg-surface pr-2 pl-8 text-[13px] placeholder:text-ink-3 focus:border-accent focus:ring-3 focus:ring-accent/15 focus:outline-none" />
        </div>
        {archivedCount > 0 && <Checkbox checked={archived} onChange={setArchived} label={`Show archived (${archivedCount})`} />}
        <span className="tnum ml-auto text-[12.5px] text-ink-3">{rows.length} client{rows.length === 1 ? '' : 's'}</span>
      </div>
      <div className="overflow-hidden rounded-lg border border-line bg-surface shadow-soft">
        {rows.length ? (
          <table className="w-full table-fixed border-collapse">
            <thead>
              <tr className="h-8 border-b border-line text-left text-[11.5px] text-ink-3">
                {header('name', 'Client', 'pl-4')}
                {header('open', 'Open', 'w-20')}
                {header('overdue', 'Overdue', 'w-24')}
                {header('next', 'Next deadline', 'w-36 hidden sm:table-cell')}
                <th className="hidden w-28 pr-4 font-medium md:table-cell">Schedules</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const st = stats.get(c.id)!;
                return (
                  <tr key={c.id} className="h-11 cursor-default border-b border-line last:border-b-0 hover:bg-hover/70" onClick={() => navigate(`/clients/${c.id}`)}>
                    <td className="max-w-0 pr-3 pl-4">
                      <div className="flex items-center gap-2">
                        <Link to={`/clients/${c.id}`} className="truncate text-[13px] font-medium hover:text-accent" onClick={(e) => e.stopPropagation()}>{c.name}</Link>
                        {c.reference && <span className="shrink-0 text-[12px] text-ink-3">{c.reference}</span>}
                        {c.status === 'archived' && <Pill>Archived</Pill>}
                      </div>
                    </td>
                    <td className="tnum pr-3 text-[13px] text-ink-2">{st.open || <span className="text-ink-3">0</span>}</td>
                    <td className="tnum pr-3 text-[13px]">{st.overdue ? <span className="font-medium text-danger">{st.overdue} overdue</span> : <span className="text-ink-3">—</span>}</td>
                    <td className="tnum hidden pr-3 text-[12.5px] text-ink-2 sm:table-cell">
                      {st.next ? <>{formatDue(st.next, today)}<span className="ml-1 text-ink-3">{diffDays(st.next, today) > 1 ? `· ${diffDays(st.next, today)}d` : ''}</span></> : <span className="text-ink-3">—</span>}
                    </td>
                    <td className="tnum hidden pr-4 text-[12.5px] text-ink-3 md:table-cell">{st.schedules} active</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <EmptyState icon={Building2} title={q ? 'No clients match' : 'No clients yet'} body={q ? 'Try another name or reference.' : 'Add your first client, then set up the recurring work you do for them.'}
            action={!q && <Button variant="primary" onClick={() => setCreating(true)}><Plus /> New client</Button>} />
        )}
      </div>
      <ClientDialog open={creating} onOpenChange={setCreating} onSaved={(c) => navigate(`/clients/${c.id}`)} />
    </Page>
  );
}
