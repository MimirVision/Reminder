import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { monthGrid, shiftMonth } from '../shared/lib/calendar';
import { formatDay, parseISODate } from '../shared/lib/when';
import { Chip } from './Chip';
import { useI18n } from './i18n';
import { font, useTheme } from './theme';
import { Icon } from './ui';

// A date without a native picker: a chip showing the date that opens a month grid (with year steps, for dates years back or ahead).
export function DateField({ label, value, onChange }: { label: string; value: string | null; onChange: (v: string | null) => void }) {
  const th = useTheme();
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const base = parseISODate(value ?? new Date().toISOString().slice(0, 10));
  const [ym, setYm] = useState({ year: base.getFullYear(), month: base.getMonth() + 1 });
  const weekdays = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(locale, { weekday: 'narrow' }).format(new Date(2026, 5, 1 + i)));
  const monthName = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(new Date(ym.year, ym.month - 1, 1));
  const step = (m: number) => setYm(shiftMonth(ym.year, ym.month, m));

  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: th.muted, fontFamily: font.semi, fontSize: 14 }}>{label}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <Chip icon="calendar" label={value ? formatDay(value, locale) : t('when.pick')} on={!!value} onPress={() => setOpen((o) => !o)} />
        {value ? <Pressable accessibilityRole="button" onPress={() => onChange(null)} hitSlop={8}><Text style={{ color: th.muted, fontFamily: font.medium, fontSize: 14 }}>{t('when.clear')}</Text></Pressable> : null}
      </View>
      {open && (
        <View style={{ borderRadius: 16, borderWidth: 1, borderColor: th.line, backgroundColor: th.card, padding: 10, gap: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Pressable accessibilityLabel={t('cal.prev')} onPress={() => step(-12)} hitSlop={10} style={{ padding: 8 }}><Text style={{ color: th.ink, fontFamily: font.semi, fontSize: 16 }}>«</Text></Pressable>
            <Pressable accessibilityLabel={t('cal.prev')} onPress={() => step(-1)} hitSlop={10} style={{ padding: 8 }}><Icon name="chevron.left" size={18} /></Pressable>
            <Text style={{ flex: 1, textAlign: 'center', color: th.ink, fontFamily: font.semi, fontSize: 16, textTransform: 'capitalize' }}>{monthName}</Text>
            <Pressable accessibilityLabel={t('cal.next')} onPress={() => step(1)} hitSlop={10} style={{ padding: 8 }}><Icon name="chevron.right" size={18} /></Pressable>
            <Pressable accessibilityLabel={t('cal.next')} onPress={() => step(12)} hitSlop={10} style={{ padding: 8 }}><Text style={{ color: th.ink, fontFamily: font.semi, fontSize: 16 }}>»</Text></Pressable>
          </View>
          <View style={{ flexDirection: 'row' }}>{weekdays.map((d, i) => <Text key={i} style={{ flex: 1, textAlign: 'center', color: th.muted, fontFamily: font.semi, fontSize: 12 }}>{d}</Text>)}</View>
          {monthGrid(ym.year, ym.month).map((week, wi) => (
            <View key={wi} style={{ flexDirection: 'row' }}>
              {week.map((c) => {
                const sel = c.iso === value;
                return (
                  <Pressable key={c.iso} accessibilityRole="button" accessibilityState={{ selected: sel }} onPress={() => { onChange(c.iso); setOpen(false); }}
                    style={{ flex: 1, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: sel ? th.accent : 'transparent' }}>
                    <Text style={{ color: sel ? '#FFFFFF' : c.inMonth ? th.ink : th.muted, opacity: c.inMonth ? 1 : 0.5, fontFamily: font.medium, fontSize: 15 }}>{c.day}</Text>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
