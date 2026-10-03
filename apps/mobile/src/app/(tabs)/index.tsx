import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import * as Location from 'expo-location';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  acceptSuggestion, completeMemory, deleteMemory, dismissSuggestion, listMembers, listMemories, listPhotoUrls, listPlaces, purgeDismissed, reopenMemory,
  requestSuggestion, softDelete, statusFor, subscribeHousehold, updateMemory,
} from '@/lib/api';
import { AddBar } from '@/lib/AddBar';
import { Chip } from '@/lib/Chip';
import { Glass } from '@/lib/glass';
import { MapSheet, tabBarSpace, type Snap } from '@/lib/MapSheet';
import { useI18n } from '@/lib/i18n';
import { flush, pending, queuedToMemory } from '@/lib/outbox';
import { RecapCard } from '@/lib/RecapCard';
import { ensureNotifyPermission, mapPins, refreshRegions, scheduleDueReminders, type Pin } from '@/lib/reminders';
import { readJson, writeJson } from '@/lib/store';
import { useSession } from '@/lib/session';
import { font, useTheme } from '@/lib/theme';
import { useToast } from '@/lib/Toast';
import { TodoMap } from '@/lib/TodoMap';
import { TodoRow } from '@/lib/TodoRow';
import { Tour, tourSeen } from '@/lib/Tour';
import { BAR_SPACE, Btn, Card, Icon, Muted, PlaceChip, SectionLabel, Title, styles } from '@/lib/ui';
import { distanceM } from '../../core/geo.ts';
import { placeLabel, recurringLabel } from '../../shared/lib/labels';
import { nextOccurrence } from '../../shared/lib/recurrence';
import { compareDue, dueBucket, dueLabel, formatDay, todayISO } from '../../shared/lib/when';
import type { Member, Memory, Place } from '@/lib/types';
import type { LatLon } from '../../core/types.ts';

const NEAR_M = 3000;
const km = (m: number) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);

type Group = { placeId: string; label: string; distance: number | null; items: Memory[] };

export default function Todo() {
  const th = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t, tn, locale } = useI18n();
  const toast = useToast();
  const { household, session } = useSession();
  const [mode, setMode] = useState<'list' | 'map'>('list');
  const [memories, setMemories] = useState<Memory[]>([]);
  const [places, setPlaces] = useState<Place[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [photos, setPhotos] = useState<Record<string, string[]>>({});
  const [pins, setPins] = useState<Pin[]>([]);
  const [here, setHere] = useState<LatLon | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [queued, setQueued] = useState(pending().length);
  const [loaded, setLoaded] = useState(false);
  const [tour, setTour] = useState(false);
  const [doneTicks, setDoneTicks] = useState(0);
  const [who, setWho] = useState<'all' | 'mine' | 'theirs'>('all');
  const [sheetSnap, setSheetSnap] = useState<Snap>('half');
  const [sheetH, setSheetH] = useState(300);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const uid = session?.user.id ?? '';

  const load = useCallback(async () => {
    if (!household) return;
    const waiting = pending().filter((p) => p.household_id === household.id).map((p) => queuedToMemory(p, uid));
    try {
      await flush();
      const [m, p, mem] = await Promise.all([listMemories(household.id, ['inbox', 'active']), listPlaces(household.id), listMembers(household.id)]);
      setMemories([...pending().filter((q) => q.household_id === household.id && !m.some((x) => x.id === q.id)).map((q) => queuedToMemory(q, uid)), ...m]);
      setPlaces(p);
      setMembers(mem);
      setPhotos(await listPhotoUrls(m.map((x) => x.id)));
      void scheduleDueReminders(m);
      await refreshRegions().catch(() => {});
    } catch {
      setMemories((cur) => [...waiting, ...cur.filter((x) => !x.pending)]); // offline: keep what we have, plus what was written on this phone
    }
    setLoaded(true);
    const mp = await mapPins().catch(() => ({ here: null, pins: [] as Pin[] }));
    setPins(mp.pins);
    setHere(mp.here);
    setQueued(pending().length);
  }, [household, uid]);

  useEffect(() => { void load(); }, [load]);
  useFocusEffect(useCallback(() => { void load(); }, [load])); // after the add screen closes
  useEffect(() => { if (household) void purgeDismissed(household.id).catch(() => {}); }, [household]);

  // Live: a to-do your partner adds shows up without pulling to refresh.
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    if (!household) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = subscribeHousehold(household.id, () => { clearTimeout(timer); timer = setTimeout(() => void loadRef.current(), 250); });
    return () => { clearTimeout(timer); off(); };
  }, [household]);

  // Ask for notifications once, on the first visit. iOS only lists an app under Settings, Notifications after it has asked.
  useEffect(() => {
    if (!loaded || readJson<boolean>('hm.askedNotify', false)) return;
    const id = setTimeout(() => { writeJson('hm.askedNotify', true); void ensureNotifyPermission(); }, 1200);
    return () => clearTimeout(id);
  }, [loaded]);

  // First visit with nothing set up: a short guided start.
  useEffect(() => {
    if (loaded && household && memories.length === 0 && places.length === 0 && !tourSeen(household.id)) setTour(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  // Ask for place suggestions for a few to-dos that have none yet (once per to-do; silent if not set up).
  const suggestOff = useRef(false);
  useEffect(() => {
    if (suggestOff.current) return;
    const todo = memories.filter((m) => !m.pending && !m.place_id && m.body && !m.suggested_at).slice(0, 3);
    if (todo.length === 0) return;
    let cancelled = false;
    (async () => {
      for (const m of todo) {
        const r = await requestSuggestion(m.id);
        if (r.unavailable) suggestOff.current = true;
        if (cancelled || r.unavailable) return;
        setMemories((cur) => cur.map((x) => (x.id === m.id ? { ...x, suggestion: r.suggestion, suggested_at: new Date().toISOString() } : x)));
      }
    })();
    return () => { cancelled = true; };
  }, [memories]);

  const labelOf = useCallback((p: Place) => placeLabel(p, t), [t]);
  const placeName = (id: string | null) => { const p = places.find((x) => x.id === id); return p ? labelOf(p) : undefined; };

  // "For me" / "For Kari" keep what is for that person and what is for anyone.
  const partner = members.find((m) => m.user_id !== uid) ?? null;
  const visible = useMemo(
    () => (who === 'all' || !partner ? memories : memories.filter((m) => !m.assignee_id || m.assignee_id === (who === 'mine' ? uid : partner.user_id))),
    [memories, who, partner, uid],
  );

  const { today, upcoming, near, atPlace, anytime } = useMemo(() => {
    const pinFirst = (a: Memory, b: Memory) => Number(!!b.pinned) - Number(!!a.pinned);
    const today = visible.filter((m) => dueBucket(m) === 'today').sort((a, b) => pinFirst(a, b) || compareDue(a, b));
    const upcoming = visible.filter((m) => dueBucket(m) === 'upcoming').sort((a, b) => pinFirst(a, b) || compareDue(a, b));
    const undated = visible.filter((m) => dueBucket(m) === 'none').sort(pinFirst);
    const byPlace = new Map<string, Memory[]>();
    const anytime: Memory[] = [];
    for (const m of undated) {
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
      const g: Group = { placeId, label: closest?.p.label ?? (place ? labelOf(place) : t('todo.somewhere')), distance: closest?.d ?? null, items };
      (closest && closest.d <= NEAR_M ? near : atPlace).push(g);
    }
    near.sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));
    return { today, upcoming, near, atPlace, anytime };
  }, [visible, places, pins, here, labelOf, t]);

  const nameOf = (id: string) => members.find((m) => m.user_id === id)?.display_name ?? null;
  const ago = (iso: string) => {
    const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
    if (mins < 1) return t('time.now');
    if (mins < 60) return t('time.min', { n: mins });
    const hours = Math.round(mins / 60);
    return hours < 24 ? t('time.hour', { n: hours }) : new Date(iso).toLocaleDateString(locale);
  };
  const byline = (m: Memory) => (m.author_id === uid ? undefined : `${nameOf(m.author_id) ?? t('common.partner')} · ${ago(m.created_at)}`);

  async function complete(m: Memory) {
    if (m.pending) return;
    setMemories((cur) => cur.filter((x) => x.id !== m.id));
    setDoneTicks((n) => n + 1);
    try {
      const next = await completeMemory(m.id);
      const text = next && m.due_on && m.repeat_rule ? t('toast.doneRepeat', { date: formatDay(nextOccurrence(m.due_on, m.repeat_rule, todayISO()), locale) }) : t('toast.done');
      toast({ text, undo: () => void (async () => { await reopenMemory(m.id, m).catch(() => {}); if (next) await deleteMemory(next).catch(() => {}); await load(); })() });
    } finally {
      void load();
    }
  }

  async function remove(m: Memory) {
    setMemories((cur) => cur.filter((x) => x.id !== m.id));
    try {
      await softDelete(m.id);
      toast({ text: t('toast.deleted'), undo: () => void (async () => { await updateMemory(m.id, { status: statusFor(m) }).catch(() => {}); await load(); })() });
    } finally {
      void load();
    }
  }

  const openList = (placeId: string, label: string) => router.push({ pathname: '/list/[placeId]', params: { placeId, label } });

  const row = (m: Memory, o: { place?: boolean; meta?: boolean } = {}) => {
    const due = dueLabel(m, t, locale);
    return (
      <TodoRow key={m.id} m={m} photos={photos[m.id]} due={due || undefined} dueLate={!!m.due_on && m.due_on < todayISO()}
        place={o.place ? placeName(m.place_id) : undefined} forName={members.length > 1 && m.assignee_id ? (m.assignee_id === uid ? t('row.forYou') : t('row.for', { name: nameOf(m.assignee_id) ?? t('common.partner') })) : undefined} byline={o.meta === false ? undefined : byline(m)}
        author={members.length > 1 ? { id: m.author_id, name: nameOf(m.author_id) } : null}
        onToggle={() => void complete(m)} onEdit={() => router.push({ pathname: '/add', params: { id: m.id } })} onDelete={() => void remove(m)}>
        {m.suggestion && (
          <View style={{ gap: 8, borderRadius: 16, borderWidth: 1, borderStyle: 'dashed', borderColor: th.line, padding: 12, backgroundColor: th.tint }}>
            <PlaceChip label={m.suggestion.kind === 'recurring' ? t('suggest.recurring', { label: m.suggestion.recurring ? recurringLabel(m.suggestion.recurring, t) : m.suggestion.label }) : m.suggestion.label} icon={m.suggestion.kind === 'recurring' ? 'arrow.triangle.2.circlepath' : 'mappin'} />
            {m.suggestion.reason ? <Muted>{m.suggestion.reason}</Muted> : null}
            <View style={styles.row}>
              <Btn small primary label={m.suggestion.kind === 'recurring' ? t('suggest.makeRecurring') : t('suggest.add')} onPress={async () => { if (household) { await acceptSuggestion(m.id, household.id, m.suggestion!).catch(() => {}); void load(); } }} />
              <Btn small label={t('suggest.no')} onPress={async () => { await dismissSuggestion(m.id).catch(() => {}); void load(); }} />
            </View>
          </View>
        )}
      </TodoRow>
    );
  };

  const section = (title: string, items: Memory[]) => items.length === 0 ? null : (
    <View style={{ gap: 6 }} key={title}>
      <SectionLabel>{title}</SectionLabel>
      <View style={{ backgroundColor: th.card, borderRadius: 20, paddingHorizontal: 16, overflow: 'hidden' }}>{items.map((m) => row(m, { place: true }))}</View>
    </View>
  );

  const groupCard = (g: Group) => {
    const shown = g.items.slice(0, 3);
    return (
      <Card key={g.placeId} gap={2}>
        <Pressable onPress={() => openList(g.placeId, g.label)} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 4 }}>
          <PlaceChip label={g.label} />
          {g.distance != null && <Text style={{ color: th.muted, fontSize: 13, fontFamily: font.semi }}>{km(g.distance)}</Text>}
        </Pressable>
        {shown.map((m) => row(m, { meta: g.items.length === 1 }))}
        <Pressable onPress={() => openList(g.placeId, g.label)} style={{ paddingTop: 6 }}>
          <Text style={{ color: th.accentText, fontSize: 14, fontFamily: font.semi }}>
            {g.items.length > shown.length ? `${t('todo.moreAt', { n: g.items.length - shown.length })}` : t('todo.openList')}
          </Text>
        </Pressable>
      </Card>
    );
  };

  // Every place on the map as a card: the ones with to-dos first, then the nearest.
  const entries = useMemo(() => pins.map((p) => ({
    pin: p, distance: here ? distanceM(here, { lat: p.lat, lon: p.lon }) : null,
  })).sort((a, b) => (b.pin.count > 0 ? 1 : 0) - (a.pin.count > 0 ? 1 : 0) || (a.distance ?? 1e12) - (b.distance ?? 1e12) || a.pin.label.localeCompare(b.pin.label, locale)), [pins, here, locale]);
  const withTodos = entries.filter((e) => e.pin.count > 0);
  const without = entries.filter((e) => e.pin.count === 0);

  const selectPin = (p: Pin) => { setSelectedKey(p.key); setSheetSnap((s) => (s === 'peek' ? 'half' : s)); };

  async function locate() {
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.granted) await load();
    } catch { /* the prompt can fail on a simulator */ }
  }

  const card = ({ pin, distance }: { pin: Pin; distance: number | null }) => (
    <Pressable key={pin.key} accessibilityRole="button" onPress={() => selectPin(pin)}
      style={{ borderRadius: 18, borderWidth: selectedKey === pin.key ? 2 : 1, borderColor: selectedKey === pin.key ? th.accent : th.line, backgroundColor: th.card, padding: 14, gap: 10 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: th.ink, fontSize: 17, fontFamily: font.semi }}>{pin.label}</Text>
          {distance != null && <Muted>{t('map.away', { d: km(distance) })}</Muted>}
        </View>
        <View style={{ borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10, backgroundColor: pin.count ? th.tint : 'transparent', borderWidth: pin.count ? 0 : 1, borderColor: th.line }}>
          <Text style={{ color: pin.count ? th.tintInk : th.muted, fontSize: 13, fontFamily: font.semi }}>{pin.count ? tn('map.todos', pin.count) : t('map.noTodos')}</Text>
        </View>
      </View>
      <View style={styles.row}>
        <Btn small label={t('todo.openList')} onPress={() => openList(pin.placeId, pin.label)} />
        <Btn small label={t('where.directions')} onPress={() => void Linking.openURL(`https://maps.apple.com/?dirflg=d&daddr=${pin.lat.toFixed(6)},${pin.lon.toFixed(6)}`)} />
      </View>
    </Pressable>
  );

  const segmented = (
    <Glass interactive style={{ borderRadius: 24, padding: 3, flexDirection: 'row' }}>
      {(['list', 'map'] as const).map((m) => (
        <Pressable key={m} accessibilityRole="button" accessibilityState={{ selected: mode === m }} onPress={() => setMode(m)}
          style={{ paddingHorizontal: 18, paddingVertical: 8, borderRadius: 20, backgroundColor: mode === m ? (th.dark ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.85)') : 'transparent' }}>
          <Text style={{ color: th.ink, fontSize: 14, fontFamily: font.semi }}>{t(`view.${m}` as 'view.list')}</Text>
        </Pressable>
      ))}
    </Glass>
  );

  if (mode === 'map') {
    return (
      <View style={{ flex: 1, backgroundColor: th.bg }}>
        <TodoMap pins={pins} here={here} selectedKey={selectedKey} bottomInset={sheetH} onOpen={selectPin} />
        <View pointerEvents="box-none" style={{ position: 'absolute', top: insets.top + 8, left: 16, right: 16, flexDirection: 'row', justifyContent: 'center', alignItems: 'center' }}>
          {segmented}
          <Pressable accessibilityRole="button" accessibilityLabel={t('route.open')} onPress={() => router.push('/route')} style={{ position: 'absolute', right: 0 }}>
            <Glass interactive style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' }}><Icon name="location.north" size={18} /></Glass>
          </Pressable>
        </View>
        {sheetSnap !== 'full' && (
          <Pressable accessibilityRole="button" accessibilityLabel={t('todo.addAria')} onPress={() => router.push('/add')}
            style={{ position: 'absolute', right: 16, bottom: sheetH + tabBarSpace(insets.bottom) + 14, width: 54, height: 54, borderRadius: 27, backgroundColor: th.accent, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } }}>
            <Icon name="plus" size={24} color="#FFFFFF" />
          </Pressable>
        )}
        <MapSheet snap={sheetSnap} onSnap={setSheetSnap} onHeight={setSheetH} title={here ? t('map.nearYou') : t('map.places')}>
          {!here && (
            <View style={{ gap: 8, alignItems: 'flex-start' }}>
              <Muted>{t('map.locationOff')}</Muted>
              <Btn small label={t('map.allowLocation')} onPress={() => void locate()} />
            </View>
          )}
          {places.length === 0 && <Muted>{t('map.empty')}</Muted>}
          {withTodos.map(card)}
          {without.length > 0 && <SectionLabel>{t('map.otherPlaces')}</SectionLabel>}
          {without.map(card)}
        </MapSheet>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: th.bg }}>
      <ScrollView
        contentContainerStyle={[styles.screen, { paddingTop: insets.top + 12, paddingBottom: BAR_SPACE + 20 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
      >
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 4 }}>
          <Title>{t('todo.title')}</Title>
          {segmented}
        </View>
        {queued > 0 && <Muted>{tn('sync.waiting', queued)}</Muted>}
        <View style={styles.row}>
          {partner && (['all', 'mine', 'theirs'] as const).map((id) => (
            <Chip key={id} on={who === id} onPress={() => setWho(id)}
              label={id === 'all' ? t('filter.all') : id === 'mine' ? t('filter.mine') : t('filter.theirs', { name: partner.display_name || t('common.partner') })} />
          ))}
          <Chip icon="location.north" label={t('route.open')} onPress={() => router.push('/route')} />
        </View>
        {household && <RecapCard household={household} members={members} refreshKey={doneTicks} />}
        {loaded && memories.length === 0 && (
          <View style={{ alignItems: 'center', gap: 6, paddingVertical: 36 }}>
            <Text style={{ color: th.ink, fontFamily: font.display, fontSize: 22 }}>{t('todo.empty.title')}</Text>
            <Muted>{t('todo.empty.body')}</Muted>
          </View>
        )}
        {section(t('todo.sec.today'), today)}
        {section(t('todo.sec.upcoming'), upcoming)}
        {near.length > 0 && <SectionLabel>{t('map.nearYou')}</SectionLabel>}
        {near.map(groupCard)}
        {atPlace.length > 0 && <SectionLabel>{t('todo.sec.place')}</SectionLabel>}
        {atPlace.map(groupCard)}
        {section(t('todo.sec.anytime'), anytime)}
      </ScrollView>
      <AddBar />
      {tour && household && <Tour householdId={household.id} onClose={() => setTour(false)} onChanged={() => void load()} />}
    </View>
  );
}
