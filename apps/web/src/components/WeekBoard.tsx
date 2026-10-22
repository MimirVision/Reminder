import { useMemo, useState } from 'react';
import { compareTodos, isLate } from '../lib/todoGroups';
import type { Memory } from '../lib/types';
import { addDays, formatDay, timeShort, todayISO } from '../lib/when';
import { useI18n } from '../i18n';
import { Icon } from './icons';

type Col = { id: string; date: string | null; title: string; sub: string; items: Memory[] };

// A computer view: the next seven days as columns (plus what is late and what has no date). Drag a to-do to another column to move it.
export function WeekBoard({ memories, onMove, onEdit, onToggle, onAdd }: {
  memories: Memory[]; onMove: (m: Memory, date: string | null) => void; onEdit: (m: Memory) => void; onToggle: (m: Memory) => void; onAdd: (date: string) => void;
}) {
  const { t, locale } = useI18n();
  const [over, setOver] = useState<string | null>(null);
  const today = todayISO();

  const cols = useMemo<Col[]>(() => {
    const open = memories.filter((m) => !m.pending);
    const out: Col[] = [];
    const late = open.filter((m) => isLate(m, today)).sort(compareTodos);
    if (late.length > 0) out.push({ id: 'late', date: today, title: t('week.late'), sub: '', items: late });
    for (let i = 0; i < 7; i++) {
      const d = addDays(today, i);
      const items = open.filter((m) => m.due_on === d).sort((a, b) => (a.due_time ?? '99').localeCompare(b.due_time ?? '99') || compareTodos(a, b));
      out.push({ id: d, date: d, title: i === 0 ? t('when.today') : i === 1 ? t('when.tomorrow') : new Date(`${d}T12:00:00`).toLocaleDateString(locale, { weekday: 'long' }), sub: formatDay(d, locale).replace(/^[^,]*,?\s*/, ''), items });
    }
    out.push({ id: 'none', date: null, title: t('week.nodate'), sub: '', items: open.filter((m) => !m.due_on).sort(compareTodos) });
    return out;
  }, [memories, today, locale, t]);

  const drop = (e: React.DragEvent, col: Col) => {
    e.preventDefault();
    setOver(null);
    const m = memories.find((x) => x.id === e.dataTransfer.getData('text/plain'));
    if (m && !(col.id === 'late') && m.due_on !== col.date) onMove(m, col.date);
  };

  const colEl = (c: Col, strip = false) => (
    <section key={c.id} className={`wcol${strip ? ' strip' : ''}${over === c.id ? ' over' : ''}${c.id === today ? ' today' : ''}`} aria-label={c.title}
      onDragOver={(e) => { if (c.id !== 'late') { e.preventDefault(); setOver(c.id); } }} onDragLeave={() => setOver((o) => (o === c.id ? null : o))} onDrop={(e) => drop(e, c)}>
      <header>
        <span className="whead"><strong>{c.title}</strong>{c.sub && <span className="muted wsub">{c.sub}</span>}</span>
        <span className="row nowrap">
          <span className="chip plain">{c.items.length}</span>
          {c.date && c.id !== 'late' && <button className="mini" aria-label={`${t('cal.add')}: ${c.title}`} onClick={() => onAdd(c.date as string)}><Icon name="plus" size={14} /></button>}
        </span>
      </header>
      <div className={`wlist${strip ? ' wrap' : ''}`}>
        {c.items.map((m) => (
          <article key={m.id} className={`wcard prio-${m.priority ?? 0}`} draggable onDragStart={(e) => { e.dataTransfer.setData('text/plain', m.id); e.dataTransfer.effectAllowed = 'move'; }}>
            <button type="button" className="check small" aria-label={t('todo.check')} onClick={() => onToggle(m)} />
            <button type="button" className="wtitle" onClick={() => onEdit(m)}>{(m.body || t('todo.photo')).split('\n')[0]}</button>
            {(m.due_time || (m.tags?.length ?? 0) > 0) && (
              <span className="wmeta">{m.due_time ? timeShort(m.due_time) : ''}{(m.tags ?? []).map((g) => ` #${g}`).join('')}</span>
            )}
          </article>
        ))}
        {c.items.length === 0 && <span className="muted wempty">{t('week.drop')}</span>}
      </div>
    </section>
  );
  const late = cols.find((c) => c.id === 'late');
  const none = cols.find((c) => c.id === 'none');
  const days = cols.filter((c) => c.id !== 'late' && c.id !== 'none');

  return (
    <div className="weekboard" role="group" aria-label={t('view.week')}>
      {late && colEl(late, true)}
      <div className="weekdays">{days.map((c) => colEl(c))}</div>
      {none && colEl(none, true)}
    </div>
  );
}
