import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { SFSymbol } from 'expo-symbols';
import { Glass } from './glass';
import { font, useTheme } from './theme';
import { Icon } from './ui';
import { useI18n } from './i18n';

const TABS: Record<string, { key: 'nav.todo' | 'nav.house' | 'nav.places' | 'nav.settings'; icon: SFSymbol }> = {
  index: { key: 'nav.todo', icon: 'checkmark.circle' },
  house: { key: 'nav.house', icon: 'house' },
  places: { key: 'nav.places', icon: 'mappin.and.ellipse' },
  settings: { key: 'nav.settings', icon: 'gearshape' },
};

type Props = {
  state: { routes: { key: string; name: string }[]; index: number };
  navigation: { navigate: (name: string) => void };
};

// Floating Liquid Glass tab bar. The selected tab gets a lighter capsule, like the system one.
export function GlassTabBar({ state, navigation }: Props) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const insets = useSafeAreaInsets();
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 16, right: 16, bottom: Math.max(insets.bottom, 12) }}>
      <Glass interactive style={{ borderRadius: 34, padding: 6, flexDirection: 'row', gap: 2 }}>
        {state.routes.map((route, i) => {
          const meta = TABS[route.name];
          if (!meta) return null;
          const on = state.index === i;
          const color = on ? t.accentText : t.ink;
          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              onPress={() => { if (!on) navigation.navigate(route.name); }}
              style={{
                flex: 1, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center', gap: 2,
                backgroundColor: on ? (t.dark ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.7)') : 'transparent',
              }}
            >
              <Icon name={meta.icon} size={22} color={color} />
              <Text style={{ fontSize: 11, color, fontFamily: font.semi }}>{tr(meta.key)}</Text>
            </Pressable>
          );
        })}
      </Glass>
    </View>
  );
}
