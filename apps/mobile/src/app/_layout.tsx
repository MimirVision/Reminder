import { useEffect } from 'react';
import { ActivityIndicator, AppState, View } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as Linking from 'expo-linking';
import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import { SessionProvider, useSession } from '@/lib/session';
import { configured } from '@/lib/supabase';
import { capture, flush } from '@/lib/outbox';
import { uuid } from '@/lib/id';
import { markDone } from '@/lib/api';
import { refreshRegions, setupNotificationCategories } from '@/lib/reminders';
import { useTheme } from '@/lib/theme';
import { Muted } from '@/lib/ui';

function Gate() {
  const { ready, session, household } = useSession();
  const router = useRouter();
  const segments = useSegments();
  const t = useTheme();

  // Route guard: login -> onboarding -> app.
  useEffect(() => {
    if (!ready) return;
    const top = segments[0] as string | undefined;
    if (!session && top !== 'login') router.replace('/login');
    else if (session && !household && top !== 'onboarding') router.replace('/onboarding');
    else if (session && household && (top === 'login' || top === 'onboarding')) router.replace('/');
  }, [ready, session, household, segments, router]);

  // Retry queued captures and re-pick geofences whenever the app comes to the foreground.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        void flush();
        void refreshRegions().catch(() => {});
      }
    });
    return () => sub.remove();
  }, []);

  // Notification actions ("Done" opens the app and completes the memories in the notification).
  useEffect(() => {
    void setupNotificationCategories();
    const sub = Notifications.addNotificationResponseReceivedListener((r) => {
      const ids = (r.notification.request.content.data as { memoryIds?: string[] } | undefined)?.memoryIds;
      if (r.actionIdentifier === 'done' && ids?.length) void markDone(ids).then(() => refreshRegions()).catch(() => {});
    });
    return () => sub.remove();
  }, []);

  // homememory://capture?text=... (used by iOS Shortcuts / Siri when you want the app to open).
  const url = Linking.useURL();
  useEffect(() => {
    if (!url || !household) return;
    const parsed = Linking.parse(url);
    if (parsed.hostname === 'capture' || parsed.path === 'capture') {
      const text = String(parsed.queryParams?.text ?? '').trim();
      if (text) {
        void capture({
          id: uuid(), household_id: household.id, body: text, place_id: null,
          capture_lat: null, capture_lon: null, photoUris: [],
        });
      }
    }
  }, [url, household]);

  if (!configured) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', padding: 24, backgroundColor: t.bg }}>
        <Muted>Supabase is not configured. Copy .env.example to .env and fill in the values, then restart.</Muted>
      </View>
    );
  }
  if (!ready) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', backgroundColor: t.bg }}>
        <ActivityIndicator />
      </View>
    );
  }
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="login" />
      <Stack.Screen name="onboarding" />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SessionProvider>
      <StatusBar style="auto" />
      <Gate />
    </SessionProvider>
  );
}
