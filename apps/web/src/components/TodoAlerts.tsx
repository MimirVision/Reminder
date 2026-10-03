import { DURATION_CHOICES, durationLabel } from '../lib/duration';
import { REMIND_CHOICES, type Details } from '../lib/details';
import { useI18n } from '../i18n';
import { Icon } from './icons';

// The reminders for a to-do, in plain sight once it has a date: when to ring before it starts, "tell me when to leave" (drive time to the
// place), and how long it takes. Replaces burying "remind me" under More.
export function TodoAlerts({ value, onChange, hasDate, hasTime, hasPlace }: { value: Details; onChange: (d: Details) => void; hasDate: boolean; hasTime: boolean; hasPlace: boolean }) {
  const { t } = useI18n();
  const canTravel = hasDate && hasTime && hasPlace;
  return (
    <div className="alerts">
      {hasDate && (
        <label className="alert-row">
          <span><Icon name="clock" size={15} /> {t('remind.label')}</span>
          <select value={value.remind_before ?? ''} aria-label={t('remind.label')} onChange={(e) => onChange({ ...value, remind_before: e.target.value === '' ? null : Number(e.target.value) })}>
            <option value="">{t('remind.0')}</option>
            {REMIND_CHOICES.filter((m) => m > 0).map((m) => <option key={m} value={m}>{t(`remind.${m}` as 'remind.5')}</option>)}
          </select>
        </label>
      )}
      {hasDate && (
        <div className="alert-travel">
          <button type="button" className={`chipbtn${value.remind_travel && canTravel ? ' on' : ''}`} aria-pressed={value.remind_travel && canTravel} disabled={!canTravel}
            onClick={() => onChange({ ...value, remind_travel: !value.remind_travel })}><Icon name="navigate" size={15} /> {t('alerts.travel')}</button>
          <span className="muted hint">{canTravel ? t('alerts.travelHint') : t('alerts.travelNeeds')}</span>
        </div>
      )}
      <label className="alert-row">
        <span><Icon name="calendar" size={15} /> {t('duration.label')}</span>
        <select value={value.duration_min ?? ''} aria-label={t('duration.label')} onChange={(e) => onChange({ ...value, duration_min: e.target.value === '' ? null : Number(e.target.value) })}>
          <option value="">{t('duration.none')}</option>
          {DURATION_CHOICES.map((m) => <option key={m} value={m}>{durationLabel(m)}</option>)}
        </select>
      </label>
    </div>
  );
}
