import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { hereCandidate, type Dismissals } from '../core/proximity.ts';
import { selectRegions } from '../core/regions.ts';
import type { PoiCache } from '../core/pois.ts';
import type { Region } from '../core/types.ts';
import { Glass } from './glass';
import { readSnapshot, storeKeys } from './reminders';
import { useI18n } from './i18n';
import { readJson, writeJson } from './store';
import { font, useTheme } from './theme';

const DISMISS_KEY = 'hm.hereDismissed';

// "Are you here?" While the app is open and you are within a store's distance, a glass card appears above the
// tab bar. "I'm here" opens that place's list.
export function HereBanner() {
  const t = useTheme();
  const { t: tr, tn } = useI18n();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [candidate, setCandidate] = useState<{ region: Region; distanceM: number; count: number } | null>(null);
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
          const c = hereCandidate({ here, regions, dismissed: readJson<Dismissals>(DISMISS_KEY, {}), now: Date.now() });
          setCandidate(c ? { ...c, count: memories.filter((m) => m.place_id === c.region.placeId).length } : null);
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
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 16, right: 16, bottom: Math.max(insets.bottom, 12) + 74 }}>
      <Glass style={{ borderRadius: 30, padding: 16, gap: 14 }}>
        <View style={{ gap: 2 }}>
          <Text style={{ color: t.ink, fontSize: 22, lineHeight: 27, fontFamily: font.display }}>{tr('here.title', { place: region.label })}</Text>
          <Text style={{ color: t.ink, opacity: 0.75, fontSize: 15, fontFamily: font.body }}>
            {tn('here.detail', candidate.count, { d: Math.round(candidate.distanceM) })}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              remember();
              router.push({ pathname: '/list/[placeId]', params: { placeId: region.placeId, label: region.label } });
            }}
            style={{ flex: 1, height: 50, borderRadius: 25, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={{ color: '#FFFFFF', fontSize: 17, fontFamily: font.semi }}>{tr('here.imHere')}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={remember}
            style={{ height: 50, paddingHorizontal: 22, borderRadius: 25, backgroundColor: t.dark ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.7)', alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={{ color: t.ink, fontSize: 16, fontFamily: font.semi }}>{tr('common.notNow')}</Text>
          </Pressable>
        </View>
      </Glass>
    </View>
  );
}
