// Picks several clients at once, for one task that every one of them needs ("Deliver VAT 12.10" for all VAT clients).
// Quick groups come from the work each client already has: the types of their active schedules, and the pinned ones.
import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { useStore } from '../data/store';
import { TYPE_LABEL } from '../lib/labels';
import { TASK_TYPES, type TaskType } from '../lib/types';
import { cn } from '../ui/cn';

export interface ClientGroup { id: string; label: string; ids: string[]; type?: TaskType }

/** Groups of active clients worth selecting together: by the kind of recurring work they have, pinned, and all. */
export function useClientGroups(): ClientGroup[] {
  const { snap } = useStore();
  return useMemo(() => {
    const active = snap.clients.filter((c) => c.status === 'active');
    const activeIds = new Set(active.map((c) => c.id));
    const byType = new Map<TaskType, Set<string>>();
    for (const s of snap.schedules) {
      if (s.status === 'ended' || !activeIds.has(s.clientId)) continue;
      if (!byType.has(s.taskType)) byType.set(s.taskType, new Set());
      byType.get(s.taskType)!.add(s.clientId);
    }
    const groups: ClientGroup[] = TASK_TYPES.filter((t) => byType.has(t) && t !== 'other' && t !== 'follow_up')
      .map((t) => ({ id: `type-${t}`, label: `${TYPE_LABEL[t]} clients`, ids: [...byType.get(t)!], type: t }));
    const pinned = (snap.workspace.settings.pinnedClients ?? []).filter((id) => activeIds.has(id));
    if (pinned.length) groups.push({ id: 'pinned', label: 'Pinned', ids: pinned });
    groups.push({ id: 'all', label: 'All active', ids: active.map((c) => c.id) });
    return groups;
  }, [snap.clients, snap.schedules, snap.workspace.settings.pinnedClients]);
}

export function ClientsPicker({ selected, onChange, onGroup, exclude, hint }: {
  selected: string[];
  onChange: (ids: string[]) => void;
  /** Called when a group chip is used, so the form can follow (e.g. set the task type to VAT). */
  onGroup?: (g: ClientGroup) => void;
  /** Clients not to offer at all (e.g. the one a schedule is copied from). */
  exclude?: string[];
  /** A short note beside a client's name (e.g. "has one already"). */
  hint?: (clientId: string) => string | null;
}) {
  const { snap } = useStore();
  const all = useClientGroups();
  const groups = useMemo(() => all.map((g) => ({ ...g, ids: g.ids.filter((id) => !exclude?.includes(id)) })).filter((g) => g.ids.length > 0),
    [all, exclude]);
  const [q, setQ] = useState('');
  const clients = useMemo(() => snap.clients.filter((c) => c.status === 'active' && !exclude?.includes(c.id)).sort((a, b) => a.name.localeCompare(b.name)), [snap.clients, exclude]);
  const shown = clients.filter((c) => `${c.name} ${c.reference ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()));
  const on = new Set(selected);
  const toggle = (id: string) => onChange(on.has(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  // A group shows as chosen only when it is exactly the selection, not just a part of it.
  const isExactly = (ids: string[]) => ids.length === on.size && ids.every((id) => on.has(id));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Select a group of clients">
        {groups.map((g) => {
          const active = isExactly(g.ids);
          return (
            <button key={g.id} type="button" aria-pressed={active}
              onClick={() => {
                if (active) onChange(selected.filter((id) => !g.ids.includes(id)));
                else { onChange([...new Set([...selected, ...g.ids])]); onGroup?.(g); }
              }}
              className={cn('inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px] transition-colors',
                active ? 'border-accent/50 bg-accent-soft text-accent-ink' : 'border-line-strong text-ink-2 hover:bg-hover hover:text-ink')}>
              {g.label}<span className="num text-[11px] opacity-70">{g.ids.length}</span>
            </button>
          );
        })}
        {selected.length > 0 && (
          <button type="button" onClick={() => onChange([])} className="h-7 px-2 text-[12px] text-ink-3 hover:text-ink">Clear</button>
        )}
      </div>
      <div className="overflow-clip rounded-lg border border-line-strong">
        <div className="relative border-b border-line">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-3" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a client…" aria-label="Find a client"
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (shown.length === 1) toggle(shown[0].id); } }}
            className="h-8 w-full bg-transparent pr-2 pl-8 text-[12.5px] placeholder:text-ink-3 focus:outline-none" />
        </div>
        <ul className="max-h-52 overflow-y-auto py-1" aria-label="Clients" role="group">
          {shown.map((c) => (
            <li key={c.id}>
              <label className="flex h-8 cursor-pointer items-center gap-2.5 px-2.5 text-[13px] hover:bg-hover">
                <input type="checkbox" className="size-4 shrink-0 accent-[var(--c-accent)]" checked={on.has(c.id)} onChange={() => toggle(c.id)} />
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                {hint?.(c.id) && <span className="shrink-0 text-[11.5px] text-warn">{hint(c.id)}</span>}
                {c.reference && <span className="num shrink-0 text-[11.5px] text-ink-3">{c.reference}</span>}
              </label>
            </li>
          ))}
          {!shown.length && <li className="px-3 py-2 text-[12.5px] text-ink-3">No matches.</li>}
        </ul>
      </div>
      <p className="text-[12px] text-ink-3" aria-live="polite">
        {selected.length ? <><span className="num font-medium text-ink-2">{selected.length}</span> client{selected.length === 1 ? '' : 's'} selected. Each gets its own copy; they aren’t linked.</> : 'Tick the clients that need this task.'}
      </p>
    </div>
  );
}
