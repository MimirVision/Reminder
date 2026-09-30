import { useEffect, useRef } from 'react';
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
import { I18nProvider, useI18n } from '@/lib/i18n';
import { ToastProvider } from '@/lib/Toast';
import { Muted } from '@/lib/ui';
import { HereBanner } from '@/lib/HereBanner';
import { GlassProvider } from '@/lib/glass';
import { useFonts } from 'expo-font';
import { BricolageGrotesque_700Bold } from '@expo-google-fonts/bricolage-grotesque';
import { DMSans_400Regular, DMSans_500Medium, DMSans_600SemiBold } from '@expo-google-fonts/dm-sans';

function Gate() {
  const { ready, session, household } = useSession();
  const router = useRouter();
  const segments = useSegments();
  const t = useTheme();
  const { t: tr } = useI18n();
  const [fontsLoaded] = useFonts({ BricolageGrotesque_700Bold, DMSans_400Regular, DMSans_500Medium, DMSans_600SemiBold });

  // Route guard: login -> onboarding -> app.
  useEffect(() => {
    // Wait until the Stack is mounted (ready and fonts loaded), or navigation fails on a cold start.
    if (!ready || !fontsLoaded || !configured) return;
    const top = segments[0] as string | undefined;
    if (!session && top !== 'login') router.replace('/login');
    else if (session && !household && top !== 'onboarding') router.replace('/onboarding');
    else if (session && household && (top === 'login' || top === 'onboarding')) router.replace('/');
  }, [ready, fontsLoaded, session, household, segments, router]);

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

  // Notification taps: "Done" completes the memories; anything else ("I'm here" or tapping it) opens the list.
  const last = Notifications.useLastNotificationResponse();
  const handledResponse = useRef<string | null>(null);
  const hasHousehold = !!household;
  useEffect(() => {
    void setupNotificationCategories();
  }, []);
  useEffect(() => {
    if (!last || !hasHousehold) return;
    // Handle each tap once, even when the household object is refreshed later.
    const key = `${last.notification.request.identifier}:${last.actionIdentifier}`;
    if (handledResponse.current === key) return;
    handledResponse.current = key;
    const data = last.notification.request.content.data as { memoryIds?: string[]; placeId?: string; label?: string } | undefined;
    if (last.actionIdentifier === 'notnow') return;
    if (last.actionIdentifier === 'done' && data?.memoryIds?.length) {
      void markDone(data.memoryIds).then(() => refreshRegions()).catch(() => {});
    } else if (data?.placeId) {
      router.push({ pathname: '/list/[placeId]', params: { placeId: data.placeId, label: data.label ?? '' } });
    }
  }, [last, hasHousehold, router]);

  // homememory://capture?text=... (used by iOS Shortcuts / Siri when you want the app to open).
  const url = Linking.useURL();
  const handledUrl = useRef<string | null>(null);
  const householdId = household?.id ?? null;
  useEffect(() => {
    if (!url || !householdId) return;
    if (handledUrl.current === url) return; // one to-do per link, not one per refresh
    handledUrl.current = url;
    const parsed = Linking.parse(url);
    if (parsed.hostname === 'capture' || parsed.path === 'capture') {
      const text = String(parsed.queryParams?.text ?? '').trim();
      if (text) {
        void capture({
          id: uuid(), household_id: householdId, body: text, place_id: null,
          capture_lat: null, capture_lon: null, photoUris: [],
        });
      }
    }
  }, [url, householdId]);

  if (!configured) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', padding: 24, backgroundColor: t.bg }}>
        <Muted>{tr('app.notConfigured')}</Muted>
      </View>
    );
  }
  if (!ready || !fontsLoaded) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', backgroundColor: t.bg }}>
        <ActivityIndicator />
      </View>
    );
  }
  return (
    <>
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.bg } }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="login" />
      <Stack.Screen name="onboarding" />
      <Stack.Screen name="add" options={{ presentation: 'modal' }} />
      <Stack.Screen name="list/[placeId]" options={{ presentation: 'modal' }} />
    </Stack>
    {session && household && !(segments as string[]).some((x) => x === 'add' || x === 'list') ? <HereBanner /> : null}
    </>
  );
}

function Themed() {
  const th = useTheme();
  return (
    <>
      <StatusBar style={th.dark ? 'light' : 'dark'} />
      <ToastProvider>
        <Gate />
      </ToastProvider>
    </>
  );
}

export default function RootLayout() {
  return (
    <I18nProvider>
      <SessionProvider>
        <GlassProvider>
          <Themed />
        </GlassProvider>
      </SessionProvider>
    </I18nProvider>
  );
}
