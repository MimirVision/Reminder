import { useEffect, useRef, useState } from 'react';
import { Modal, Text, View } from 'react-native';
import MapView, { type Region } from 'react-native-maps';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { pinHit, reverseGeocode, type Hit } from '../shared/lib/placeSearch';
import { useI18n } from './i18n';
import { font, useTheme } from './theme';
import { Btn, Icon, Muted } from './ui';

const OSLO = { latitude: 59.9139, longitude: 10.7522, latitudeDelta: 0.25, longitudeDelta: 0.25 };

/** Choose a spot by moving the map under a fixed pin. What is there (address or place) is looked up and shown. */
export function PinPicker({ onPick, onClose }: { onPick: (h: Hit) => void; onClose: () => void }) {
  const th = useTheme();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const map = useRef<MapView>(null);
  const [start, setStart] = useState<Region | null | undefined>(undefined); // undefined: still working it out
  const [centre, setCentre] = useState<{ lat: number; lon: number } | null>(null);
  const [found, setFound] = useState<Hit | null>(null);
  const [looking, setLooking] = useState(false);
  const [offline, setOffline] = useState(false);
  const [locating, setLocating] = useState(false);

  // Open on where you are (last known position, if allowed), else Oslo.
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        if ((await Location.getForegroundPermissionsAsync()).granted) {
          const p = await Location.getLastKnownPositionAsync();
          if (p && live) { setStart({ latitude: p.coords.latitude, longitude: p.coords.longitude, latitudeDelta: 0.004, longitudeDelta: 0.004 }); setCentre({ lat: p.coords.latitude, lon: p.coords.longitude }); return; }
        }
      } catch { /* Oslo */ }
      if (live) { setStart(null); setCentre({ lat: OSLO.latitude, lon: OSLO.longitude }); }
    })();
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (!centre) return;
    setLooking(true); setOffline(false);
    const ctl = new AbortController();
    const id = setTimeout(() => {
      reverseGeocode(centre.lat, centre.lon, ctl.signal)
        .then((h) => { setFound(h); setLooking(false); })
        .catch((e) => { if ((e as Error).name === 'AbortError') return; setFound(null); setOffline(true); setLooking(false); });
    }, 350);
    return () => { clearTimeout(id); ctl.abort(); };
  }, [centre]);

  async function toMe() {
    setLocating(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) return;
      const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      map.current?.animateToRegion({ latitude: p.coords.latitude, longitude: p.coords.longitude, latitudeDelta: 0.003, longitudeDelta: 0.003 }, 500);
    } catch { /* stay where we are */ } finally { setLocating(false); }
  }

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: th.bg }}>
        <View style={{ padding: 16, gap: 4, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <Text accessibilityRole="header" style={{ color: th.ink, fontFamily: font.display, fontSize: 26 }}>{t('pin.title')}</Text>
            <Muted>{t('pin.help')}</Muted>
          </View>
          <Btn small label={t('common.close')} onPress={onClose} />
        </View>
        <View style={{ flex: 1 }}>
          {start !== undefined && (
            <MapView ref={map} style={{ flex: 1 }} initialRegion={start ?? OSLO} showsUserLocation userInterfaceStyle={th.dark ? 'dark' : 'light'}
              accessibilityLabel={t('pin.mapAria')} onRegionChangeComplete={(r) => setCentre({ lat: r.latitude, lon: r.longitude })} />
          )}
          {/* The pin stays in the middle; its tip is the chosen spot. */}
          <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ marginBottom: 38 }}><Icon name="mappin" size={38} color={th.accent} /></View>
          </View>
          <View style={{ position: 'absolute', right: 12, bottom: 12 }}>
            <Btn small disabled={locating} label={t('pin.locate')} onPress={() => void toMe()} />
          </View>
        </View>
        <View style={{ padding: 16, gap: 10, paddingBottom: insets.bottom + 16 }}>
          <View style={{ minHeight: 44, justifyContent: 'center' }} accessibilityLiveRegion="polite">
            {looking ? <Muted>{t('where.searching')}</Muted>
              : offline ? <Muted>{t('pin.offline')}</Muted>
              : found ? <Text style={{ color: th.ink, fontFamily: font.semi, fontSize: 16 }}>{found.name || found.address}{found.name && found.address ? <Text style={{ color: th.muted, fontFamily: font.body }}>{`  ·  ${found.address}`}</Text> : null}</Text>
              : <Muted>{t('pin.nothing')}</Muted>}
          </View>
          <Btn primary disabled={!centre || looking} label={t('pin.use')} onPress={() => centre && onPick(pinHit(centre.lat, centre.lon, found, t('pin.defaultName')))} />
        </View>
      </View>
    </Modal>
  );
}
