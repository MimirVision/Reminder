import { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { addPlace, deletePlace, listPlaces, updatePlaceRadius } from '@/lib/api';
import { refreshRegions } from '@/lib/reminders';
import { useSession } from '@/lib/session';
import { font, useTheme } from '@/lib/theme';
import { BAR_SPACE, Btn, Card, Field, Muted, PlaceChip, SectionLabel, Title, styles } from '@/lib/ui';
import type { Place } from '@/lib/types';

const RADII = [100, 150, 250, 500, 1000];

const CATEGORIES = [
  { category: 'pharmacy', name: 'Any pharmacy (apotek)' },
  { category: 'hardware', name: 'Any hardware store (byggevarehus)' },
  { category: 'grocery', name: 'Any grocery store (dagligvare)' },
  { category: 'paint', name: 'Any paint shop (malingforretning)' },
  { category: 'garden', name: 'Any garden centre (hagesenter)' },
];

export default function Places() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { household } = useSession();
  const [places, setPlaces] = useState<Place[]>([]);
  const [name, setName] = useState('');
  const [radius, setRadius] = useState(150);
  const [shopKind, setShopKind] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (household) setPlaces(await listPlaces(household.id).catch(() => []));
  }, [household]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(fn: () => Promise<void>) {
    try {
      await fn();
      await load();
      void refreshRegions().catch(() => {});
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : String(e));
    }
  }

  async function addHere() {
    if (!household || !name.trim()) return;
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) return Alert.alert('Location permission is needed to save this place.');
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    await run(async () => {
      await addPlace({
        household_id: household.id, name: name.trim(), kind: 'fixed', category: shopKind,
        lat: pos.coords.latitude, lon: pos.coords.longitude, radius_m: radius,
      });
      setName('');
      setShopKind(null);
    });
  }

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={[styles.screen, { paddingTop: insets.top + 12, paddingBottom: BAR_SPACE - 60 }]} keyboardShouldPersistTaps="handled">
      <Title>Places</Title>
      <Muted>Where you want to be reminded. The distance is how close you get before "Are you here?" appears.</Muted>
      {places.length === 0 && <Muted>No places yet.</Muted>}
      {places.map((p) => (
        <Card key={p.id}>
          <PlaceChip label={p.name} />
          <Muted>{p.kind === 'category' ? 'Any nearby shop of this kind' : 'A specific place'} · within {p.radius_m} m</Muted>
          <View style={styles.row}>
            <Btn small label={`Distance ${p.radius_m} m`} onPress={() => run(() => updatePlaceRadius(p.id, RADII[(RADII.indexOf(p.radius_m) + 1) % RADII.length] ?? 150))} />
            <Btn small danger label="Delete" onPress={() => run(() => deletePlace(p.id))} />
          </View>
        </Card>
      ))}

      <SectionLabel>Add a category</SectionLabel>
      <View style={styles.row}>
        {CATEGORIES.filter((c) => !places.some((p) => p.category === c.category)).map((c) => (
          <Btn
            key={c.category}
            small
            label={`+ ${c.name}`}
            onPress={() =>
              household &&
              run(() => addPlace({ household_id: household.id, name: c.name, kind: 'category', category: c.category, lat: null, lon: null, radius_m: 150 }))
            }
          />
        ))}
      </View>

      <SectionLabel>Save where I am now</SectionLabel>
      <Field placeholder="Name (e.g. Home, Byggmax)" value={name} onChangeText={setName} />
      <View style={styles.row}>
        {[100, 150, 250, 500].map((r) => <Btn key={r} small label={`${r} m`} primary={radius === r} onPress={() => setRadius(r)} />)}
      </View>
      <Muted>Kind of shop (optional): facts you tagged for it show up on its list.</Muted>
      <View style={styles.row}>
        <Btn small label="None" primary={shopKind === null} onPress={() => setShopKind(null)} />
        {CATEGORIES.map((c) => <Btn key={c.category} small label={c.category} primary={shopKind === c.category} onPress={() => setShopKind(c.category)} />)}
      </View>
      <Btn primary label="Save this place" onPress={addHere} disabled={!name.trim()} />
      <Text style={{ color: t.muted, fontSize: 12, fontFamily: font.body }}> </Text>
    </ScrollView>
  );
}
