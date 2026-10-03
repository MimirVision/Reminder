import { ActionSheetIOS, Pressable, Text, View } from 'react-native';
import { useI18n } from './i18n';
import { font, useTheme } from './theme';
import { Icon } from './ui';

export type Option<T> = { value: T; label: string };

// A drop-down: a row with the current choice and a chevron. Tapping it opens the native iOS list to pick from.
export function Select<T extends string | number | null>({ label, title, value, options, onChange }: {
  label: string; title?: string; value: T; options: Option<T>[]; onChange: (v: T) => void;
}) {
  const th = useTheme();
  const { t } = useI18n();
  const current = options.find((o) => o.value === value)?.label ?? String(value ?? '');
  const open = () => {
    ActionSheetIOS.showActionSheetWithOptions(
      { title, options: [...options.map((o) => o.label), t('common.cancel')], cancelButtonIndex: options.length, userInterfaceStyle: th.dark ? 'dark' : 'light' },
      (i) => { if (i < options.length) onChange(options[i].value); },
    );
  };
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${current}`} onPress={open}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, minHeight: 44, opacity: pressed ? 0.6 : 1 })}>
      <Text style={{ color: th.muted, fontFamily: font.body, fontSize: 15, flexShrink: 1 }}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: th.dark ? '#262C36' : '#ECEEF2', borderRadius: 999, paddingVertical: 7, paddingLeft: 14, paddingRight: 10 }}>
        <Text style={{ color: th.ink, fontFamily: font.semi, fontSize: 15 }}>{current}</Text>
        <Icon name="chevron.up.chevron.down" size={12} color={th.muted} />
      </View>
    </Pressable>
  );
}
