import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { hereCandidate, type Dismissals } from '../core/proximity.ts';
import { selectRegions } from '../core/regions.ts';
import type { PoiCache } from '../core/pois.ts';
import type { Region } from '../core/types.ts';
import { readSnapshot, storeKeys } from './reminders';
import { useI18n } from './i18n';
import { readJson, writeJson } from './store';
import { font, useTheme } from './theme';
import { Icon } from './ui';

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

  // A slim, solid strip just above the "Add a to-do" bar (not glass, so the text stays easy to read). Tap "I'm here" to open the
  // place's list, the cross to dismiss it for a while.
  const go = () => {
    remember();
    router.push({ pathname: '/list/[placeId]', params: { placeId: region.placeId, label: region.label } });
  };
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 16, right: 16, bottom: Math.max(insets.bottom, 12) + 74 + 58 + 8 }}>
      <View accessibilityRole="alert" style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, borderRadius: 18, paddingVertical: 8, paddingLeft: 14, paddingRight: 8, backgroundColor: t.card, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: t.line, shadowColor: '#000', shadowOpacity: t.dark ? 0.35 : 0.1, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 3 }}>
        <Icon name="mappin" size={18} color={t.accent} />
        <Pressable accessibilityRole="button" onPress={go} style={{ flex: 1 }}>
          <Text numberOfLines={1} style={{ color: t.ink, fontSize: 15, fontFamily: font.semi }}>{tr('here.title', { place: region.label })}</Text>
          <Text numberOfLines={1} style={{ color: t.muted, fontSize: 13, fontFamily: font.body }}>{tn('here.detail', candidate.count, { d: Math.round(candidate.distanceM) })}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={go} style={{ height: 38, paddingHorizontal: 16, borderRadius: 19, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: '#FFFFFF', fontSize: 15, fontFamily: font.semi }}>{tr('here.imHere')}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={tr('common.notNow')} hitSlop={8} onPress={remember} style={{ width: 38, height: 38, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="xmark" size={14} color={t.muted} />
        </Pressable>
      </View>
    </View>
  );
}
