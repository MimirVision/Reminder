import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { useTheme } from './theme';

export function Btn({ label, onPress, primary, danger, disabled }: {
  label: string; onPress: () => void; primary?: boolean; danger?: boolean; disabled?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.btn,
        { backgroundColor: primary ? t.accent : t.card, borderColor: primary ? t.accent : t.line, opacity: disabled ? 0.5 : 1 },
      ]}
    >
      <Text style={{ color: primary ? '#fff' : danger ? t.danger : t.fg, fontWeight: primary ? '700' : '500' }}>{label}</Text>
    </Pressable>
  );
}

export function Field(props: TextInputProps) {
  const t = useTheme();
  return (
    <TextInput
      placeholderTextColor={t.muted}
      {...props}
      style={[styles.field, { backgroundColor: t.card, borderColor: t.line, color: t.fg }, props.multiline && { minHeight: 90, textAlignVertical: 'top' }, props.style]}
    />
  );
}

export function Muted({ children }: { children: ReactNode }) {
  const t = useTheme();
  return <Text style={{ color: t.muted, fontSize: 14 }}>{children}</Text>;
}

export function Card({ children }: { children: ReactNode }) {
  const t = useTheme();
  return <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }]}>{children}</View>;
}

export const styles = StyleSheet.create({
  btn: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, alignItems: 'center' },
  field: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  card: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 8 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  screen: { padding: 16, gap: 12 },
});
