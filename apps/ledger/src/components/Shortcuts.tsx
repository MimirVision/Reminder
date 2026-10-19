// Keyboard navigation in the style of Linear and ClickUp: G then a letter jumps to a screen, and ? lists every shortcut.
import { useEffect, useRef, useState } from 'react';
import { useRoute } from '../router';
import { Kbd } from '../ui/button';
import { Dialog } from '../ui/overlay';
import { MOD } from './Shell';

const GO: Record<string, { to: string; label: string }> = {
  h: { to: '/', label: 'Home' }, t: { to: '/tasks', label: 'My Tasks' }, c: { to: '/calendar', label: 'Calendar' },
  l: { to: '/clients', label: 'Clients' }, r: { to: '/recurring', label: 'Recurring Work' }, m: { to: '/missing', label: 'Missing Tasks' },
  s: { to: '/settings', label: 'Settings' },
};

const SECTIONS: { title: string; rows: [string[], string][] }[] = [
  { title: 'Anywhere', rows: [
    [[MOD, 'K'], 'Search, jump or create'], [['N'], 'New task'], [['?'], 'This list'],
    ...Object.entries(GO).map(([k, v]) => [['G', k.toUpperCase()], `Go to ${v.label}`] as [string[], string]),
  ] },
  { title: 'In a task list', rows: [
    [['↑', '↓'], 'Move between tasks (or J / K)'], [['Enter'], 'Open the task'], [['D'], 'Done, or reopen'], [['W'], 'Waiting for client'],
    [['T'], 'Move to tomorrow'], [['X'], 'Select (Shift for a range)'], [['/'], 'Search the list'],
  ] },
  { title: 'Customizing Home', rows: [
    [['←', '→'], 'Move a widget (from its handle)'], [['Shift', '←→↑↓'], 'Resize it'], [['Delete'], 'Remove it'],
  ] },
];

export function Shortcuts() {
  const { navigate } = useRoute();
  const [open, setOpen] = useState(false);
  const pendingG = useRef(0);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement).closest('input,textarea,select,[contenteditable]') || document.querySelector('[role=dialog]')) return;
      const k = e.key.toLowerCase();
      if (e.key === '?') { e.preventDefault(); setOpen(true); return; }
      // Captured before the lists see it, so G then T jumps to My Tasks instead of moving the focused task to tomorrow.
      if (pendingG.current && Date.now() - pendingG.current < 1200 && GO[k]) { e.preventDefault(); e.stopPropagation(); pendingG.current = 0; navigate(GO[k].to); return; }
      pendingG.current = k === 'g' ? Date.now() : 0;
    };
    window.addEventListener('keydown', on, true);
    return () => window.removeEventListener('keydown', on, true);
  }, [navigate]);
  return (
    <Dialog open={open} onOpenChange={setOpen} title="Keyboard shortcuts" width="max-w-2xl">
      <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
        {SECTIONS.map((s) => (
          <section key={s.title} className={s.title === 'Anywhere' ? 'sm:row-span-2' : undefined}>
            <h3 className="mb-2 text-[11.5px] font-medium tracking-wide text-ink-3 uppercase">{s.title}</h3>
            <dl className="flex flex-col gap-1.5">
              {s.rows.map(([keys, label]) => (
                <div key={label} className="flex items-center gap-3 text-[13px]">
                  <dt className="flex w-24 shrink-0 gap-1">{keys.map((k) => <Kbd key={k}>{k}</Kbd>)}</dt>
                  <dd className="text-ink-2">{label}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
