import { useMemo, useState, type ReactNode } from 'react';
import { agendaFor, countsByDay } from '../lib/agenda';
import { monthGrid, shiftMonth } from '../lib/calendar';
import type { Memory } from '../lib/types';
import { formatDay, todayISO } from '../lib/when';
import { useI18n } from '../i18n';
import { Icon } from './icons';

// A month at a glance: a dot under each day that has something, colour by the most important thing that day.
// Tap a day to see its list below and add something on it.
export function CalendarView({ memories, row, onAdd }: { memories: Memory[]; row: (m: Memory) => ReactNode; onAdd: (date: string) => void }) {
  const { t, tn, locale } = useI18n();
  const today = todayISO();
  const now = new Date();
  const [ym, setYm] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 });
  const [sel, setSel] = useState(today);
  const weeks = useMemo(() => monthGrid(ym.year, ym.month), [ym]);
  const counts = useMemo(() => countsByDay(memories), [memories]);
  const day = useMemo(() => agendaFor(memories, sel), [memories, sel]);
  const monthName = new Date(ym.year, ym.month - 1, 1).toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  const weekdays = useMemo(() => Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(locale, { weekday: 'narrow' })), [locale]);
  const go = (by: number) => setYm((c) => shiftMonth(c.year, c.month, by));

  return (
    <>
      <section className="card calendar" aria-label={monthName}>
        <div className="row spread cal-head">
          <button className="btn small icon" aria-label={t('cal.prev')} onClick={() => go(-1)}><span className="flip"><Icon name="chevron" size={16} /></span></button>
          <strong>{monthName}</strong>
          <button className="btn small icon" aria-label={t('cal.next')} onClick={() => go(1)}><Icon name="chevron" size={16} /></button>
        </div>
        <div className="cal-grid" role="grid">
          {weekdays.map((w, i) => <span key={i} className="cal-wd" aria-hidden="true">{w}</span>)}
          {weeks.flat().map((c) => {
            const n = counts.get(c.iso);
            return (
              <button key={c.iso} type="button" role="gridcell" aria-selected={sel === c.iso}
                aria-label={`${formatDay(c.iso, locale)}${n ? `, ${t('cal.open', { n: n.count })}` : ''}`}
                className={`cal-day${c.inMonth ? '' : ' out'}${c.iso === today ? ' today' : ''}${sel === c.iso ? ' sel' : ''}${c.iso < today ? ' past' : ''}`}
                onClick={() => { setSel(c.iso); if (!c.inMonth) setYm({ year: +c.iso.slice(0, 4), month: +c.iso.slice(5, 7) }); }}>
                <span>{c.day}</span>
                {n && <i className={`dot prio-${n.top}`} title={tn('map.todos', n.count)} />}
              </button>
            );
          })}
        </div>
        <div className="row spread cal-foot">
          <button className="link" onClick={() => { setSel(today); setYm({ year: now.getFullYear(), month: now.getMonth() + 1 }); }}>{t('cal.today')}</button>
        </div>
      </section>
      <section className="group" aria-live="polite">
        <div className="row spread"><div className="label">{formatDay(sel, locale)}</div><button className="link" onClick={() => onAdd(sel)}>{t('cal.add')}</button></div>
        {day.length === 0 ? <p className="muted quiet-line">{t('cal.nothing')}</p> : <div className="card list">{day.map(row)}</div>}
      </section>
    </>
  );
}
