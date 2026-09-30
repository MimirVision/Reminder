import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import * as Haptics from 'expo-haptics';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { font, useTheme } from './theme';

export function Icon({ name, size = 22, color }: { name: SFSymbol; size?: number; color?: string }) {
  const t = useTheme();
  return <SymbolView name={name} size={size} tintColor={color ?? t.ink} />;
}

export function Btn({ label, onPress, primary, danger, disabled, small }: {
  label: string; onPress: () => void; primary?: boolean; danger?: boolean; disabled?: boolean; small?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={() => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); onPress(); }}
      disabled={disabled}
      style={({ pressed }) => [
        styles.btn, small && { paddingVertical: 8, paddingHorizontal: 14, minHeight: 36 },
        { backgroundColor: primary ? t.accent : t.dark ? '#262C36' : '#ECEEF2', opacity: disabled ? 0.45 : pressed ? 0.8 : 1 },
      ]}
    >
      <Text style={{ fontFamily: font.semi, fontSize: small ? 14 : 16, color: primary ? '#FFFFFF' : danger ? t.danger : t.ink }}>{label}</Text>
    </Pressable>
  );
}

export function Field(props: TextInputProps) {
  const t = useTheme();
  return (
    <TextInput
      placeholderTextColor={t.muted}
      {...props}
      style={[styles.field, { backgroundColor: t.card, color: t.ink, borderColor: t.line, fontFamily: font.body }, props.multiline && { minHeight: 100, textAlignVertical: 'top' }, props.style]}
    />
  );
}

export function Muted({ children }: { children: ReactNode }) {
  const t = useTheme();
  return <Text style={{ color: t.muted, fontSize: 14, fontFamily: font.body }}>{children}</Text>;
}

export function Title({ children }: { children: ReactNode }) {
  const t = useTheme();
  return <Text style={{ color: t.ink, fontSize: 36, lineHeight: 42, fontFamily: font.display, letterSpacing: -0.8 }}>{children}</Text>;
}

export function SectionLabel({ children }: { children: ReactNode }) {
  const t = useTheme();
  return <Text style={{ color: t.muted, fontSize: 13, letterSpacing: 0.8, textTransform: 'uppercase', fontFamily: font.semi, paddingHorizontal: 4, paddingTop: 8 }}>{children}</Text>;
}

export function Card({ children, gap = 10 }: { children: ReactNode; gap?: number }) {
  const t = useTheme();
  return <View style={[styles.card, { backgroundColor: t.card, gap }]}>{children}</View>;
}

export function PlaceChip({ label, icon = 'mappin' }: { label: string; icon?: SFSymbol }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: t.tint, borderRadius: 999, paddingVertical: 4, paddingLeft: 8, paddingRight: 10, alignSelf: 'flex-start' }}>
      <Icon name={icon} size={13} color={t.tintInk} />
      <Text style={{ color: t.tintInk, fontSize: 13, fontFamily: font.semi }}>{label}</Text>
    </View>
  );
}

// The circle you tick to finish a to-do.
export function Check({ done, onPress }: { done?: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: !!done }}
      hitSlop={10}
      onPress={() => { void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); onPress(); }}
      style={{ width: 26, height: 26, borderRadius: 13, borderWidth: done ? 0 : 2, borderColor: t.control, backgroundColor: done ? t.ink : 'transparent', alignItems: 'center', justifyContent: 'center', marginTop: 1 }}
    >
      {done && <Icon name="checkmark" size={14} color={t.card} />}
    </Pressable>
  );
}

export const styles = StyleSheet.create({
  btn: { paddingVertical: 12, paddingHorizontal: 18, borderRadius: 999, alignItems: 'center', justifyContent: 'center', minHeight: 44 },
  field: { borderWidth: StyleSheet.hairlineWidth * 2, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12, fontSize: 17 },
  card: { borderRadius: 20, padding: 16 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  screen: { padding: 16, gap: 14 },
});

// Bottom room so content can scroll under the floating glass bars.
export const BAR_SPACE = 190;
