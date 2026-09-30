import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { hereCandidate, type Dismissals } from '../core/proximity.ts';
import { selectRegions } from '../core/regions.ts';
import type { PoiCache } from '../core/pois.ts';
import type { Region } from '../core/types.ts';
import { readSnapshot, storeKeys } from './reminders';
import { readJson, writeJson } from './store';
import { useTheme } from './theme';

const DISMISS_KEY = 'hm.hereDismissed';

// "Are you here?" — while the app is open, once you are within a store's radius a bar appears at the bottom.
// Tapping "I'm here" opens the shopping list for that place.
export function HereBanner() {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [candidate, setCandidate] = useState<{ region: Region; distanceM: number } | null>(null);
  const sub = useRef<Location.LocationSubscription | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const perm = await Location.getForegroundPermissionsAsync();
      if (!perm.granted || cancelled) return;
      sub.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, distanceInterval: 25, timeInterval: 15_000 },
        (pos) => {
          const { places, memories } = readSnapshot();
          const pois = readJson<PoiCache | null>(storeKeys.pois, null)?.byCategory ?? {};
          const here = { lat: pos.coords.latitude, lon: pos.coords.longitude };
          const regions = selectRegions({ places, memories, pois, here, max: 200 });
          setCandidate(hereCandidate({ here, regions, dismissed: readJson<Dismissals>(DISMISS_KEY, {}), now: Date.now() }));
        },
      );
    })().catch(() => {});
    return () => {
      cancelled = true;
      sub.current?.remove();
    };
  }, []);

  if (!candidate) return null;
  const { region } = candidate;

  const remember = () => {
    writeJson(DISMISS_KEY, { ...readJson<Dismissals>(DISMISS_KEY, {}), [region.placeId]: Date.now() });
    setCandidate(null);
  };

  return (
    <View
      style={{
        position: 'absolute', left: 12, right: 12, bottom: insets.bottom + 64,
        backgroundColor: t.accent, borderRadius: 16, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12,
        shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 6,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>Are you at {region.label}?</Text>
        <Text style={{ color: '#fff', opacity: 0.85 }}>{Math.round(candidate.distanceM)} m away</Text>
      </View>
      <Pressable
        onPress={() => {
          remember();
          router.push({ pathname: '/list/[placeId]', params: { placeId: region.placeId, label: region.label } });
        }}
        style={{ backgroundColor: '#fff', paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12 }}
      >
        <Text style={{ color: t.accent, fontWeight: '700' }}>I'm here</Text>
      </Pressable>
      <Pressable onPress={remember} hitSlop={10}>
        <Text style={{ color: '#fff', fontSize: 18 }}>✕</Text>
      </Pressable>
    </View>
  );
}
