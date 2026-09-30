import { Icon } from './icons';
import { useI18n } from '../i18n';
import { formatDay, quickDates, timeShort } from '../lib/when';
import { REPEAT_RULES } from '../lib/recurrence';
import type { RepeatRule } from '../lib/types';

export type Due = { due_on: string | null; due_time: string | null; repeat_rule?: RepeatRule | null };

// Date and optional time: one-tap choices, a native date picker for anything else, and a native time picker.
export function WhenField({ value, onChange }: { value: Due; onChange: (v: Due) => void }) {
  const { t, locale } = useI18n();
  const q = quickDates();
  const quick = [
    { id: 'today', label: t('when.today'), date: q.today },
    { id: 'tomorrow', label: t('when.tomorrow'), date: q.tomorrow },
    { id: 'weekend', label: t('when.weekend'), date: q.weekend },
    { id: 'nextWeek', label: t('when.nextWeek'), date: q.nextWeek },
  ];
  // "Today" and "Weekend" can be the same day on a Saturday; show the first only.
  const seen = new Set<string>();
  const shown = quick.filter((c) => (seen.has(c.date) ? false : (seen.add(c.date), true)));
  const custom = value.due_on !== null && !shown.some((c) => c.date === value.due_on);

  return (
    <div className="field">
      <div className="chips" role="group" aria-label={t('sheet.when')}>
        {shown.map((c) => (
          <button key={c.id} type="button" className={`chipbtn${value.due_on === c.date ? ' on' : ''}`} aria-pressed={value.due_on === c.date}
            onClick={() => onChange(value.due_on === c.date ? { due_on: null, due_time: null, repeat_rule: null } : { ...value, due_on: c.date })}>{c.label}</button>
        ))}
        <label className={`chipbtn datebtn${custom ? ' on' : ''}`}>
          <Icon name="calendar" size={15} />
          {custom ? formatDay(value.due_on!, locale) : t('when.pick')}
          <input type="date" aria-label={t('when.dateLabel')} value={value.due_on ?? ''} min="2000-01-01"
            onClick={(e) => { try { e.currentTarget.showPicker?.(); } catch { /* not allowed here */ } }}
            onChange={(e) => onChange(e.target.value ? { ...value, due_on: e.target.value } : { due_on: null, due_time: null, repeat_rule: null })} />
        </label>
      </div>
      {value.due_on && (
        <div className="chips">
          {value.due_time ? (
            <label className="chipbtn on timebtn">
              <Icon name="clock" size={15} />
              <input type="time" aria-label={t('when.timeLabel')} value={timeShort(value.due_time)} onChange={(e) => onChange({ ...value, due_time: e.target.value || null })} />
              <button type="button" className="mini" aria-label={t('when.clear')} onClick={() => onChange({ ...value, due_time: null })}><Icon name="x" size={13} /></button>
            </label>
          ) : (
            <button type="button" className="chipbtn" onClick={() => onChange({ ...value, due_time: '09:00' })}><Icon name="clock" size={15} />{t('when.addTime')}</button>
          )}
          <button type="button" className="link quiet" onClick={() => onChange({ due_on: null, due_time: null, repeat_rule: null })}>{t('when.clear')}</button>
        </div>
      )}
      {value.due_on && (
        <div className="chips" role="group" aria-label={t('repeat.label')}>
          <span className="muted"><Icon name="repeat" size={14} /> {t('repeat.label')}</span>
          {REPEAT_RULES.map((r) => (
            <button key={r} type="button" className={`chipbtn${value.repeat_rule === r ? ' on' : ''}`} aria-pressed={value.repeat_rule === r}
              onClick={() => onChange({ ...value, repeat_rule: value.repeat_rule === r ? null : r })}>{t(`repeat.short.${r}` as 'repeat.short.daily')}</button>
          ))}
        </div>
      )}
    </div>
  );
}
