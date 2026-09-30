import { useCallback, useEffect, useState } from 'react';
import { Image, Pressable, SafeAreaView, ScrollView, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { listMemories, listPhotoUrls, markDone, reopenMemory } from '@/lib/api';
import { uuid } from '@/lib/id';
import { capture, pending } from '@/lib/outbox';
import { refreshRegions } from '@/lib/reminders';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';
import { Btn, Field, Muted, styles } from '@/lib/ui';
import type { Memory } from '@/lib/types';

// The list you see when you say "I'm here": everything you wanted from this place, tick things off as you go.
export default function StoreList() {
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
    // One item per line, so a pasted list becomes several items.
    const lines = draft.split('\n').map((l) => l.trim()).filter(Boolean);
    setDraft('');
    for (const body of lines) {
      await capture({ id: uuid(), household_id: household.id, body, place_id: placeId, capture_lat: null, capture_lon: null, photoUris: [] });
    }
    await load();
  }

  const open = items.filter((m) => m.status !== 'done');
  const done = items.filter((m) => m.status === 'done');

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <Stack.Screen options={{ headerShown: true, title: label ?? 'List', headerStyle: { backgroundColor: t.bg }, headerTintColor: t.fg }} />
      <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
        <Text style={{ color: t.fg, fontSize: 22, fontWeight: '700' }}>{label ?? 'Shopping list'}</Text>
        <Muted>{open.length === 0 ? 'Everything is ticked off.' : `${open.length} to get`}</Muted>

        {open.map((m) => <Row key={m.id} m={m} photos={photos[m.id]} onToggle={() => toggle(m)} />)}
        {queued.map((b, i) => (
          <View key={`q${i}`} style={rowStyle(t.line)}>
            <Text style={{ color: t.muted, flex: 1 }}>{b} (waiting to sync)</Text>
          </View>
        ))}

        <Field placeholder="Add items (one per line)" multiline value={draft} onChangeText={setDraft} />
        <Btn label="Add" onPress={add} disabled={!draft.trim()} />

        {done.length > 0 && <Text style={{ color: t.muted, marginTop: 8 }}>Got it</Text>}
        {done.map((m) => <Row key={m.id} m={m} photos={photos[m.id]} onToggle={() => toggle(m)} />)}

        <Btn primary label="Finished here" onPress={() => { void refreshRegions().catch(() => {}); router.back(); }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const rowStyle = (line: string) => ({ flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: line });

function Row({ m, photos, onToggle }: { m: Memory; photos?: string[]; onToggle: () => void }) {
  const t = useTheme();
  const isDone = m.status === 'done';
  return (
    <Pressable onPress={onToggle} style={rowStyle(t.line)}>
      <View style={{ width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: isDone ? t.accent : t.muted, backgroundColor: isDone ? t.accent : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
        {isDone && <Text style={{ color: '#fff', fontWeight: '700' }}>✓</Text>}
      </View>
      <View style={{ flex: 1, gap: 6 }}>
        <Text style={{ color: isDone ? t.muted : t.fg, fontSize: 18, textDecorationLine: isDone ? 'line-through' : 'none' }}>{m.body || '(photo)'}</Text>
        {(photos ?? []).length > 0 && (
          <View style={styles.row}>
            {photos!.map((u) => <Image key={u} source={{ uri: u }} style={{ width: 72, height: 72, borderRadius: 8 }} />)}
          </View>
        )}
      </View>
    </Pressable>
  );
}
