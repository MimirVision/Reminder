import { Tabs } from 'expo-router';
import { GlassTabBar } from '@/lib/GlassTabBar';

export default function TabsLayout() {
  return (
    <Tabs tabBar={({ state, navigation }) => <GlassTabBar state={state} navigation={navigation} />} screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: 'transparent' } }}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="house" />
      <Tabs.Screen name="places" />
      <Tabs.Screen name="settings" />
    </Tabs>
  );
}
