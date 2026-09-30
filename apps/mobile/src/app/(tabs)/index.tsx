import { useCallback, useEffect, useState } from 'react';
import { Alert, Image, RefreshControl, SafeAreaView, ScrollView, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { deleteMemory, listMembers, listMemories, listPhotoUrls, listPlaces, markDone } from '@/lib/api';
import { capture, flush, pending } from '@/lib/outbox';
import { uuid } from '@/lib/id';
import { nearbyMemories } from '@/lib/reminders';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';
import { Btn, Card, Field, Muted, styles } from '@/lib/ui';
import type { Member, Memory, Place } from '@/lib/types';

export default function Memories() {
  const t = useTheme();
  const { household, session } = useSession();
  const [memories, setMemories] = useState<Memory[]>([]);
  const [places, setPlaces] = useState<Place[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [photos, setPhotos] = useState<Record<string, string[]>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [queued, setQueued] = useState(pending().length);
  const [near, setNear] = useState<Awaited<ReturnType<typeof nearbyMemories>> | null>(null);

  const [body, setBody] = useState('');
  const [placeId, setPlaceId] = useState<string | null>(null);
  const [uris, setUris] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!household) return;
    try {
      await flush();
      const [m, p, mem] = await Promise.all([
        listMemories(household.id, ['inbox', 'active']),
        listPlaces(household.id),
        listMembers(household.id),
      ]);
      setMemories(m);
      setPlaces(p);
      setMembers(mem);
      setPhotos(await listPhotoUrls(m.map((x) => x.id)));
    } catch {
      // offline: keep showing what we have
    }
    setQueued(pending().length);
  }, [household]);

  useEffect(() => {
    void load();
  }, [load]);

  const who = (id: string) => (id === session?.user.id ? 'You' : members.find((m) => m.user_id === id)?.display_name ?? 'Partner');
  const placeName = (id: string | null) => places.find((p) => p.id === id)?.name;

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
      const perm = await Location.getForegroundPermissionsAsync();
      if (perm.granted) {
        const pos = await Location.getLastKnownPositionAsync();
        lat = pos?.coords.latitude ?? null;
        lon = pos?.coords.longitude ?? null;
      }
    } catch {
      // location stamp is optional
    }
    await capture({
      id: uuid(), household_id: household.id, body: body.trim(), place_id: placeId,
      capture_lat: lat, capture_lon: lon, photoUris: uris,
    });
    setBody('');
    setUris([]);
    setPlaceId(null);
    setSaving(false);
    await load();
  }

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView
        contentContainerStyle={styles.screen}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <Card>
          <Field placeholder="What do you want to remember?" multiline value={body} onChangeText={setBody} />
          <View style={styles.row}>
            <Btn label="📷 Camera" onPress={() => pick(true)} />
            <Btn label="🖼 Library" onPress={() => pick(false)} />
            {uris.length > 0 && <Muted>{uris.length} photo(s)</Muted>}
          </View>
          {places.length > 0 && (
            <View style={styles.row}>
              <Btn label="No place" primary={placeId === null} onPress={() => setPlaceId(null)} />
              {places.map((p) => (
                <Btn key={p.id} label={`📍 ${p.name}`} primary={placeId === p.id} onPress={() => setPlaceId(p.id)} />
              ))}
            </View>
          )}
          <Btn primary label={saving ? 'Saving…' : 'Save'} onPress={save} disabled={saving} />
          {queued > 0 && <Muted>{queued} waiting to sync (offline)</Muted>}
        </Card>

        <Btn label="What's near me?" onPress={async () => setNear(await nearbyMemories())} />
        {near && (
          <Card>
            {near.length === 0 && <Muted>Nothing to remember within 3 km.</Muted>}
            {near.map((n) => (
              <View key={n.label}>
                <Text style={{ color: t.fg, fontWeight: '600' }}>{n.label} · {n.distanceM} m</Text>
                {n.memories.map((m) => (
                  <Text key={m.id} style={{ color: t.fg }}>• {m.body}</Text>
                ))}
              </View>
            ))}
          </Card>
        )}

        <Text style={{ color: t.fg, fontSize: 18, fontWeight: '700' }}>To remember</Text>
        {memories.length === 0 && <Muted>Nothing here yet.</Muted>}
        {memories.map((m) => (
          <Card key={m.id}>
            {m.body ? <Text style={{ color: t.fg, fontSize: 16 }}>{m.body}</Text> : null}
            {(photos[m.id] ?? []).length > 0 && (
              <View style={styles.row}>
                {photos[m.id].map((u) => (
                  <Image key={u} source={{ uri: u }} style={{ width: 96, height: 96, borderRadius: 8 }} />
                ))}
              </View>
            )}
            <Muted>
              {who(m.author_id)} · {new Date(m.created_at).toLocaleDateString()}
              {placeName(m.place_id) ? ` · 📍 ${placeName(m.place_id)}` : ''}
            </Muted>
            <View style={styles.row}>
              <Btn label="Done" onPress={async () => { await markDone([m.id]); await load(); }} />
              <Btn
                danger
                label="Delete"
                onPress={() =>
                  Alert.alert('Delete this memory?', undefined, [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Delete', style: 'destructive', onPress: async () => { await deleteMemory(m.id); await load(); } },
                  ])
                }
              />
            </View>
          </Card>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
