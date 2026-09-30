import { useCallback, useEffect, useMemo, useState } from 'react';
import { Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { listMembers, listMemories, listPhotoUrls, listPlaces, markDone } from '@/lib/api';
import { AddBar } from '@/lib/AddBar';
import { Glass } from '@/lib/glass';
import { flush, pending } from '@/lib/outbox';
import { mapPins, refreshRegions, type Pin } from '@/lib/reminders';
import { useSession } from '@/lib/session';
import { font, useTheme } from '@/lib/theme';
import { TodoMap } from '@/lib/TodoMap';
import { BAR_SPACE, Card, Check, Muted, PlaceChip, SectionLabel, Title, styles } from '@/lib/ui';
import { distanceM } from '../../core/geo.ts';
import type { Member, Memory, Place } from '@/lib/types';
import type { LatLon } from '../../core/types.ts';

const NEAR_M = 3000;
const km = (m: number) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);

type Group = { placeId: string; label: string; distance: number | null; items: Memory[] };

export default function Todo() {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { household, session } = useSession();
  const [mode, setMode] = useState<'List' | 'Map'>('List');
  const [memories, setMemories] = useState<Memory[]>([]);
  const [places, setPlaces] = useState<Place[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [photos, setPhotos] = useState<Record<string, string[]>>({});
  const [pins, setPins] = useState<Pin[]>([]);
  const [here, setHere] = useState<LatLon | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [queued, setQueued] = useState(pending().length);

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
      await refreshRegions().catch(() => {});
    } catch {
      // offline: keep showing what we have
    }
    const mp = await mapPins().catch(() => ({ here: null, pins: [] as Pin[] }));
    setPins(mp.pins);
    setHere(mp.here);
    setQueued(pending().length);
  }, [household]);

  useEffect(() => {
    void load();
  }, [load]);

  const { near, atPlace, anytime } = useMemo(() => {
    const byPlace = new Map<string, Memory[]>();
    const anytime: Memory[] = [];
    for (const m of memories) {
      if (!m.place_id) anytime.push(m);
      else byPlace.set(m.place_id, [...(byPlace.get(m.place_id) ?? []), m]);
    }
    const near: Group[] = [];
    const atPlace: Group[] = [];
    for (const [placeId, items] of byPlace) {
      const place = places.find((p) => p.id === placeId);
      const pinsHere = pins.filter((p) => p.placeId === placeId);
      const closest = here && pinsHere.length
        ? pinsHere.map((p) => ({ p, d: distanceM(here, { lat: p.lat, lon: p.lon }) })).sort((a, b) => a.d - b.d)[0]
        : null;
      const g: Group = { placeId, label: closest?.p.label ?? place?.name ?? 'Somewhere', distance: closest?.d ?? null, items };
      (closest && closest.d <= NEAR_M ? near : atPlace).push(g);
    }
    near.sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));
    return { near, atPlace, anytime };
  }, [memories, places, pins, here]);

  const who = (id: string) => (id === session?.user.id ? 'You' : members.find((m) => m.user_id === id)?.display_name ?? 'Partner');

  async function complete(m: Memory) {
    setMemories((cur) => cur.filter((x) => x.id !== m.id));
    try {
      await markDone([m.id]);
    } finally {
      void load();
    }
  }

  const openList = (placeId: string, label: string) =>
    router.push({ pathname: '/list/[placeId]', params: { placeId, label } });

  const Row = ({ m, meta }: { m: Memory; meta?: boolean }) => (
    <View style={{ flexDirection: 'row', gap: 14, alignItems: 'flex-start' }}>
      <Check onPress={() => complete(m)} />
      <View style={{ flex: 1, gap: 8 }}>
        <Text style={{ color: t.ink, fontSize: 18, lineHeight: 24, fontFamily: font.medium }}>{m.body || '(photo)'}</Text>
        {(photos[m.id] ?? []).length > 0 && (
          <View style={styles.row}>
            {photos[m.id].map((u) => <Image key={u} source={{ uri: u }} style={{ width: 120, height: 78, borderRadius: 12 }} />)}
          </View>
        )}
        {meta && <Muted>{who(m.author_id)} · {new Date(m.created_at).toLocaleDateString()}</Muted>}
      </View>
    </View>
  );

  const groupCard = (g: Group) => {
    const shown = g.items.slice(0, 3);
    return (
      <Card key={g.placeId} gap={14}>
        <Pressable onPress={() => openList(g.placeId, g.label)} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <PlaceChip label={g.label} />
          {g.distance != null && <Text style={{ color: t.muted, fontSize: 13, fontFamily: font.semi }}>{km(g.distance)}</Text>}
        </Pressable>
        {shown.map((m) => <Row key={m.id} m={m} meta={g.items.length === 1} />)}
        <Pressable onPress={() => openList(g.placeId, g.label)}>
          <Text style={{ color: t.accentText, fontSize: 14, fontFamily: font.semi }}>
            {g.items.length > shown.length ? `+ ${g.items.length - shown.length} more · ` : ''}Open list
          </Text>
        </Pressable>
      </Card>
    );
  };

  const segmented = (
    <Glass interactive style={{ borderRadius: 24, padding: 3, flexDirection: 'row' }}>
      {(['List', 'Map'] as const).map((m) => (
        <Pressable
          key={m}
          accessibilityRole="button"
          accessibilityState={{ selected: mode === m }}
          onPress={() => setMode(m)}
          style={{ paddingHorizontal: 18, paddingVertical: 8, borderRadius: 20, backgroundColor: mode === m ? (t.dark ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.85)') : 'transparent' }}
        >
          <Text style={{ color: t.ink, fontSize: 14, fontFamily: font.semi }}>{m}</Text>
        </Pressable>
      ))}
    </Glass>
  );

  if (mode === 'Map') {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <TodoMap pins={pins} here={here} onOpen={(p) => openList(p.placeId, p.label)} />
        <View style={{ position: 'absolute', top: insets.top + 8, left: 0, right: 0, alignItems: 'center' }}>{segmented}</View>
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '38%', backgroundColor: t.sheet, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: 10, paddingHorizontal: 20, paddingBottom: BAR_SPACE - 70, opacity: 0.96 }}>
          <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: t.line, alignSelf: 'center', marginBottom: 12 }} />
          <Text style={{ color: t.ink, fontSize: 22, fontFamily: font.display, marginBottom: 6 }}>Near you</Text>
          <ScrollView>
            {near.length === 0 && <Muted>{here ? 'Nothing to do within 3 km.' : 'Allow location to see what is near you.'}</Muted>}
            {near.map((g) => (
              <Pressable key={g.placeId} onPress={() => openList(g.placeId, g.label)} style={{ paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth * 2, borderBottomColor: t.line }}>
                <Text style={{ color: t.ink, fontSize: 17, fontFamily: font.medium }}>{g.label} · {g.items.length} to-do{g.items.length === 1 ? '' : 's'}</Text>
                {g.distance != null && <Muted>{km(g.distance)}</Muted>}
              </Pressable>
            ))}
          </ScrollView>
        </View>
        <AddBar />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView
        contentContainerStyle={[styles.screen, { paddingTop: insets.top + 12, paddingBottom: BAR_SPACE + 20 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
      >
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 4 }}>
          <Title>To-do</Title>
          {segmented}
        </View>
        {queued > 0 && <Muted>{queued} waiting to sync (offline)</Muted>}
        {memories.length === 0 && <Muted>Nothing to do. Add something below.</Muted>}
        {near.length > 0 && <SectionLabel>Near you</SectionLabel>}
        {near.map(groupCard)}
        {atPlace.length > 0 && <SectionLabel>At a place</SectionLabel>}
        {atPlace.map(groupCard)}
        {anytime.length > 0 && <SectionLabel>Anytime</SectionLabel>}
        {anytime.map((m) => (
          <Card key={m.id}>
            <Row m={m} meta />
          </Card>
        ))}
      </ScrollView>
      <AddBar />
    </View>
  );
}
