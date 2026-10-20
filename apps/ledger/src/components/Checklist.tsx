// Checklists: the steps inside a task ("Reconcile bank", "Send questions"), and the templates schedules and task
// types hand to new tasks. One editor for both; templates have no ticks.
import { useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { Check, GripVertical, Plus, X } from 'lucide-react';
import type { ChecklistItem } from '../lib/types';
import { cn } from '../ui/cn';

export const MAX_ITEMS = 50;

export const newItemId = () => (globalThis.crypto?.randomUUID?.() ?? `i-${Date.now()}-${Math.random().toString(36).slice(2)}`).slice(0, 36);

/** Template lines as fresh, unticked items. */
export const fromLines = (lines: string[] | undefined): ChecklistItem[] =>
  (lines ?? []).map((text) => text.trim()).filter(Boolean).map((text) => ({ id: newItemId(), text, done: false }));

export function progressOf(items: ChecklistItem[] | undefined) {
  const total = items?.length ?? 0;
  const done = items?.filter((i) => i.done).length ?? 0;
  return { done, total, complete: total > 0 && done === total };
}

/** "2/4" next to a task's title, green when everything is ticked. */
export function ChecklistBadge({ items, className }: { items: ChecklistItem[] | undefined; className?: string }) {
  const { done, total, complete } = progressOf(items);
  if (!total) return null;
  return (
    <span title={`Checklist: ${done} of ${total} done`} aria-label={`Checklist ${done} of ${total} done`}
      className={cn('inline-flex shrink-0 items-center gap-1 rounded-[5px] px-1.5 py-px text-[11px]', complete ? 'bg-ok-soft text-ok' : 'bg-sunken text-ink-2', className)}>
      <Check className="size-3" strokeWidth={2.6} /><span className="num">{done}/{total}</span>
    </span>
  );
}

export function ChecklistEditor({ items, onChange, template, label = 'Checklist', disabled }: {
  items: ChecklistItem[];
  onChange: (next: ChecklistItem[]) => void;
  /** A template: no ticks, and nothing is "done". */
  template?: boolean;
  label?: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [dragId, setDragId] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const { done, total } = progressOf(items);
  const full = items.length >= MAX_ITEMS;

  const add = (raw = text) => {
    const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => l.slice(0, 300));
    if (!lines.length || full) return;
    onChange([...items, ...lines.slice(0, MAX_ITEMS - items.length).map((t) => ({ id: newItemId(), text: t, done: false }))]);
    setText('');
  };
  const commitEdit = (id: string) => {
    const t = draft.trim().slice(0, 300);
    setEditing(null);
    if (!t) onChange(items.filter((i) => i.id !== id));
    else if (t !== items.find((i) => i.id === id)?.text) onChange(items.map((i) => (i.id === id ? { ...i, text: t } : i)));
  };
  const move = (id: string, to: number) => {
    const from = items.findIndex((i) => i.id === id);
    if (from < 0 || to < 0 || to >= items.length || from === to) return;
    const next = [...items];
    const [it] = next.splice(from, 1);
    next.splice(to, 0, it);
    onChange(next);
  };
  const onItemKey = (e: KeyboardEvent, id: string, i: number) => {
    if (e.altKey && e.key === 'ArrowUp') { e.preventDefault(); move(id, i - 1); }
    if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); move(id, i + 1); }
  };
  const onDrop = (e: DragEvent, i: number) => {
    e.preventDefault();
    if (dragId) move(dragId, i);
    setDragId(null);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span className="text-[12px] font-medium text-ink-2">{label}</span>
        {!template && total > 0 && (
          <>
            <span className="num text-[11.5px] text-ink-3">{done}/{total}</span>
            <span className="h-1 flex-1 overflow-hidden rounded-full bg-sunken" aria-hidden>
              <span className={cn('block h-full rounded-full transition-[width] duration-300', done === total ? 'bg-ok' : 'bg-accent')} style={{ width: `${(done / total) * 100}%` }} />
            </span>
          </>
        )}
      </div>
      {items.length > 0 && (
        <ul className="flex flex-col" aria-label={label}>
          {items.map((it, i) => (
            <li key={it.id} draggable={!disabled && editing !== it.id}
              onDragStart={(e) => { setDragId(it.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/ledger-item', it.id); }}
              onDragOver={(e) => { if (dragId) e.preventDefault(); }} onDrop={(e) => onDrop(e, i)} onDragEnd={() => setDragId(null)}
              onKeyDown={(e) => onItemKey(e, it.id, i)}
              className={cn('group flex min-h-8 items-center gap-2 rounded-md pr-1 hover:bg-hover/70', dragId === it.id && 'opacity-40')}>
              <GripVertical className="size-3.5 shrink-0 cursor-grab text-ink-3/0 group-hover:text-ink-3" aria-hidden />
              {!template && (
                <button type="button" role="checkbox" aria-checked={it.done} disabled={disabled} aria-label={`${it.done ? 'Untick' : 'Tick'} “${it.text}”`}
                  onClick={() => onChange(items.map((x) => (x.id === it.id ? { ...x, done: !x.done } : x)))}
                  className={cn('flex size-4 shrink-0 items-center justify-center rounded-[5px] border-[1.5px] transition-colors',
                    it.done ? 'border-ok bg-ok text-white' : 'border-line-strong hover:border-ok')}>
                  {it.done && <Check className="size-3" strokeWidth={3} />}
                </button>
              )}
              {editing === it.id ? (
                <input autoFocus data-escape-local value={draft} maxLength={300} aria-label="Edit item" onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => commitEdit(it.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitEdit(it.id); } if (e.key === 'Escape') { setEditing(null); } }}
                  className="h-7 min-w-0 flex-1 rounded border border-accent/50 bg-surface px-1.5 text-[13px] focus:outline-none" />
              ) : (
                <button type="button" disabled={disabled} onClick={() => { setEditing(it.id); setDraft(it.text); }} title="Click to edit · Alt + ↑↓ to move"
                  className={cn('min-w-0 flex-1 py-1 text-left text-[13px] leading-snug', it.done && 'text-ink-3 line-through decoration-ink-3/50')}>
                  {it.text}
                </button>
              )}
              <button type="button" aria-label={`Remove “${it.text}”`} disabled={disabled} onClick={() => onChange(items.filter((x) => x.id !== it.id))}
                className="flex size-6 shrink-0 items-center justify-center rounded text-ink-3 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-sunken hover:text-danger focus-visible:opacity-100">
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {!disabled && (
        <div className="flex items-center gap-2 rounded-md border border-dashed border-line-strong px-2 focus-within:border-accent/60 focus-within:border-solid">
          <Plus className="size-3.5 shrink-0 text-ink-3" />
          <input ref={input} value={text} disabled={full} maxLength={2000}
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => {
              // Pasting several lines adds one item per line.
              const t = e.clipboardData.getData('text');
              if (t.includes('\n')) { e.preventDefault(); add(text + t); }
            }}
            data-escape-local={text ? '' : undefined}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } if (e.key === 'Escape' && text) setText(''); }}
            onBlur={() => add()}
            placeholder={full ? `Up to ${MAX_ITEMS} items` : template ? 'Add a step every task starts with' : 'Add an item'}
            aria-label={template ? `Add a step to the ${label.toLowerCase()}` : `Add an item to the ${label.toLowerCase()}`}
            className="h-8 min-w-0 flex-1 bg-transparent text-[13px] placeholder:text-ink-3 focus:outline-none" />
        </div>
      )}
    </div>
  );
}
