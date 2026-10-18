// The fastest way to add work: type one line, press Enter. Recognised parts (client, date, priority, tags) appear as
// chips as you type, so you can see exactly what will be saved, and each chip can be changed with a click.
import { useMemo, useRef, useState } from 'react';
import { Building2, CalendarDays, CornerDownLeft, Flag, Hash, Plus, X } from 'lucide-react';
import { useStore } from '../data/store';
import type { ISODate } from '../lib/dates';
import { formatDue } from '../lib/format';
import { PRIORITY_LABEL } from '../lib/labels';
import { parseQuickAdd } from '../lib/quickadd';
import { PRIORITIES, type Priority, type TaskStatus } from '../lib/types';
import { Popover as P } from 'radix-ui';
import { cn } from '../ui/cn';
import { DatePicker } from '../ui/datepicker';
import { Menu, MenuItem, Popover } from '../ui/overlay';
import { useToast } from '../ui/toast';
import { useUI } from './ui-state';

const chip = 'inline-flex h-6 items-center gap-1 rounded-md border px-2 text-[12px] transition-colors [&_svg]:size-3.5';

export function QuickAdd({ clientId: fixedClient, dueDate: defaultDue, status = 'todo', placeholder, autoFocus, className, variant = 'box' }: {
  clientId?: string; dueDate?: ISODate; status?: TaskStatus; placeholder?: string; autoFocus?: boolean; className?: string;
  /** 'box' stands alone; 'row' sits inside a list as its first row, like ClickUp's "+ Add task". */
  variant?: 'box' | 'row';
}) {
  const { snap, today, clientById, run } = useStore();
  const ui = useUI();
  const toast = useToast();
  const [text, setText] = useState('');
  const [manualClient, setManualClient] = useState<string | null>(null);
  const [manualDue, setManualDue] = useState<ISODate | null>(null);
  const [manualPriority, setManualPriority] = useState<Priority | null>(null);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  const active = useMemo(() => snap.clients.filter((c) => c.status === 'active').sort((a, b) => a.name.localeCompare(b.name)), [snap.clients]);
  const parsed = useMemo(() => parseQuickAdd(text, snap.clients, today), [text, snap.clients, today]);
  const clientId = fixedClient ?? manualClient ?? parsed.clientId;
  const due = manualDue ?? parsed.due ?? defaultDue ?? today;
  const priority = manualPriority ?? parsed.priority ?? 'normal';
  const client = clientId ? clientById.get(clientId) : undefined;

  // "@nor" → suggest clients while the last word is a mention.
  const mention = !fixedClient ? /(?:^|\s)@([^\s@]*)$/.exec(text)?.[1] : undefined;
  const suggestions = useMemo(() => {
    if (mention === undefined) return [];
    const q = mention.toLowerCase();
    return active.filter((c) => !q || c.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(q)) || c.name.toLowerCase().startsWith(q) || c.reference?.toLowerCase().startsWith(q)).slice(0, 6);
  }, [mention, active]);

  const complete = (id: string) => {
    setManualClient(id);
    setText((t) => t.replace(/(?:^|\s)@[^\s@]*$/, '').trimEnd() + ' ');
    setPick(0);
    input.current?.focus();
  };

  const reset = () => { setText(''); setManualClient(null); setManualDue(null); setManualPriority(null); setTried(false); };

  const submit = async () => {
    setTried(true);
    if (!parsed.title || !clientId) return;
    setBusy(true);
    const created = await run((r) => r.createOccurrence({
      clientId, scheduleId: null, title: parsed.title, description: '', taskType: 'follow_up', periodKey: null, periodStart: null, periodEnd: null,
      dueDate: due, scheduledDueDate: null, status, priority, tags: parsed.tags,
    }), { quiet: false });
    setBusy(false);
    if (created) {
      toast.show(`Added for ${client?.name ?? 'client'}, due ${formatDue(due, today).toLowerCase()}`, {});
      reset();
      input.current?.focus();
    }
  };

  const missingClient = tried && !clientId && !!parsed.title;
  const hasText = text.trim().length > 0;

  return (
    <div className={cn(variant === 'box'
      ? cn('rounded-xl border bg-surface shadow-soft transition-[border-color,box-shadow]', hasText ? 'border-accent/50 ring-3 ring-accent/10' : 'border-line-strong hover:border-ink-3/50')
      : cn('transition-colors', hasText ? 'bg-accent-soft/30' : 'hover:bg-hover/50'), className)}>
      <div className={cn('relative flex items-center', variant === 'box' ? 'gap-2.5 px-3.5' : 'gap-2 pr-3 pl-[15px]')}>
        {variant === 'box'
          ? <span className="flex size-[22px] shrink-0 items-center justify-center rounded-[7px] bg-accent-soft text-accent"><Plus className="size-3.5" strokeWidth={2.5} /></span>
          : <Plus className={cn('size-4 shrink-0', hasText ? 'text-accent' : 'text-ink-3')} />}
        <input
          ref={input}
          autoFocus={autoFocus}
          value={text}
          onChange={(e) => { setText(e.target.value); setPick(0); setTried(false); }}
          onKeyDown={(e) => {
            if (suggestions.length) {
              if (e.key === 'ArrowDown') { e.preventDefault(); setPick((p) => (p + 1) % suggestions.length); return; }
              if (e.key === 'ArrowUp') { e.preventDefault(); setPick((p) => (p - 1 + suggestions.length) % suggestions.length); return; }
              if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); complete(suggestions[pick].id); return; }
            }
            if (e.key === 'Enter') { e.preventDefault(); void submit(); }
            if (e.key === 'Escape') { if (hasText) { e.stopPropagation(); reset(); } else input.current?.blur(); }
          }}
          placeholder={placeholder ?? (variant === 'row' ? 'Add task' : fixedClient ? 'Add a task… e.g. “Send year-end questions fri !high”' : 'Add a task… e.g. “Chase receipts @nordvik fri !high #receipts”')}
          aria-label="Quick add a task"
          role="combobox"
          aria-expanded={suggestions.length > 0}
          aria-controls="quickadd-clients"
          className={cn('min-w-0 flex-1 bg-transparent placeholder:text-ink-3 focus:outline-none', variant === 'box' ? 'h-[50px] text-[14.5px]' : 'h-[36px] text-[13px] placeholder:text-ink-3/90')}
        />
        {hasText && (
          <button onClick={() => void submit()} disabled={busy}
            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-accent px-2.5 text-[12px] font-medium text-white hover:bg-accent-hover disabled:opacity-50">
            Add <CornerDownLeft className="size-3.5" />
          </button>
        )}
        {/* Floats in a portal, anchored to the input, so a short table can't clip it. Focus stays in the input. */}
        <P.Root open={suggestions.length > 0}>
          <P.Anchor className="absolute bottom-0 left-8" />
          <P.Portal>
            <P.Content align="start" sideOffset={4} onOpenAutoFocus={(e) => e.preventDefault()} onCloseAutoFocus={(e) => e.preventDefault()}
              className="z-50 w-72 animate-pop-in rounded-lg bg-surface p-1 shadow-pop">
          <ul id="quickadd-clients" role="listbox">
            {suggestions.map((c, i) => (
              <li key={c.id} role="option" aria-selected={i === pick}>
                <button onMouseDown={(e) => { e.preventDefault(); complete(c.id); }} onMouseMove={() => setPick(i)}
                  className={cn('flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px]', i === pick && 'bg-hover')}>
                  <Building2 className="size-3.5 text-ink-3" />
                  <span className="truncate">{c.name}</span>
                  {c.reference && <span className="ml-auto text-[11.5px] text-ink-3">{c.reference}</span>}
                </button>
              </li>
            ))}
          </ul>
            </P.Content>
          </P.Portal>
        </P.Root>
      </div>

      {(hasText || tried) && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-line px-3 py-2">
          {fixedClient ? (
            <span className={cn(chip, 'border-line bg-sunken text-ink-2')}><Building2 />{client?.name}</span>
          ) : (
            <Popover align="start" trigger={
              <button className={cn(chip, clientId ? 'border-line bg-sunken text-ink hover:border-line-strong' : missingClient ? 'border-danger/50 bg-danger-soft text-danger' : 'border-dashed border-line-strong text-ink-3 hover:text-ink')}>
                <Building2 />{client ? client.name : missingClient ? 'Choose a client' : 'Client'}
                {manualClient && <X className="opacity-60" onClick={(e) => { e.stopPropagation(); setManualClient(null); }} />}
              </button>
            }>
              <ClientPicker clients={active} onPick={(id) => { setManualClient(id); input.current?.focus(); }} />
            </Popover>
          )}
          <DatePicker value={due} today={today} onChange={(d) => { setManualDue(d); input.current?.focus(); }} trigger={
            <button className={cn(chip, 'border-line bg-sunken hover:border-line-strong', due < today ? 'text-danger' : due === today ? 'text-accent-ink' : 'text-ink')}>
              <CalendarDays />{formatDue(due, today)}
            </button>
          } />
          <Menu label="Priority" trigger={
            <button className={cn(chip, 'border-line bg-sunken hover:border-line-strong', priority === 'urgent' ? 'text-danger' : priority === 'high' ? 'text-warn' : 'text-ink-2')}>
              <Flag />{PRIORITY_LABEL[priority]}
            </button>
          }>
            {PRIORITIES.map((p) => <MenuItem key={p} onSelect={() => { setManualPriority(p); input.current?.focus(); }}>{PRIORITY_LABEL[p]}</MenuItem>)}
          </Menu>
          {parsed.tags.map((t) => <span key={t} className={cn(chip, 'border-line text-ink-3')}><Hash />{t}</span>)}
          <span className="ml-auto hidden text-[11.5px] text-ink-3 md:inline">
            {missingClient ? <span className="text-danger">Add a client: type @ and a name, or pick one.</span>
              : <>@client · fri, 15.11, in 3 days · ! or !! · #tag · <button className="underline-offset-2 hover:underline" onClick={() => { ui.openNewTask({ clientId: clientId ?? undefined, dueDate: due, title: parsed.title }); reset(); }}>More options</button></>}
          </span>
        </div>
      )}
    </div>
  );
}

function ClientPicker({ clients, onPick }: { clients: { id: string; name: string; reference: string | null }[]; onPick: (id: string) => void }) {
  const [q, setQ] = useState('');
  const shown = clients.filter((c) => `${c.name} ${c.reference ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="w-72 p-1">
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a client…" aria-label="Find a client"
        onKeyDown={(e) => { if (e.key === 'Enter' && shown[0]) onPick(shown[0].id); }}
        className="mb-1 h-8 w-full rounded-md bg-sunken px-2.5 text-[12.5px] placeholder:text-ink-3 focus:ring-2 focus:ring-accent/20 focus:outline-none" />
      <div className="max-h-64 overflow-y-auto">
        {shown.map((c) => (
          <button key={c.id} onClick={() => onPick(c.id)} className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] hover:bg-hover">
            <span className="truncate">{c.name}</span>{c.reference && <span className="ml-auto text-[11.5px] text-ink-3">{c.reference}</span>}
          </button>
        ))}
        {!shown.length && <p className="px-2 py-3 text-[12.5px] text-ink-3">No matching client.</p>}
      </div>
    </div>
  );
}
