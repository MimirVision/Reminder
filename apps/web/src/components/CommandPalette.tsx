import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { Icon } from './icons';

export type Command = { id: string; label: string; run: () => void };
export type PaletteTodo = { id: string; label: string; hint?: string };

const norm = (s: string) => s.toLocaleLowerCase('nb').normalize('NFD').replace(/[̀-ͯ]/g, '');

// Ctrl or Cmd + K: type to run a command or jump to a to-do. Arrow keys and Enter; Escape closes.
export function CommandPalette({ commands, todos, onOpenTodo, onClose }: { commands: Command[]; todos: PaletteTodo[]; onOpenTodo: (id: string) => void; onClose: () => void }) {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);

  const rows = useMemo(() => {
    const words = norm(q).split(/\s+/).filter(Boolean);
    const hit = (s: string) => words.every((w) => norm(s).includes(w));
    const cmds = commands.filter((c) => hit(c.label)).map((c) => ({ key: `c-${c.id}`, label: c.label, hint: '', kind: 'cmd' as const, run: c.run }));
    const tds = words.length === 0 ? [] : todos.filter((x) => hit(x.label)).slice(0, 8).map((x) => ({ key: `t-${x.id}`, label: x.label, hint: x.hint ?? '', kind: 'todo' as const, run: () => onOpenTodo(x.id) }));
    return [...cmds, ...tds];
  }, [q, commands, todos, onOpenTodo]);
  useEffect(() => { setI(0); }, [q]);

  const go = (k: number) => { const r = rows[k]; if (r) { onClose(); r.run(); } };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setI((n) => Math.min(rows.length - 1, n + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setI((n) => Math.max(0, n - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); go(i); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };

  return (
    <div className="overlay palette-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="palette" role="dialog" aria-modal="true" aria-label={t('pal.open')} onKeyDown={onKey}>
        <label className="palette-input"><Icon name="search" size={18} />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('pal.placeholder')} aria-label={t('pal.placeholder')} role="combobox" aria-expanded="true" aria-controls="pal-list" />
        </label>
        <ul id="pal-list" role="listbox" className="palette-list">
          {rows.length === 0 && <li className="muted palette-none">{t('pal.none')}</li>}
          {rows.map((r, k) => (
            <li key={r.key} role="option" aria-selected={k === i} className={k === i ? 'on' : undefined} onMouseEnter={() => setI(k)} onClick={() => go(k)}>
              <span>{r.label}</span>
              {r.kind === 'todo' ? <span className="muted">{r.hint || t('pal.todos')}</span> : null}
            </li>
          ))}
        </ul>
        <div className="palette-foot muted">{t('pal.hint')}</div>
      </div>
    </div>
  );
}
