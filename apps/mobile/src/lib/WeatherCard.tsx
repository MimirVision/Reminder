import { Pressable, Text, View } from 'react-native';
import { useI18n } from './i18n';
import { font, useTheme } from './theme';
import { Icon, Muted } from './ui';
import { doneItems, reasonText, type WeatherAlert, type WeatherDone } from '../shared/lib/weather';

// On the to-do list while a weather alert is live: what the weather is doing and the checklist to tick off.
export function WeatherCard({ alerts, done, onTick }: { alerts: WeatherAlert[]; done: WeatherDone[]; onTick: (a: WeatherAlert, item: string) => void }) {
  const th = useTheme();
  const { t } = useI18n();
  return (
    <>
      {alerts.map((a) => {
        const ticked = doneItems(a, done);
        return (
          <View key={`${a.rule.id}-${a.forDate}`} accessible={false} style={{ borderRadius: 16, padding: 14, gap: 6, backgroundColor: th.card }}>
            <Text accessibilityRole="header" style={{ color: th.ink, fontSize: 16, fontFamily: font.semi }}>{a.rule.name}</Text>
            <Muted>{reasonText(t, a)}</Muted>
            {a.rule.items.map((item) => {
              const on = ticked.includes(item);
              return (
                <Pressable key={item} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={item} onPress={() => onTick(a, item)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 }}>
                  <Icon name={on ? 'checkmark.circle.fill' : 'circle'} size={24} color={on ? th.accent : th.muted} />
                  <Text style={{ flex: 1, color: on ? th.muted : th.ink, fontFamily: font.body, fontSize: 16, textDecorationLine: on ? 'line-through' : 'none' }}>{item}</Text>
                </Pressable>
              );
            })}
          </View>
        );
      })}
    </>
  );
}
