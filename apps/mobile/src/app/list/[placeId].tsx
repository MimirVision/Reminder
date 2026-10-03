import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { completeMemory, listFacts, listMembers, listMemories, listPhotoUrls, listPlaces, reopenMemory, subscribeHousehold } from '@/lib/api';
import { Avatar } from '@/lib/Avatar';
import { useI18n } from '@/lib/i18n';
import { dueLabel } from '../../shared/lib/when';
import { splitShoppingLine } from '../../shared/lib/quickAdd';
import { readJson, writeJson } from '@/lib/store';
import { factsForCategory } from '../../core/facts.ts';
import { uuid } from '@/lib/id';
import { capture, pending } from '@/lib/outbox';
import { refreshRegions } from '@/lib/reminders';
import { useSession } from '@/lib/session';
import { font, useTheme } from '@/lib/theme';
import { Btn, Check, Field, Icon, Muted, SectionLabel, styles } from '@/lib/ui';
import type { HouseFact, Member, Memory } from '@/lib/types';

// The list you see when you say "I'm here": everything to do at this place. Tick things off as you go.
export default function PlaceList() {
  const t = useTheme();
  const { t: tr, tn, locale } = useI18n();
  const router = useRouter();
  const { household } = useSession();
  const [members, setMembers] = useState<Member[]>([]);
  const { placeId, label } = useLocalSearchParams<{ placeId: string; label?: string }>();
  const [items, setItems] = useState<Memory[]>([]);
  const [photos, setPhotos] = useState<Record<string, string[]>>({});
  const [draft, setDraft] = useState('');
  const [queued, setQueued] = useState<string[]>([]);
  const [useful, setUseful] = useState<HouseFact[]>([]);
  const [shop, setShop] = useState(() => readJson<boolean>('hm.shopView', true));
  const setShopView = (v: boolean) => { setShop(v); writeJson('hm.shopView', v); };

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

  // Shopping together: when your partner ticks something off at the shop, it changes here too.
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    if (!household) return;
    listMembers(household.id).then(setMembers).catch(() => {});
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = subscribeHousehold(household.id, () => { clearTimeout(timer); timer = setTimeout(() => void loadRef.current(), 250); });
    return () => { clearTimeout(timer); off(); };
  }, [household]);
  const nameOf = (id: string | null | undefined) => (id ? members.find((x) => x.user_id === id)?.display_name ?? null : null);

  // Facts tagged for this kind of shop ("what bulb was it?") appear as "Useful here".
  useEffect(() => {
    if (!household) return;
    (async () => {
      const [facts, places] = await Promise.all([listFacts(household.id), listPlaces(household.id).catch(() => [])]);
      setUseful(factsForCategory(facts, places.find((p) => p.id === placeId)?.category ?? null) as HouseFact[]);
    })().catch(() => {});
  }, [household, placeId]);

  const toggle = async (m: Memory) => {
    setItems((cur) => cur.map((x) => (x.id === m.id ? { ...x, status: m.status === 'done' ? 'active' : 'done', done_at: m.status === 'done' ? null : new Date().toISOString() } : x)));
    try {
      if (m.status === 'done') await reopenMemory(m.id, m);
      else await completeMemory(m.id);
    } finally {
      void load();
    }
  };

  async function add() {
    if (!household || !draft.trim()) return;
    // "milk, eggs and bread" on one line becomes three items.
    const lines = draft.split('\n').map((l) => l.trim()).filter(Boolean).flatMap(splitShoppingLine);
    setDraft('');
    for (const body of lines) {
      await capture({ id: uuid(), household_id: household.id, body, place_id: placeId, capture_lat: null, capture_lon: null, photoUris: [] });
    }
    await load();
  }

  const open = items.filter((m) => m.status !== 'done');
  const done = items.filter((m) => m.status === 'done');
  const total = open.length + done.length;

  // Shopping view: big rows you tick with a thumb, and a bar that fills as you go.
  const big = (m: Memory) => {
    const isDone = m.status === 'done';
    const sub = [m.due_on ? dueLabel(m, tr, locale) : '', m.pinned ? tr('row.pinned') : ''].filter(Boolean).join(' · ');
    return (
      <View key={m.id} style={{ flexDirection: 'row', alignItems: 'center', borderRadius: 18, borderWidth: 1, borderColor: t.line, backgroundColor: t.card, marginBottom: 8, opacity: isDone ? 0.55 : 1 }}>
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: isDone }} onPress={() => void toggle(m)}
          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, paddingLeft: 14, paddingRight: 8, minHeight: 60 }}>
          <View style={{ width: 32, height: 32, borderRadius: 16, borderWidth: isDone ? 0 : 2, borderColor: t.control, backgroundColor: isDone ? t.ink : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
            {isDone && <Icon name="checkmark" size={18} color={t.card} />}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: t.ink, fontSize: 18, lineHeight: 24, fontFamily: font.semi, textDecorationLine: isDone ? 'line-through' : 'none' }}>{m.body || tr('todo.photo')}</Text>
            {sub ? <Muted>{sub}</Muted> : null}
          </View>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={tr('shop.edit', { title: (m.body || tr('todo.photo')).split('\n')[0] })} hitSlop={8}
          onPress={() => router.push({ pathname: '/add', params: { id: m.id } })} style={{ padding: 14 }}>
          <Icon name="chevron.right" size={14} color={t.muted} />
        </Pressable>
      </View>
    );
  };

  const row = (m: Memory) => (
    <View key={m.id} style={{ flexDirection: 'row', gap: 14, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: t.line, alignItems: 'flex-start' }}>
      <Check done={m.status === 'done'} onPress={() => toggle(m)} />
      <View style={{ flex: 1, gap: 8 }}>
        <Text style={{ color: m.status === 'done' ? t.muted : t.ink, fontSize: 18, lineHeight: 26, fontFamily: font.medium, textDecorationLine: m.status === 'done' ? 'line-through' : 'none' }}>
          {m.body || tr('todo.photo')}
        </Text>
        {(m.due_on || (m.status === 'done' && m.done_by)) && (
          <Muted>{[m.due_on ? dueLabel(m, tr, locale) : '', m.status === 'done' && m.done_by ? tr('row.doneBy', { name: nameOf(m.done_by) ?? tr('common.partner') }) : ''].filter(Boolean).join(' · ')}</Muted>
        )}
        {(photos[m.id] ?? []).length > 0 && (
          <View style={styles.row}>{photos[m.id].map((u) => <Image key={u} source={{ uri: u }} style={{ width: 88, height: 60, borderRadius: 10 }} />)}</View>
        )}
      </View>
      {members.length > 1 && <Avatar id={m.author_id} name={nameOf(m.author_id)} />}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: t.sheet }}>
      <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={{ padding: 22, paddingTop: 18, paddingBottom: 130 }} keyboardShouldPersistTaps="handled">
        <View style={{ alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: t.line, marginBottom: 14 }} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: t.ink, fontSize: 32, lineHeight: 36, fontFamily: font.display }}>{label || tr('todo.title')}</Text>
            <Muted>{open.length === 0 ? tr('list.allTicked') : tn('list.toGet', open.length)}</Muted>
          </View>
          <Pressable accessibilityLabel={tr('common.close')} accessibilityRole="button" onPress={() => router.back()} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="xmark" size={16} />
          </Pressable>
        </View>
        <View style={{ marginTop: 8 }}>
          {shop && total > 0 && (
            <View accessibilityRole="progressbar" accessibilityLabel={tr('shop.progress', { done: done.length, total })} style={{ height: 26, borderRadius: 13, backgroundColor: t.line, overflow: 'hidden', marginBottom: 10, justifyContent: 'center' }}>
              <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${(done.length / total) * 100}%`, backgroundColor: t.accent, borderRadius: 13 }} />
              <Text style={{ textAlign: 'center', color: t.ink, fontSize: 13, fontFamily: font.semi }}>{tr('shop.progress', { done: done.length, total })}</Text>
            </View>
          )}
          {open.map(shop ? big : row)}
          {queued.map((b, i) => (
            <View key={`q${i}`} style={{ paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: t.line }}>
              <Text style={{ color: t.muted, fontSize: 17, fontFamily: font.body }}>{b} ({tr('row.pending')})</Text>
            </View>
          ))}
        </View>
        {useful.length > 0 && (
          <View style={{ marginTop: 14, gap: 8, borderRadius: 18, padding: 14, backgroundColor: t.tint }}>
            <Text style={{ color: t.tintInk, fontSize: 13, letterSpacing: 0.8, textTransform: 'uppercase', fontFamily: font.semi }}>{tr('list.useful')}</Text>
            {useful.map((f) => (
              <View key={f.id}>
                <Text style={{ color: t.ink, fontSize: 16, fontFamily: font.semi }}>{f.title}</Text>
                {f.value ? <Text style={{ color: t.ink, fontSize: 15, fontFamily: font.body }}>{f.value}</Text> : null}
              </View>
            ))}
          </View>
        )}
        <View style={{ gap: 10, marginTop: 16 }}>
          <Field placeholder={tr('list.addPlaceholder')} multiline value={draft} onChangeText={setDraft} style={{ minHeight: 56 }} />
          <Btn label={tr('common.add')} onPress={add} disabled={!draft.trim()} />
        </View>
        {done.length > 0 && <View style={{ marginTop: 12 }}><SectionLabel>{tr('list.gotIt')}</SectionLabel></View>}
        {done.map(shop ? big : row)}
        <Pressable accessibilityRole="button" onPress={() => setShopView(!shop)} style={{ alignSelf: 'center', paddingVertical: 14 }}>
          <Text style={{ color: t.accentText, fontFamily: font.semi, fontSize: 14 }}>{shop ? tr('shop.detail') : tr('shop.mode')}</Text>
        </Pressable>
      </ScrollView>
      <View pointerEvents="box-none" style={{ position: 'absolute', left: 16, right: 16, bottom: 28 }}>
        <Btn primary label={tr('list.doneHere')} onPress={() => { void refreshRegions().catch(() => {}); router.back(); }} />
      </View>
    </View>
  );
}
