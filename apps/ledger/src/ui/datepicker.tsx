import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { addDays, addMonths, isISODate, monthGrid, parts, startOfMonth, weekday, type ISODate } from '../lib/dates';
import { formatDate, formatMonth } from '../lib/format';
import { IconButton } from './button';
import { cn } from './cn';
import { Popover } from './overlay';

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

/** A month calendar with full keyboard support (arrows, Page Up/Down, Home/End, Enter). */
export function MiniCalendar({ value, today, onSelect, marks }: { value: ISODate | null; today: ISODate; onSelect: (d: ISODate) => void; marks?: Set<ISODate> }) {
  const [focus, setFocus] = useState<ISODate>(value ?? today);
  const month = startOfMonth(focus);
  const grid = monthGrid(month);
  const ref = useRef<HTMLDivElement>(null);
  const m = parts(month)[1];
  const byKeyboard = useRef(false);

  useEffect(() => {
    if (byKeyboard.current) ref.current?.querySelector<HTMLButtonElement>(`[data-date="${focus}"]`)?.focus({ preventScroll: true });
  }, [focus]);
  useEffect(() => { if (value) setFocus(value); }, [value]);

  const onKey = (e: React.KeyboardEvent) => {
    const moves: Record<string, () => ISODate> = {
      ArrowLeft: () => addDays(focus, -1), ArrowRight: () => addDays(focus, 1),
      ArrowUp: () => addDays(focus, -7), ArrowDown: () => addDays(focus, 7),
      PageUp: () => addMonths(focus, -1), PageDown: () => addMonths(focus, 1),
      Home: () => addDays(focus, 1 - weekday(focus)), End: () => addDays(focus, 7 - weekday(focus)),
    };
    if (moves[e.key]) { e.preventDefault(); byKeyboard.current = true; setFocus(moves[e.key]()); }
  };

  return (
    <div className="w-[248px] select-none">
      <div className="mb-1 flex items-center justify-between">
        <span className="pl-1 text-[13px] font-semibold">{formatMonth(month)}</span>
        <div className="flex">
          <IconButton size="sm" label="Previous month" onClick={() => setFocus(addMonths(focus, -1))}><ChevronLeft /></IconButton>
          <IconButton size="sm" label="Next month" onClick={() => setFocus(addMonths(focus, 1))}><ChevronRight /></IconButton>
        </div>
      </div>
      <div className="grid grid-cols-7 text-center text-[11px] text-ink-3">
        {WEEKDAYS.map((w) => <div key={w} className="py-1">{w}</div>)}
      </div>
      <div ref={ref} role="grid" className="grid grid-cols-7 gap-y-0.5" onKeyDown={onKey}>
        {grid.map((d) => {
          const inMonth = parts(d)[1] === m;
          const selected = d === value;
          return (
            <button
              key={d}
              data-date={d}
              tabIndex={d === focus ? 0 : -1}
              aria-label={formatDate(d)}
              aria-pressed={selected}
              onClick={() => onSelect(d)}
              className={cn(
                'tnum relative mx-auto flex size-8 items-center justify-center rounded-md text-[12.5px] transition-colors',
                selected ? 'bg-accent font-semibold text-on-accent' : d === today ? 'font-semibold text-accent hover:bg-hover' : inMonth ? 'text-ink hover:bg-hover' : 'text-ink-3/60 hover:bg-hover',
              )}
            >
              {parts(d)[2]}
              {marks?.has(d) && !selected && <span className="absolute bottom-1 size-1 rounded-full bg-ink-3" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function nextWeekday(from: ISODate, wd: number) {
  const n = ((wd - weekday(from) + 7) % 7) || 7;
  return addDays(from, n);
}

/** A date picker in a popover: quick choices plus a calendar. */
export function DatePicker({ value, today, onChange, trigger, align }: { value: ISODate | null; today: ISODate; onChange: (d: ISODate) => void; trigger: ReactNode; align?: 'start' | 'end' }) {
  const [open, setOpen] = useState(false);
  const pick = (d: ISODate) => { onChange(d); setOpen(false); };
  const quick: [string, ISODate][] = [
    ['Today', today], ['Tomorrow', addDays(today, 1)], ['Next Monday', nextWeekday(today, 1)], ['In a week', addDays(today, 7)],
  ];
  const [typed, setTyped] = useState('');
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); setTyped(''); }} trigger={trigger} align={align}>
      <div className="flex gap-3 p-3">
        <div className="flex w-28 flex-col gap-0.5 border-r border-line pr-3">
          {quick.map(([label, d]) => (
            <button key={label} onClick={() => pick(d)} className="flex h-7 items-center rounded-md px-2 text-left text-[12.5px] text-ink-2 hover:bg-hover hover:text-ink">
              {label}
            </button>
          ))}
          <input
            aria-label="Type a date (YYYY-MM-DD)"
            placeholder="YYYY-MM-DD"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && isISODate(typed)) pick(typed); }}
            className={cn('mt-2 h-7 w-full rounded-md border bg-surface px-2 text-[12px] focus:border-accent', typed && !isISODate(typed) ? 'border-danger' : 'border-line')}
          />
        </div>
        <MiniCalendar value={value} today={today} onSelect={pick} />
      </div>
    </Popover>
  );
}
