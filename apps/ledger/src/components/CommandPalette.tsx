import { useEffect, useMemo, useState } from 'react';
import { Dialog as D } from 'radix-ui';
import { Building2, CalendarDays, CornerDownLeft, Home, ListChecks, Plus, Repeat, Search, SearchCheck, Settings } from 'lucide-react';
import { useStore } from '../data/store';
import { formatDue } from '../lib/format';
import { parseQuickAdd } from '../lib/quickadd';
import { isOpen } from '../lib/types';
import { useRoute } from '../router';
import { cn } from '../ui/cn';
import { fromLines } from './Checklist';
import { useUI } from './ui-state';

interface Item { id: string; label: string; hint?: string; icon: typeof Home; group: string; run: () => void }

/** Ctrl/⌘ K: jump to any screen, client, schedule or task, or start something new. */
export function CommandPalette() {
  const ui = useUI();
  const { navigate } = useRoute();
  const { snap, clientById, today, run } = useStore();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).closest('input,textarea,select,[contenteditable]');
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); ui.setPalette(true); }
      else if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey && e.key === 'n' && !document.querySelector('[role=dialog]')) { e.preventDefault(); ui.openNewTask(); }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [ui]);
  useEffect(() => { if (ui.palette) { setQ(''); setActive(0); } }, [ui.palette]);

  const items = useMemo<Item[]>(() => {
    const go = (to: string) => () => navigate(to);
    const base: Item[] = [
      { id: 'new-task', label: 'New task', icon: Plus, group: 'Actions', run: () => ui.openNewTask() },
      { id: 'new-schedule', label: 'New recurring schedule', icon: Repeat, group: 'Actions', run: () => ui.openSchedule({ mode: 'new' }) },
      { id: 'home', label: 'Home', icon: Home, group: 'Go to', run: go('/') },
      { id: 'tasks', label: 'My Tasks', icon: ListChecks, group: 'Go to', run: go('/tasks') },
      { id: 'overdue', label: 'Overdue tasks', icon: ListChecks, group: 'Go to', run: go('/tasks?view=overdue') },
      ...(snap.workspace.settings.savedViews ?? []).map((v) => ({ id: `view-${v.id}`, label: v.name, icon: ListChecks, group: 'Go to', hint: 'Saved view', run: go(`/tasks?${v.query}`) })),
      { id: 'waiting', label: 'Waiting for client', icon: ListChecks, group: 'Go to', run: go('/tasks?view=waiting') },
      { id: 'calendar', label: 'Calendar', icon: CalendarDays, group: 'Go to', run: go('/calendar') },
      { id: 'clients', label: 'Clients', icon: Building2, group: 'Go to', run: go('/clients') },
      { id: 'recurring', label: 'Recurring Work', icon: Repeat, group: 'Go to', run: go('/recurring') },
      { id: 'missing', label: 'Missing Tasks', icon: SearchCheck, group: 'Go to', run: go('/missing') },
      { id: 'settings', label: 'Settings', icon: Settings, group: 'Go to', run: go('/settings') },
    ];
    const s = q.trim().toLowerCase();
    if (!s) return base;
    // Typing a task straight into search: offer to create it (with the quick-add shorthand).
    const draft = parseQuickAdd(q, snap.clients, today);
    const create: Item[] = draft.title && draft.clientId ? [{
      id: 'create', label: `Create “${draft.title}”`, icon: Plus, group: 'Create',
      hint: `${clientById.get(draft.clientId)?.name} · ${formatDue(draft.due ?? today, today)}`,
      run: () => void run((r) => r.createOccurrence({
        clientId: draft.clientId!, scheduleId: null, title: draft.title, description: '', taskType: 'follow_up', periodKey: null, periodStart: null,
        periodEnd: null, dueDate: draft.due ?? today, scheduledDueDate: null, status: 'todo', priority: draft.priority ?? 'normal', tags: draft.tags,
        checklist: fromLines(snap.workspace.settings.checklistTemplates?.follow_up),
      }), { success: 'Task created' }),
    }] : [{ id: 'create', label: `New task “${draft.title || q.trim()}”…`, icon: Plus, group: 'Create', hint: 'add @client to create it right away', run: () => ui.openNewTask({ title: q.trim() }) }];
    const words = s.split(/\s+/);
    const hit = (t: string) => words.every((w) => t.toLowerCase().includes(w));
    const out = base.filter((i) => hit(i.label));
    for (const c of snap.clients) if (hit(`${c.name} ${c.reference ?? ''}`)) out.push({ id: c.id, label: c.name, hint: c.reference ?? undefined, icon: Building2, group: 'Clients', run: go(`/clients/${c.id}`) });
    for (const sc of snap.schedules) {
      const cn = clientById.get(sc.clientId)?.name ?? '';
      if (hit(`${sc.title} ${cn}`)) out.push({ id: sc.id, label: sc.title, hint: cn, icon: Repeat, group: 'Schedules', run: () => ui.openSchedule({ mode: 'edit', id: sc.id }) });
    }
    const tasks = snap.occurrences.filter((o) => hit(`${o.title} ${clientById.get(o.clientId)?.name ?? ''} ${o.tags.join(' ')}`))
      .sort((a, b) => Number(isOpen(b.status)) - Number(isOpen(a.status)) || a.dueDate.localeCompare(b.dueDate)).slice(0, 30);
    for (const o of tasks) out.push({ id: o.id, label: o.title, hint: `${clientById.get(o.clientId)?.name ?? ''} · ${formatDue(o.dueDate, today)}${isOpen(o.status) ? '' : ' · closed'}`, icon: ListChecks, group: 'Tasks', run: () => ui.openTask(o.id) });
    return [...out.slice(0, 59), ...create];
  }, [q, snap, clientById, today, navigate, ui, run]);

  const pick = (i: Item | undefined) => { if (!i) return; ui.setPalette(false); i.run(); };
  let lastGroup = '';

  return (
    <D.Root open={ui.palette} onOpenChange={ui.setPalette}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 animate-fade-in bg-[rgb(20_20_28/0.28)]" />
        <D.Content className="fixed top-[14vh] left-1/2 z-50 w-[calc(100vw-32px)] max-w-xl -translate-x-1/2 animate-pop-in overflow-hidden rounded-xl bg-surface shadow-pop focus:outline-none">
          <D.Title className="sr-only">Search or jump to</D.Title>
          <D.Description className="sr-only">Type to search clients, schedules and tasks. Use the arrow keys and Enter.</D.Description>
          <div className="flex items-center gap-2.5 border-b border-line px-4">
            <Search className="size-4 text-ink-3" />
            <input
              autoFocus value={q} onChange={(e) => { setQ(e.target.value); setActive(0); }}
              placeholder="Search clients, schedules, tasks… or jump to a page"
              aria-label="Search" role="combobox" aria-expanded aria-controls="palette-list" aria-activedescendant={items[active] ? `pal-${items[active].id}` : undefined}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)); }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
                else if (e.key === 'Enter') { e.preventDefault(); pick(items[active]); }
              }}
              className="h-12 flex-1 bg-transparent text-[14px] placeholder:text-ink-3 focus:outline-none"
            />
          </div>
          <div id="palette-list" role="listbox" className="max-h-[50vh] overflow-y-auto p-1.5">
            {items.length === 0 && <p className="px-3 py-6 text-center text-[13px] text-ink-3">Nothing found for “{q}”.</p>}
            {items.map((i, n) => {
              const header = i.group !== lastGroup ? (lastGroup = i.group) : null;
              return (
                <div key={`${i.group}-${i.id}`}>
                  {header && <div className="px-2.5 pt-2 pb-1 text-[11px] font-medium tracking-wide text-ink-3 uppercase">{header}</div>}
                  <div id={`pal-${i.id}`} role="option" aria-selected={n === active} onMouseMove={() => setActive(n)} onClick={() => pick(i)}
                    className={cn('flex h-9 cursor-default items-center gap-2.5 rounded-md px-2.5 text-[13px]', n === active && 'bg-hover')}>
                    <i.icon className="size-4 shrink-0 text-ink-3" />
                    <span className="truncate">{i.label}</span>
                    {i.hint && <span className="truncate text-[12px] text-ink-3">{i.hint}</span>}
                    {n === active && <CornerDownLeft className="ml-auto size-3.5 shrink-0 text-ink-3" />}
                  </div>
                </div>
              );
            })}
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
