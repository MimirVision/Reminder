import { useCallback, useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { listMemories, listPhotoUrls, markDone, reopenMemory } from '@/lib/api';
import { uuid } from '@/lib/id';
import { capture, pending } from '@/lib/outbox';
import { refreshRegions } from '@/lib/reminders';
import { useSession } from '@/lib/session';
import { font, useTheme } from '@/lib/theme';
import { Btn, Check, Field, Icon, Muted, SectionLabel, styles } from '@/lib/ui';
import type { Memory } from '@/lib/types';

// The list you see when you say "I'm here": everything to do at this place. Tick things off as you go.
export default function PlaceList() {
  const t = useTheme();
  const router = useRouter();
  const { household } = useSession();
  const { placeId, label } = useLocalSearchParams<{ placeId: string; label?: string }>();
  const [items, setItems] = useState<Memory[]>([]);
  const [photos, setPhotos] = useState<Record<string, string[]>>({});
  const [draft, setDraft] = useState('');
  const [queued, setQueued] = useState<string[]>([]);

  const load = useCallback(async () => {
    if (!household) return;
    try {
      const all = await listMemories(household.id, ['active', 'done']);
      const cutoff = Date.now() - 6 * 3600_000;
      const mine = all
        .filter((m) => m.place_id === placeId && (m.status === 'active' || (m.done_at && new Date(m.done_at).getTime() > cutoff)))
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
      setItems(mine);
      setPhotos(await listPhotoUrls(mine.map((m) => m.id)));
    } catch {
      // offline: show what is queued
    }
    setQueued(pending().filter((p) => p.place_id === placeId).map((p) => p.body));
  }, [household, placeId]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (m: Memory) => {
    setItems((cur) => cur.map((x) => (x.id === m.id ? { ...x, status: m.status === 'done' ? 'active' : 'done', done_at: m.status === 'done' ? null : new Date().toISOString() } : x)));
    try {
      if (m.status === 'done') await reopenMemory(m.id);
      else await markDone([m.id]);
    } finally {
      void load();
    }
  };

  async function add() {
    if (!household || !draft.trim()) return;
    const lines = draft.split('\n').map((l) => l.trim()).filter(Boolean);
    setDraft('');
    for (const body of lines) {
      await capture({ id: uuid(), household_id: household.id, body, place_id: placeId, capture_lat: null, capture_lon: null, photoUris: [] });
    }
    await load();
  }

  const open = items.filter((m) => m.status !== 'done');
  const done = items.filter((m) => m.status === 'done');

  const row = (m: Memory) => (
    <View key={m.id} style={{ flexDirection: 'row', gap: 14, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: t.line, alignItems: 'flex-start' }}>
      <Check done={m.status === 'done'} onPress={() => toggle(m)} />
      <View style={{ flex: 1, gap: 8 }}>
        <Text style={{ color: m.status === 'done' ? t.muted : t.ink, fontSize: 18, lineHeight: 26, fontFamily: font.medium, textDecorationLine: m.status === 'done' ? 'line-through' : 'none' }}>
          {m.body || '(photo)'}
        </Text>
        {(photos[m.id] ?? []).length > 0 && (
          <View style={styles.row}>{photos[m.id].map((u) => <Image key={u} source={{ uri: u }} style={{ width: 88, height: 60, borderRadius: 10 }} />)}</View>
        )}
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: t.sheet }}>
      <ScrollView contentContainerStyle={{ padding: 22, paddingTop: 18, paddingBottom: 130 }} keyboardShouldPersistTaps="handled">
        <View style={{ alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: t.line, marginBottom: 14 }} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: t.ink, fontSize: 32, lineHeight: 36, fontFamily: font.display }}>{label || 'List'}</Text>
            <Muted>{open.length === 0 ? 'Everything is ticked off.' : `${open.length} to get`}</Muted>
          </View>
          <Pressable accessibilityLabel="Close" accessibilityRole="button" onPress={() => router.back()} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="xmark" size={16} />
          </Pressable>
        </View>
        <View style={{ marginTop: 8 }}>
          {open.map(row)}
          {queued.map((b, i) => (
            <View key={`q${i}`} style={{ paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: t.line }}>
              <Text style={{ color: t.muted, fontSize: 17, fontFamily: font.body }}>{b} (waiting to sync)</Text>
            </View>
          ))}
        </View>
        <View style={{ gap: 10, marginTop: 16 }}>
          <Field placeholder="Add to this list (one per line)" multiline value={draft} onChangeText={setDraft} style={{ minHeight: 56 }} />
          <Btn label="Add" onPress={add} disabled={!draft.trim()} />
        </View>
        {done.length > 0 && <View style={{ marginTop: 12 }}><SectionLabel>Got it</SectionLabel></View>}
        {done.map(row)}
      </ScrollView>
      <View pointerEvents="box-none" style={{ position: 'absolute', left: 16, right: 16, bottom: 28 }}>
        <Btn primary label="Done here" onPress={() => { void refreshRegions().catch(() => {}); router.back(); }} />
      </View>
    </View>
  );
}
