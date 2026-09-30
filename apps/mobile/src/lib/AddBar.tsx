import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Glass } from './glass';
import { font, useTheme } from './theme';
import { Icon } from './ui';
import { useI18n } from './i18n';

// The glass "Add a to-do…" bar that floats above the tab bar. Tapping opens the add sheet.
export function AddBar() {
  const t = useTheme();
  const { t: tr } = useI18n();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 16, right: 16, bottom: Math.max(insets.bottom, 12) + 74 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={tr('todo.addAria')} onPress={() => router.push('/add')}>
        <Glass interactive style={{ borderRadius: 30, height: 58, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="plus" size={20} color="#FFFFFF" />
          </View>
          <Text style={{ flex: 1, color: t.ink, opacity: 0.75, fontSize: 17, fontFamily: font.medium }}>{tr('todo.addBar')}</Text>
          <Icon name="camera" size={22} />
        </Glass>
      </Pressable>
    </View>
  );
}
