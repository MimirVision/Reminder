import { formatDay, todayISO } from '../lib/when';
import { rescheduleTargets } from '../lib/todoGroups';
import { useI18n } from '../i18n';
import { Icon } from './icons';
import { Sheet } from './Sheet';

// Move a to-do to another day without opening the whole editor: a few quick choices, any date, or no date.
export function RescheduleSheet({ title, dueOn, onPick, onClose }: { title: string; dueOn: string | null; onPick: (date: string | null) => void; onClose: () => void }) {
  const { t, locale } = useI18n();
  const today = todayISO();
  const targets = rescheduleTargets(today, new Date().getDay());
  return (
    <Sheet label={t('resched.title')} onClose={onClose}>
      <div className="row spread">
        <div><h2>{t('resched.title')}</h2><span className="muted">{title}</span></div>
        <button className="btn small icon" onClick={onClose} aria-label={t('common.close')}><Icon name="x" size={16} /></button>
      </div>
      <div className="resched">
        {targets.map((o) => (
          <button key={o.id} className={`btn${dueOn === o.date ? ' primary' : ''}`} onClick={() => onPick(o.date)}>
            <Icon name="calendar" size={16} /> {t(`resched.${o.id}` as 'resched.today')} <span className="muted">{formatDay(o.date, locale)}</span>
          </button>
        ))}
        <label className="btn datepick">
          <Icon name="calendar" size={16} /> {t('resched.pick')}
          <input type="date" aria-label={t('resched.pick')} value={dueOn ?? ''} min="2000-01-01" onChange={(e) => e.target.value && onPick(e.target.value)} />
        </label>
        {dueOn && <button className="btn" onClick={() => onPick(null)}>{t('resched.none')}</button>}
      </div>
    </Sheet>
  );
}
