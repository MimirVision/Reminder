import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { monthGrid, shiftMonth } from '../shared/lib/calendar';
import { REPEAT_RULES } from '../shared/lib/recurrence';
import type { RepeatRule } from '../shared/lib/types';
import { formatDay, parseISODate, quickDates, timeShort } from '../shared/lib/when';
import { Chip } from './Chip';
import { useI18n } from './i18n';
import { font, useTheme } from './theme';
import { Icon, Muted, styles } from './ui';

export type Due = { due_on: string | null; due_time: string | null; repeat_rule: RepeatRule | null };
const none: Due = { due_on: null, due_time: null, repeat_rule: null };

// Date, optional time and repeat, without a native date-picker dependency: quick choices, a month grid, and a time stepper.
export function WhenPicker({ value, onChange }: { value: Due; onChange: (v: Due) => void }) {
  const { t, locale } = useI18n();
  const th = useTheme();
  const q = quickDates();
  const [showGrid, setShowGrid] = useState(false);
  const base = parseISODate(value.due_on ?? q.today);
  const [ym, setYm] = useState({ year: base.getFullYear(), month: base.getMonth() + 1 });

  const quick = [
    { id: 'today', label: t('when.today'), date: q.today }, { id: 'tomorrow', label: t('when.tomorrow'), date: q.tomorrow },
    { id: 'weekend', label: t('when.weekend'), date: q.weekend }, { id: 'nextWeek', label: t('when.nextWeek'), date: q.nextWeek },
  ];
  const seen = new Set<string>();
  const shown = quick.filter((c) => (seen.has(c.date) ? false : (seen.add(c.date), true)));
  const custom = value.due_on !== null && !shown.some((c) => c.date === value.due_on);
  const weekdays = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(locale, { weekday: 'narrow' }).format(new Date(2026, 5, 1 + i))); // 1 June 2026 is a Monday
  const monthName = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(new Date(ym.year, ym.month - 1, 1));

  const [hh, mm] = (value.due_time ?? '09:00').split(':').map(Number);
  const setTime = (mins: number) => { const m = ((mins % 1440) + 1440) % 1440; onChange({ ...value, due_time: `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}` }); };

  return (
    <View style={{ gap: 10 }}>
      <View style={styles.row}>
        {shown.map((c) => (
          <Chip key={c.id} label={c.label} on={value.due_on === c.date} onPress={() => { onChange(value.due_on === c.date ? none : { ...value, due_on: c.date }); setShowGrid(false); }} />
        ))}
        <Chip icon="calendar" label={custom ? formatDay(value.due_on!, locale) : t('when.pick')} on={custom} onPress={() => setShowGrid((s) => !s)} />
      </View>

      {showGrid && (
        <View style={{ borderRadius: 16, borderWidth: 1, borderColor: th.line, backgroundColor: th.card, padding: 10, gap: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Pressable accessibilityLabel={t('cal.prev')} onPress={() => setYm(shiftMonth(ym.year, ym.month, -1))} hitSlop={10} style={{ padding: 8 }}><Icon name="chevron.left" size={18} /></Pressable>
            <Text style={{ color: th.ink, fontFamily: font.semi, fontSize: 16, textTransform: 'capitalize' }}>{monthName}</Text>
            <Pressable accessibilityLabel={t('cal.next')} onPress={() => setYm(shiftMonth(ym.year, ym.month, 1))} hitSlop={10} style={{ padding: 8 }}><Icon name="chevron.right" size={18} /></Pressable>
          </View>
          <View style={{ flexDirection: 'row' }}>{weekdays.map((d, i) => <Text key={i} style={{ flex: 1, textAlign: 'center', color: th.muted, fontFamily: font.semi, fontSize: 12 }}>{d}</Text>)}</View>
          {monthGrid(ym.year, ym.month).map((week, wi) => (
            <View key={wi} style={{ flexDirection: 'row' }}>
              {week.map((c) => {
                const sel = c.iso === value.due_on;
                return (
                  <Pressable key={c.iso} accessibilityRole="button" accessibilityState={{ selected: sel }} onPress={() => { onChange({ ...value, due_on: c.iso }); setShowGrid(false); }}
                    style={{ flex: 1, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: sel ? th.accent : 'transparent' }}>
                    <Text style={{ color: sel ? '#FFFFFF' : c.inMonth ? th.ink : th.muted, opacity: c.inMonth ? 1 : 0.5, fontFamily: font.medium, fontSize: 15 }}>{c.day}</Text>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>
      )}

      {value.due_on && (
        <>
          <View style={[styles.row, { alignItems: 'center' }]}>
            {value.due_time ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, backgroundColor: th.accent, paddingHorizontal: 6, minHeight: 40 }}>
                <Pressable accessibilityLabel={t('when.earlier')} hitSlop={8} onPress={() => setTime(hh * 60 + mm - 15)} style={{ padding: 8 }}><Icon name="minus" size={14} color="#FFFFFF" /></Pressable>
                <Text style={{ color: '#FFFFFF', fontFamily: font.semi, fontSize: 15, minWidth: 48, textAlign: 'center' }}>{timeShort(value.due_time)}</Text>
                <Pressable accessibilityLabel={t('when.later')} hitSlop={8} onPress={() => setTime(hh * 60 + mm + 15)} style={{ padding: 8 }}><Icon name="plus" size={14} color="#FFFFFF" /></Pressable>
                <Pressable accessibilityLabel={t('when.clear')} hitSlop={8} onPress={() => onChange({ ...value, due_time: null })} style={{ padding: 8 }}><Icon name="xmark" size={12} color="#FFFFFF" /></Pressable>
              </View>
            ) : (
              <Chip icon="clock" label={t('when.addTime')} onPress={() => onChange({ ...value, due_time: '09:00' })} />
            )}
            <Pressable onPress={() => onChange(none)} hitSlop={8}><Text style={{ color: th.muted, fontFamily: font.medium, fontSize: 14 }}>{t('when.clear')}</Text></Pressable>
          </View>
          <View style={styles.row}>
            <Muted>{t('repeat.label')}</Muted>
            {REPEAT_RULES.map((r) => (
              <Chip key={r} label={t(`repeat.short.${r}` as 'repeat.short.daily')} on={value.repeat_rule === r} onPress={() => onChange({ ...value, repeat_rule: value.repeat_rule === r ? null : r })} />
            ))}
          </View>
        </>
      )}
    </View>
  );
}
