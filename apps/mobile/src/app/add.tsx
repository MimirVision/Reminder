import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { listPlaces } from '@/lib/api';
import { uuid } from '@/lib/id';
import { capture } from '@/lib/outbox';
import { useSession } from '@/lib/session';
import { font, useTheme } from '@/lib/theme';
import { Btn, Field, Muted, SectionLabel, styles } from '@/lib/ui';
import type { Place } from '@/lib/types';

export default function Add() {
  const t = useTheme();
  const router = useRouter();
  const { household } = useSession();
  const params = useLocalSearchParams<{ placeId?: string }>();
  const [body, setBody] = useState('');
  const [placeId, setPlaceId] = useState<string | null>(params.placeId ?? null);
  const [places, setPlaces] = useState<Place[]>([]);
  const [uris, setUris] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (household) listPlaces(household.id).then(setPlaces).catch(() => {});
  }, [household]);

  async function pick(camera: boolean) {
    const perm = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const res = camera
      ? await ImagePicker.launchCameraAsync({ quality: 0.8 })
      : await ImagePicker.launchImageLibraryAsync({ quality: 0.8, allowsMultipleSelection: true });
    if (!res.canceled) setUris((u) => [...u, ...res.assets.map((a) => a.uri)]);
  }

  async function save() {
    if (!household || (!body.trim() && uris.length === 0)) return;
    setSaving(true);
    let lat: number | null = null;
    let lon: number | null = null;
    try {
      if ((await Location.getForegroundPermissionsAsync()).granted) {
        const pos = await Location.getLastKnownPositionAsync();
        lat = pos?.coords.latitude ?? null;
        lon = pos?.coords.longitude ?? null;
      }
    } catch {
      // location stamp is optional
    }
    // One to-do per line, so a pasted list becomes several.
    const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
    const bodies = lines.length > 0 ? lines : [''];
    for (const [i, b] of bodies.entries()) {
      await capture({
        id: uuid(), household_id: household.id, body: b, place_id: placeId,
        capture_lat: lat, capture_lon: lon, photoUris: i === 0 ? uris : [],
      });
    }
    router.back();
  }

  return (
    <ScrollView contentContainerStyle={[styles.screen, { paddingTop: 24 }]} keyboardShouldPersistTaps="handled" style={{ backgroundColor: t.bg }}>
      <Text style={{ color: t.ink, fontSize: 28, fontFamily: font.display }}>New to-do</Text>
      <Field placeholder="What needs doing? One per line for several." multiline autoFocus value={body} onChangeText={setBody} />
      <View style={styles.row}>
        <Btn small label="Take photo" onPress={() => pick(true)} />
        <Btn small label="Choose photo" onPress={() => pick(false)} />
        {uris.length > 0 && <Muted>{uris.length} photo(s)</Muted>}
      </View>
      <SectionLabel>Where?</SectionLabel>
      <View style={styles.row}>
        <Btn small label="Anytime" primary={placeId === null} onPress={() => setPlaceId(null)} />
        {places.map((p) => (
          <Btn key={p.id} small label={p.name} primary={placeId === p.id} onPress={() => setPlaceId(p.id)} />
        ))}
      </View>
      <Muted>Pick a place and you get a reminder when you are near it.</Muted>
      <Btn primary label={saving ? 'Saving…' : 'Add to-do'} onPress={save} disabled={saving || (!body.trim() && uris.length === 0)} />
      <Btn label="Cancel" onPress={() => router.back()} />
    </ScrollView>
  );
}
