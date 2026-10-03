import { useCallback, useEffect, useState } from 'react';
import { ActionSheetIOS, Alert, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { addPlace, deletePlace, listPlaces, updatePlaceCategory, updatePlaceRadius } from '@/lib/api';
import { Chip } from '@/lib/Chip';
import { useI18n } from '@/lib/i18n';
import { refreshRegions } from '@/lib/reminders';
import { useSession } from '@/lib/session';
import { font, useTheme } from '@/lib/theme';
import { Select } from '@/lib/Select';
import { readSnapshot } from '@/lib/reminders';
import { useToast } from '@/lib/Toast';
import { BAR_SPACE, Btn, Card, Field, Icon, Muted, SectionLabel, Title, styles } from '@/lib/ui';
import { PlaceSearch, type Pick } from '@/lib/WherePicker';
import { categoryFromName, directionsUrl, findExistingPlace } from '../../shared/lib/placeSearch';
import { CATEGORIES, categoryName, placeLabel, shopName } from '../../shared/lib/labels';
import type { Place } from '@/lib/types';

const RADII = [100, 150, 250, 500, 1000]; // iOS does not watch regions smaller than about 100 m reliably
const meters = (n: number) => (n >= 1000 ? `${n / 1000} km` : `${n} m`);

export default function Places() {
  const th = useTheme();
  const { t, tn } = useI18n();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { household } = useSession();
  const [places, setPlaces] = useState<Place[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [key, setKey] = useState(0); // remounts the search box after adding, so it is empty again
  const [name, setName] = useState('');
  const [savingHere, setSavingHere] = useState(false);

  const load = useCallback(async () => {
    if (!household) return;
    setPlaces(await listPlaces(household.id).catch(() => []));
    const c: Record<string, number> = {};
    for (const m of readSnapshot().memories) if (m.place_id) c[m.place_id] = (c[m.place_id] ?? 0) + 1;
    setCounts(c);
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
      setSavingHere(false);
    });
  }

  // The "..." menu on a place: directions, or delete (after a confirmation).
  function more(p: Place) {
    const canGo = p.lat != null && p.lon != null;
    const labels = [...(canGo ? [t('where.directions')] : []), t('common.delete'), t('common.cancel')];
    ActionSheetIOS.showActionSheetWithOptions(
      { title: placeLabel(p, t), options: labels, cancelButtonIndex: labels.length - 1, destructiveButtonIndex: labels.length - 2, userInterfaceStyle: th.dark ? 'dark' : 'light' },
      (i) => {
        if (canGo && i === 0) void Linking.openURL(directionsUrl({ lat: p.lat as number, lon: p.lon as number }));
        else if (i === labels.length - 2) {
          Alert.alert(t('places.confirmDelete', { name: placeLabel(p, t) }), undefined, [
            { text: t('common.cancel'), style: 'cancel' },
            { text: t('common.delete'), style: 'destructive', onPress: () => void run(() => deletePlace(p.id)) },
          ]);
        }
      },
    );
  }

  const radiusOptions = (p: Place) => [...new Set([...RADII, p.radius_m])].sort((a, b) => a - b).map((r) => ({ value: r, label: meters(r) }));
  const kinds = CATEGORIES.filter((c) => !places.some((p) => p.kind === 'category' && p.category === c));

  return (
    <ScrollView automaticallyAdjustKeyboardInsets style={{ backgroundColor: th.bg }} contentContainerStyle={[styles.screen, { paddingTop: insets.top + 12, paddingBottom: BAR_SPACE - 60 }]} keyboardShouldPersistTaps="handled">
      <Title>{t('places.title')}</Title>
      <Muted>{t('places.intro')}</Muted>

      <Card>
        <Text style={{ color: th.ink, fontSize: 17, fontFamily: font.semi }}>{t('places.addSpecific')}</Text>
        <PlaceSearch key={key} places={places} showSaved={false} onPick={add} />
        {kinds.length > 0 && (
          <>
            <Muted>{t('places.addKinds')}</Muted>
            <View style={styles.row}>{kinds.map((c) => <Chip key={c} icon="plus" label={categoryName(c, t)} onPress={() => add({ type: 'kind', category: c })} />)}</View>
          </>
        )}
        {savingHere ? (
          <View style={{ gap: 10 }}>
            <Muted>{t('places.saveHereHelp')}</Muted>
            <Field placeholder={t('places.hereName')} value={name} onChangeText={setName} autoFocus />
            <View style={styles.row}>
              <Btn primary small label={t('places.hereSave')} onPress={addHere} disabled={!name.trim()} />
              <Btn small label={t('common.cancel')} onPress={() => { setSavingHere(false); setName(''); }} />
            </View>
          </View>
        ) : <Chip icon="location.fill" label={t('places.hereSave')} onPress={() => setSavingHere(true)} />}
      </Card>

      <SectionLabel>{places.length > 0 ? `${t('places.yourPlaces')} (${places.length})` : t('places.yourPlaces')}</SectionLabel>
      {places.length === 0 && <Muted>{t('places.empty')}</Muted>}
      {places.map((p) => (
        <Card key={p.id} gap={4}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: th.tint, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={p.kind === 'category' ? 'storefront' : 'mappin'} size={18} color={th.tintInk} />
            </View>
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={{ color: th.ink, fontSize: 17, fontFamily: font.semi }}>{placeLabel(p, t)}</Text>
              <Text numberOfLines={1} style={{ color: th.muted, fontSize: 13, fontFamily: font.body }}>
                {[p.address ?? (p.kind === 'category' ? t('places.kindCategory') : t('places.kindFixed')), counts[p.id] ? tn('places.openTodos', counts[p.id]) : ''].filter(Boolean).join(' · ')}
              </Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={t('places.more')} hitSlop={10} onPress={() => more(p)} style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="ellipsis" size={20} color={th.muted} />
            </Pressable>
          </View>
          <View style={{ height: 1, backgroundColor: th.line, marginTop: 8 }} />
          <Select label={t('places.remindWithin')} title={t('places.pickDistance')} value={p.radius_m} options={radiusOptions(p)} onChange={(r) => void run(() => updatePlaceRadius(p.id, r))} />
          {p.kind === 'fixed' && (
            <Select<string | null> label={t('places.shopType')} title={t('places.pickType')} value={p.category ?? null}
              options={[{ value: null, label: t('common.none') }, ...CATEGORIES.map((c) => ({ value: c as string | null, label: shopName(c, t) }))]}
              onChange={(c) => void run(() => updatePlaceCategory(p.id, c))} />
          )}
        </Card>
      ))}
    </ScrollView>
  );
}
