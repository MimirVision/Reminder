import { useMemo, useState, type ReactNode } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { cn } from '../ui/cn';
import { Popover } from '../ui/overlay';

/** A filter chip that opens a searchable multi-select. */
export function FilterMenu<T extends string>({ label, options, selected, onChange, searchable, summary: named }: {
  label: string; options: { value: T; label: string; hint?: ReactNode }[]; selected: T[]; onChange: (v: T[]) => void; searchable?: boolean;
  /** A name for the current selection when it has one (e.g. "Open" for to do + in progress + waiting). */
  summary?: string;
}) {
  const [q, setQ] = useState('');
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? options.filter((o) => o.label.toLowerCase().includes(s)) : options;
  }, [options, q]);
  const active = selected.length > 0;
  const summary = !active ? label : named ?? (selected.length === 1 ? options.find((o) => o.value === selected[0])?.label ?? label
    : selected.length === 2 ? selected.map((v) => options.find((o) => o.value === v)?.label).join(', ') : `${label}: ${selected.length}`);
  const toggle = (v: T) => onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  return (
    <Popover onOpenChange={() => setQ('')} trigger={
      <button className={cn(
        'inline-flex h-7 max-w-52 items-center gap-1.5 rounded-md border px-2.5 text-[12.5px] transition-colors',
        active ? 'border-accent/40 bg-accent-soft text-accent-ink' : 'border-line-strong bg-surface text-ink-2 hover:bg-hover',
      )}>
        <span className="truncate">{summary}</span>
        <ChevronDown className="size-3.5 shrink-0 opacity-70" />
      </button>
    }>
      <div className="w-64 p-1">
        {searchable && (
          <div className="relative mb-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-3" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Find ${label.toLowerCase()}…`} aria-label={`Find ${label.toLowerCase()}`}
              className="h-8 w-full rounded-md bg-sunken pr-2 pl-8 text-[12.5px] placeholder:text-ink-3 focus:ring-2 focus:ring-accent/20 focus:outline-none" />
          </div>
        )}
        <div role="listbox" aria-multiselectable aria-label={label} className="max-h-72 overflow-y-auto">
          {shown.map((o) => {
            const on = selected.includes(o.value);
            return (
              <button key={o.value} role="option" aria-selected={on} onClick={() => toggle(o.value)}
                className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] hover:bg-hover focus-visible:bg-hover">
                <span className={cn('flex size-4 shrink-0 items-center justify-center rounded border', on ? 'border-accent bg-accent text-on-accent' : 'border-line-strong')}>
                  {on && <Check className="size-3" strokeWidth={3} />}
                </span>
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {o.hint && <span className="shrink-0 text-[11.5px] text-ink-3">{o.hint}</span>}
              </button>
            );
          })}
          {!shown.length && <p className="px-2 py-3 text-[12.5px] text-ink-3">No matches.</p>}
        </div>
        {active && (
          <button onClick={() => onChange([])} className="mt-1 h-8 w-full rounded-md border-t border-line text-[12.5px] text-ink-3 hover:text-ink">Clear</button>
        )}
      </div>
    </Popover>
  );
}
