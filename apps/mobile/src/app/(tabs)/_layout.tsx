import { Tabs } from 'expo-router';
import { useTheme } from '@/lib/theme';

export default function TabsLayout() {
  const t = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: t.bg },
        headerTintColor: t.fg,
        tabBarStyle: { backgroundColor: t.bg, borderTopColor: t.line },
        tabBarActiveTintColor: t.accent,
        tabBarInactiveTintColor: t.muted,
        tabBarIcon: () => null,
        tabBarLabelPosition: 'beside-icon',
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Memories' }} />
      <Tabs.Screen name="places" options={{ title: 'Places' }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
    </Tabs>
  );
}
