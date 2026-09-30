import { Pressable, Text } from 'react-native';
import { Icon } from './ui';
import { font, useTheme } from './theme';
import type { SFSymbol } from 'expo-symbols';

// A selectable pill (date choices, places, repeat rules).
export function Chip({ label, on, onPress, icon }: { label: string; on?: boolean; onPress: () => void; icon?: SFSymbol }) {
  const th = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: !!on }} onPress={onPress}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, borderWidth: 1, borderColor: on ? th.accent : th.line, backgroundColor: on ? th.accent : th.card, paddingHorizontal: 14, minHeight: 40 }}>
      {icon && <Icon name={icon} size={14} color={on ? '#FFFFFF' : th.ink} />}
      <Text style={{ color: on ? '#FFFFFF' : th.ink, fontFamily: font.semi, fontSize: 14 }}>{label}</Text>
    </Pressable>
  );
}
