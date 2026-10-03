import { useMemo, useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { agendaFor, countsByDay } from '../shared/lib/agenda';
import { monthGrid, shiftMonth } from '../shared/lib/calendar';
import { formatDay, todayISO } from '../shared/lib/when';
import { PRIO_COLOR } from './TodoDetails';
import { useI18n } from './i18n';
import { font, useTheme } from './theme';
import type { Memory } from './types';
import { Icon, Muted, SectionLabel } from './ui';

// A month at a glance: a dot under each day that has something (red/amber when it matters). Tap a day to see its list and add to it.
export function CalendarView({ memories, row, onAdd }: { memories: Memory[]; row: (m: Memory) => ReactNode; onAdd: (date: string) => void }) {
  const th = useTheme();
  const { t, locale } = useI18n();
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
  const nav = (by: number, label: string) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={8} onPress={() => go(by)} style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: th.dark ? '#262C36' : '#ECEEF2' }}>
      <Icon name={by < 0 ? 'chevron.left' : 'chevron.right'} size={16} color={th.ink} />
    </Pressable>
  );
  return (
    <View style={{ gap: 12 }}>
      <View style={{ backgroundColor: th.card, borderRadius: 20, padding: 12, gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          {nav(-1, t('cal.prev'))}
          <Text accessibilityRole="header" style={{ color: th.ink, fontFamily: font.semi, fontSize: 17 }}>{monthName}</Text>
          {nav(1, t('cal.next'))}
        </View>
        <View style={{ flexDirection: 'row' }}>
          {weekdays.map((w, i) => <Text key={i} style={{ flex: 1, textAlign: 'center', color: th.muted, fontSize: 12, fontFamily: font.semi, paddingVertical: 4 }}>{w}</Text>)}
        </View>
        {weeks.map((wk, wi) => (
          <View key={wi} style={{ flexDirection: 'row' }}>
            {wk.map((c) => {
              const n = counts.get(c.iso);
              const on = sel === c.iso;
              return (
                <Pressable key={c.iso} accessibilityRole="button" accessibilityState={{ selected: on }}
                  accessibilityLabel={`${formatDay(c.iso, locale)}${n ? `, ${t('cal.open', { n: n.count })}` : ''}`}
                  onPress={() => { setSel(c.iso); if (!c.inMonth) setYm({ year: +c.iso.slice(0, 4), month: +c.iso.slice(5, 7) }); }}
                  style={{ flex: 1, height: 46, alignItems: 'center', justifyContent: 'center', gap: 3, borderRadius: 12, backgroundColor: on ? th.accent : 'transparent', opacity: c.inMonth || on ? 1 : 0.45 }}>
                  <Text style={{ color: on ? '#FFFFFF' : c.iso === today ? th.accentText : th.ink, fontFamily: font.semi, fontSize: 15 }}>{c.day}</Text>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: n ? (on ? '#FFFFFF' : PRIO_COLOR[n.top] ?? th.accent) : 'transparent' }} />
                </Pressable>
              );
            })}
          </View>
        ))}
        <Pressable accessibilityRole="button" onPress={() => { setSel(today); setYm({ year: now.getFullYear(), month: now.getMonth() + 1 }); }} style={{ paddingTop: 4, paddingLeft: 4, minHeight: 36, justifyContent: 'center' }}>
          <Text style={{ color: th.accentText, fontFamily: font.semi, fontSize: 14 }}>{t('cal.today')}</Text>
        </Pressable>
      </View>
      <View style={{ gap: 6 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <SectionLabel>{formatDay(sel, locale)}</SectionLabel>
          <Pressable accessibilityRole="button" hitSlop={8} onPress={() => onAdd(sel)}><Text style={{ color: th.accentText, fontFamily: font.semi, fontSize: 14 }}>{t('cal.add')}</Text></Pressable>
        </View>
        {day.length === 0 ? <Muted>{t('cal.nothing')}</Muted> : <View style={{ backgroundColor: th.card, borderRadius: 20, paddingHorizontal: 16, overflow: 'hidden' }}>{day.map(row)}</View>}
      </View>
    </View>
  );
}
