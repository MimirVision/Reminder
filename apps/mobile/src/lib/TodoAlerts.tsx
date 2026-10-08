import { Text, View } from 'react-native';
import { REMIND_CHOICES, type Details } from '../shared/lib/details';
import { DURATION_CHOICES, durationLabel } from '../shared/lib/duration';
import { Chip } from './Chip';
import { useI18n } from './i18n';
import { Select } from './Select';
import { font, useTheme } from './theme';

// The reminders for a to-do, in plain sight once it has a date: when to ring before it starts, "tell me when to leave" (drive time to the
// place), and how long it takes.
export function TodoAlerts({ value, onChange, hasDate, hasTime, hasPlace, placeFixed }: { value: Details; onChange: (d: Details) => void; hasDate: boolean; hasTime: boolean; hasPlace: boolean; placeFixed: boolean }) {
  const th = useTheme();
  const { t } = useI18n();
  const canTravel = hasDate && hasTime && hasPlace;
  return (
    <View style={{ backgroundColor: th.card, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 6, gap: 2 }}>
      {placeFixed && (
        <View style={{ gap: 6, paddingVertical: 8 }}>
          <Text style={{ color: th.muted, fontSize: 15, fontFamily: font.body }}>{t('alerts.at')}</Text>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {(['arrive', 'leave'] as const).map((k) => (
              <Chip key={k} label={t(`alerts.${k}` as 'alerts.arrive')} on={value.place_trigger === k} onPress={() => onChange({ ...value, place_trigger: k })} />
            ))}
          </View>
          {value.place_trigger === 'leave' && <Text style={{ color: th.muted, fontSize: 13, lineHeight: 18, fontFamily: font.body }}>{t('alerts.leaveHint')}</Text>}
        </View>
      )}
      {hasDate && (
        <Select<number | null> label={t('remind.label')} title={t('remind.label')} value={value.remind_before}
          options={[{ value: null, label: t('remind.0') }, ...REMIND_CHOICES.filter((m) => m > 0).map((m) => ({ value: m as number | null, label: t(`remind.${m}` as 'remind.5') }))]}
          onChange={(v) => onChange({ ...value, remind_before: v })} />
      )}
      {hasDate && (
        <View style={{ gap: 6, paddingVertical: 8, alignItems: 'flex-start' }}>
          <Chip icon="location.north" label={t('alerts.travel')} on={value.remind_travel && canTravel} onPress={() => { if (canTravel) onChange({ ...value, remind_travel: !value.remind_travel }); }} />
          <Text style={{ color: th.muted, fontSize: 13, lineHeight: 18, fontFamily: font.body }}>{canTravel ? t('alerts.travelHint') : t('alerts.travelNeeds')}</Text>
        </View>
      )}
      <Select<number | null> label={t('duration.label')} title={t('duration.label')} value={value.duration_min}
        options={[{ value: null, label: t('duration.none') }, ...DURATION_CHOICES.map((m) => ({ value: m as number | null, label: durationLabel(m) }))]}
        onChange={(v) => onChange({ ...value, duration_min: v })} />
    </View>
  );
}
