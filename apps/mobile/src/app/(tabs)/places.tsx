import { useCallback, useEffect, useState } from 'react';
import { Alert, SafeAreaView, ScrollView, Text, View } from 'react-native';
import * as Location from 'expo-location';
import { addPlace, deletePlace, listPlaces } from '@/lib/api';
import { refreshRegions } from '@/lib/reminders';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';
import { Btn, Card, Field, Muted, styles } from '@/lib/ui';
import type { Place } from '@/lib/types';

const CATEGORIES = [
  { category: 'pharmacy', name: 'Any pharmacy (apotek)' },
  { category: 'hardware', name: 'Any hardware store (byggevarehus)' },
  { category: 'grocery', name: 'Any grocery store (dagligvare)' },
  { category: 'paint', name: 'Any paint shop (malingforretning)' },
  { category: 'garden', name: 'Any garden centre (hagesenter)' },
];

export default function Places() {
  const t = useTheme();
  const { household } = useSession();
  const [places, setPlaces] = useState<Place[]>([]);
  const [name, setName] = useState('');
  const [radius, setRadius] = useState(150);

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
        household_id: household.id, name: name.trim(), kind: 'fixed', category: null,
        lat: pos.coords.latitude, lon: pos.coords.longitude, radius_m: radius,
      });
      setName('');
    });
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
        {places.length === 0 && <Muted>No places yet.</Muted>}
        {places.map((p) => (
          <Card key={p.id}>
            <Text style={{ color: t.fg, fontWeight: '600' }}>{p.name}</Text>
            <Muted>{p.kind === 'category' ? 'category' : `${p.radius_m} m radius`}</Muted>
            <Btn danger label="Delete" onPress={() => run(() => deletePlace(p.id))} />
          </Card>
        ))}

        <Text style={{ color: t.fg, fontSize: 16, fontWeight: '700' }}>Add a category</Text>
        <View style={styles.row}>
          {CATEGORIES.filter((c) => !places.some((p) => p.category === c.category)).map((c) => (
            <Btn
              key={c.category}
              label={`+ ${c.name}`}
              onPress={() =>
                household &&
                run(() => addPlace({
                  household_id: household.id, name: c.name, kind: 'category', category: c.category,
                  lat: null, lon: null, radius_m: 150,
                }))
              }
            />
          ))}
        </View>

        <Text style={{ color: t.fg, fontSize: 16, fontWeight: '700' }}>Save where I am now</Text>
        <Field placeholder="Name (e.g. Home, Byggmax)" value={name} onChangeText={setName} />
        <View style={styles.row}>
          {[100, 150, 250, 500].map((r) => (
            <Btn key={r} label={`${r} m`} primary={radius === r} onPress={() => setRadius(r)} />
          ))}
        </View>
        <Btn primary label="Save this place" onPress={addHere} disabled={!name.trim()} />
      </ScrollView>
    </SafeAreaView>
  );
}
