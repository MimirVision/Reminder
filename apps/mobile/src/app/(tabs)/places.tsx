import { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { addPlace, deletePlace, listPlaces, updatePlaceCategory, updatePlaceRadius } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { refreshRegions } from '@/lib/reminders';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';
import { useToast } from '@/lib/Toast';
import { BAR_SPACE, Btn, Card, Field, Muted, PlaceChip, SectionLabel, Title, styles } from '@/lib/ui';
import { PlaceSearch, type Pick } from '@/lib/WherePicker';
import { categoryFromName, directionsUrl, findExistingPlace } from '../../shared/lib/placeSearch';
import { CATEGORIES, categoryName, placeLabel, shopName } from '../../shared/lib/labels';
import type { Place } from '@/lib/types';

const RADII = [100, 150, 250, 500, 1000];

export default function Places() {
  const th = useTheme();
  const { t } = useI18n();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { household } = useSession();
  const [places, setPlaces] = useState<Place[]>([]);
  const [key, setKey] = useState(0); // remounts the search box after adding, so it is empty again
  const [name, setName] = useState('');

  const load = useCallback(async () => {
    if (household) setPlaces(await listPlaces(household.id).catch(() => []));
  }, [household]);
  useEffect(() => { void load(); }, [load]);

  async function run(fn: () => Promise<void>) {
    try {
      await fn();
      await load();
      void refreshRegions().catch(() => {});
    } catch (e) {
      Alert.alert(t('common.error'), e instanceof Error ? e.message : String(e));
    }
  }

  const add = (p: Pick) => household && run(async () => {
    if (p.type === 'saved') return;
    if (p.type === 'kind') {
      const n = categoryName(p.category, t);
      await addPlace({ household_id: household.id, name: n, kind: 'category', category: p.category, lat: null, lon: null, radius_m: 150 });
      toast({ text: t('places.saved', { name: n }) });
    } else {
      if (findExistingPlace(places, p.hit)) return;
      await addPlace({ household_id: household.id, name: p.hit.name, kind: 'fixed', category: p.hit.category ?? categoryFromName(p.hit.name), lat: p.hit.lat, lon: p.hit.lon, radius_m: p.hit.isAddress ? 150 : 200, address: p.hit.address || null });
      toast({ text: t('places.saved', { name: p.hit.name }) });
    }
    setKey((k) => k + 1);
  });

  async function addHere() {
    if (!household || !name.trim()) return;
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) return Alert.alert(t('places.locationNeeded'));
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    await run(async () => {
      await addPlace({ household_id: household.id, name: name.trim(), kind: 'fixed', category: null, lat: pos.coords.latitude, lon: pos.coords.longitude, radius_m: 150 });
      setName('');
    });
  }

  return (
    <ScrollView automaticallyAdjustKeyboardInsets style={{ backgroundColor: th.bg }} contentContainerStyle={[styles.screen, { paddingTop: insets.top + 12, paddingBottom: BAR_SPACE - 60 }]} keyboardShouldPersistTaps="handled">
      <Title>{t('places.title')}</Title>
      <Muted>{t('places.intro')}</Muted>

      <SectionLabel>{t('places.addSpecific')}</SectionLabel>
      <Card>
        <Muted>{t('places.addHelp')}</Muted>
        <PlaceSearch key={key} places={places} showSaved={false} onPick={add} />
        <View style={styles.row}>
          {CATEGORIES.filter((c) => !places.some((p) => p.kind === 'category' && p.category === c)).map((c) => (
            <Btn key={c} small label={`+ ${categoryName(c, t)}`} onPress={() => add({ type: 'kind', category: c })} />
          ))}
        </View>
      </Card>

      {places.length === 0 && <Muted>{t('places.empty')}</Muted>}
      {places.map((p) => (
        <Card key={p.id}>
          <PlaceChip label={placeLabel(p, t)} icon={p.kind === 'category' ? 'storefront' : 'mappin'} />
          <Muted>{p.address ?? (p.kind === 'category' ? t('places.kindCategory') : t('places.kindFixed'))} · {t('places.meters', { n: p.radius_m })}</Muted>
          {p.kind === 'fixed' && (
            <View style={styles.row}>
              <Muted>{t('places.kindOfShop')}</Muted>
              <Btn small label={t('common.none')} primary={!p.category} onPress={() => run(() => updatePlaceCategory(p.id, null))} />
              {CATEGORIES.map((c) => <Btn key={c} small label={shopName(c, t)} primary={p.category === c} onPress={() => run(() => updatePlaceCategory(p.id, c))} />)}
            </View>
          )}
          <View style={styles.row}>
            <Btn small label={`${t('places.distance')} ${p.radius_m} m`} onPress={() => run(() => updatePlaceRadius(p.id, RADII[(RADII.indexOf(p.radius_m) + 1) % RADII.length] ?? 150))} />
            {p.lat != null && p.lon != null && <Btn small label={t('where.directions')} onPress={() => void Linking.openURL(directionsUrl({ lat: p.lat as number, lon: p.lon as number }))} />}
            <Btn small danger label={t('common.delete')} onPress={() => Alert.alert(t('places.confirmDelete', { name: placeLabel(p, t) }), undefined, [
              { text: t('common.cancel'), style: 'cancel' },
              { text: t('common.delete'), style: 'destructive', onPress: () => void run(() => deletePlace(p.id)) },
            ])} />
          </View>
        </Card>
      ))}

      <SectionLabel>{t('places.hereSave')}</SectionLabel>
      <Field placeholder={t('places.hereName')} value={name} onChangeText={setName} />
      <Btn label={t('places.hereSave')} onPress={addHere} disabled={!name.trim()} />
    </ScrollView>
  );
}
