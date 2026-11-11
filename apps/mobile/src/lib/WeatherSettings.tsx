import { useCallback, useEffect, useState } from 'react';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { ActionSheetIOS, Alert, Modal, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { deleteWeatherPlace, deleteWeatherRule, listMembers, saveWeatherPlace, saveWeatherRule } from './api';
import { uuid } from './id';
import { capture } from './outbox';
import { Chip } from './Chip';
import { useI18n } from './i18n';
import { ensureNotifyPermission, weatherState, type WeatherState } from './reminders';
import { PinPicker } from './PinPicker';
import { Select } from './Select';
import { readJson } from './store';
import { font, useTheme } from './theme';
import { Btn, Card, Field, Muted } from './ui';
import { searchPlaces, type Hit } from '../shared/lib/placeSearch';
import { SCENARIOS, SCENARIO_DEFAULT, isoOf, nextAlert, reasonText, ruleSummary, starterRule, thresholdOf, type DayForecast, type Frequency, type Lead, type RuleDraft, type WeatherPlace, type WeatherRule } from '../shared/lib/weather';

const TIMES = ['06:00', '07:00', '07:30', '08:00', '09:00', '12:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00'];
type Addr = { name: string; address: string; lat: number; lon: number };

function dayLine(d: DayForecast, locale: string): string {
  const date = new Date(+d.date.slice(0, 4), +d.date.slice(5, 7) - 1, +d.date.slice(8, 10)).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' });
  const parts = [`${Math.round(d.tMin)}–${Math.round(d.tMax)}°C`];
  if (d.rainMm >= 0.5) parts.push(`${Math.round(d.rainMm * 10) / 10} mm`);
  if (d.snowCm >= 0.5) parts.push(`${Math.round(d.snowCm * 10) / 10} cm`);
  if (d.windMs >= 8) parts.push(`${Math.round(d.windMs)} m/s`);
  return `${date} · ${parts.join(' · ')}`;
}

/** A search box for an address (and, on the phone, "use my current location"); picking gives name, address and coordinates. */
function AddressSheet({ title, askName, onClose, onSave }: { title: string; askName: boolean; onClose: () => void; onSave: (a: Addr, name: string) => Promise<void> }) {
  const th = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [locating, setLocating] = useState(false);
  const [picked, setPicked] = useState<Addr | null>(null);
  const [pinning, setPinning] = useState(false);
  const [name, setName] = useState('');

  useEffect(() => {
    const text = q.trim();
    setFailed(false);
    if (text.length < 3) { setHits([]); setBusy(false); return; }
    setBusy(true);
    const ctl = new AbortController();
    const id = setTimeout(() => {
      searchPlaces(text, { signal: ctl.signal }).then((r) => { setHits(r); setBusy(false); }).catch((e) => { if ((e as Error).name === 'AbortError') return; setHits([]); setFailed(true); setBusy(false); });
    }, 300);
    return () => { clearTimeout(id); ctl.abort(); };
  }, [q]);

  const choose = (a: Addr) => { if (askName) { setPicked(a); setName(a.name || ''); } else void onSave(a, ''); };

  async function useHere() {
    setLocating(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) { Alert.alert(t('weather.locationDenied')); return; }
      const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      let address = '';
      try { const [g] = await Location.reverseGeocodeAsync({ latitude: p.coords.latitude, longitude: p.coords.longitude }); address = [g?.street && `${g.street}${g.streetNumber ? ` ${g.streetNumber}` : ''}`, g?.postalCode, g?.city].filter(Boolean).join(', '); } catch { /* the coordinates are enough */ }
      choose({ name: '', address, lat: p.coords.latitude, lon: p.coords.longitude });
    } catch { Alert.alert(t('weather.locationDenied')); } finally { setLocating(false); }
  }

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: th.bg }}>
        <ScrollView automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: insets.bottom + 24 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text accessibilityRole="header" style={{ flex: 1, color: th.ink, fontFamily: font.display, fontSize: 26 }}>{title}</Text>
            <Btn small label={t('common.close')} onPress={onClose} />
          </View>
          {!picked ? (
            <>
              <Btn primary disabled={locating} label={locating ? t('weather.locating') : t('weather.useCurrent')} onPress={() => void useHere()} />
              <Btn label={t('pin.open')} onPress={() => setPinning(true)} />
              {pinning ? <PinPicker onClose={() => setPinning(false)} onPick={(h) => { setPinning(false); choose({ name: h.name, address: h.address, lat: h.lat, lon: h.lon }); }} /> : null}
              <Field value={q} autoFocus onChangeText={setQ} placeholder={t('weather.searchAddress')} accessibilityLabel={t('weather.searchAddress')} autoCorrect={false} />
              {busy ? <Muted>{t('weather.searching')}</Muted> : null}
              {failed ? <Text style={{ color: th.danger, fontFamily: font.body }}>{t('weather.searchFail')}</Text> : null}
              {!busy && !failed && q.trim().length >= 3 && hits.length === 0 ? <Muted>{t('weather.noHits')}</Muted> : null}
              {hits.map((h) => (
                <Pressable key={h.key} accessibilityRole="button" onPress={() => choose({ name: h.name, address: h.address, lat: h.lat, lon: h.lon })}
                  style={{ backgroundColor: th.card, borderRadius: 16, padding: 14, gap: 2, minHeight: 56, justifyContent: 'center' }}>
                  <Text style={{ color: th.ink, fontSize: 16, fontFamily: font.semi }}>{h.name || h.address}</Text>
                  {h.name && h.address ? <Muted>{h.address}</Muted> : null}
                </Pressable>
              ))}
            </>
          ) : (
            <>
              <Muted>{picked.address || picked.name}</Muted>
              <Text style={{ color: th.muted, fontFamily: font.semi, fontSize: 14 }}>{t('weather.placeName')}</Text>
              <Field value={name} maxLength={40} onChangeText={setName} autoFocus accessibilityLabel={t('weather.placeName')} />
              <Btn primary label={t('common.save')} onPress={() => { if (!name.trim()) return Alert.alert(t('weather.nameErr')); void onSave(picked, name.trim()); }} />
              <Btn label={t('common.cancel')} onPress={() => setPicked(null)} />
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

// Settings > Weather: Home (set once), other places (only if you add them), the rules, and a look at the forecast so you can see why a rule did or did not fire.
export function WeatherSettings({ householdId, onChanged }: { householdId: string; onChanged: () => void }) {
  const th = useTheme();
  const { t, locale } = useI18n();
  const [w, setW] = useState<WeatherState | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [needsUpgrade, setNeedsUpgrade] = useState(false);
  const [draft, setDraft] = useState<RuleDraft | null>(null);
  const [placeFor, setPlaceFor] = useState<'home' | 'other' | null>(null);
  const [members, setMembers] = useState<{ user_id: string; display_name: string | null }[]>([]);
  const me = readJson<string | null>('hm.userId', null);
  const today = isoOf(new Date());

  const load = useCallback(async () => {
    try { setW(await weatherState(householdId)); setErr(null); setNeedsUpgrade(false); listMembers(householdId).then(setMembers).catch(() => {}); }
    catch (e) { const m = e instanceof Error ? e.message : String(e); if (/weather_places|weather_rules|weather_done|schema cache|does not exist/i.test(m)) setNeedsUpgrade(true); else setErr(m); }
  }, [householdId]);
  useEffect(() => { void load(); }, [load]);

  const changed = async () => { await load(); onChanged(); };
  const run = async (fn: () => Promise<void>) => { try { setErr(null); await fn(); await changed(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } };
  const others = (w?.places ?? []).filter((p) => !p.is_home);
  const home = w?.home ?? null;
  const placeName = (r: WeatherRule) => (r.place_id ? w?.places.find((p) => p.id === r.place_id)?.name : undefined);
  const ownerName = (id: string) => (id === me ? t('weather.ownerMe') : members.find((m) => m.user_id === id)?.display_name ?? '?');
  const dateLabel = (iso: string) => new Date(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' });

  const addRule = () => {
    ActionSheetIOS.showActionSheetWithOptions({ title: t('weather.template'), options: [...SCENARIOS.map((s) => t(`weather.s.${s}` as 'weather.s.rain')), t('common.cancel')], cancelButtonIndex: SCENARIOS.length, userInterfaceStyle: th.dark ? 'dark' : 'light' }, (i) => { if (i < SCENARIOS.length) setDraft(starterRule(t, SCENARIOS[i])); });
  };
  const sendTest = async (r: WeatherRule) => {
    if (!(await ensureNotifyPermission())) return Alert.alert(t('set.notifDenied'));
    await Notifications.scheduleNotificationAsync({ content: { title: r.name, body: r.items.join(' · ') }, trigger: null });
    // The test also makes the checklist's to-dos (without using up the real alert's one go), so you can see what you will get.
    if (r.make_todos !== false) {
      const notes = `${r.name}: ${t('weather.test')}`;
      for (const item of r.items) await capture({ id: uuid(), household_id: householdId, body: item, place_id: null, capture_lat: null, capture_lon: null, due_on: today, notes, tags: ['weather'], photoUris: [] });
    }
    Alert.alert(r.make_todos !== false ? t('weather.testSentTodos') : t('weather.testSent'));
  };

  if (needsUpgrade) return <Card><Text style={{ color: th.danger, fontFamily: font.body, fontSize: 15 }}>{t('weather.noTable')}</Text></Card>;
  const homeForecast = home && w ? w.forecasts[home.id] ?? [] : [];

  return (
    <View style={{ gap: 12 }}>
      {err ? <Text style={{ color: th.danger, fontFamily: font.body }}>{err}</Text> : null}

      <Card>
        <Text accessibilityRole="header" style={{ color: th.ink, fontSize: 17, fontFamily: font.semi }}>{t('weather.homeTitle')}</Text>
        <Text style={{ color: th.ink, fontFamily: font.semi, fontSize: 16 }}>{t('weather.home')}</Text>
        <Muted>{home ? home.address || `${home.lat.toFixed(3)}, ${home.lon.toFixed(3)}` : t('weather.homeNone')}</Muted>
        <Btn primary={!home} label={home ? t('weather.homeChange') : t('weather.homeSetBtn')} onPress={() => setPlaceFor('home')} />
        {!home ? <Muted>{t('weather.homeHelp')}</Muted> : null}
        <Text style={{ color: th.ink, fontSize: 16, fontFamily: font.semi, marginTop: 6 }}>{t('weather.morePlaces')}</Text>
        {others.length === 0 ? <Muted>{t('weather.morePlacesHelp')}</Muted> : null}
        {others.map((p) => (
          <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ flex: 1, minHeight: 44, justifyContent: 'center' }}>
              <Text style={{ color: th.ink, fontFamily: font.semi, fontSize: 16 }}>{p.name}</Text>
              <Muted>{p.address || `${p.lat.toFixed(3)}, ${p.lon.toFixed(3)}`}</Muted>
            </View>
            <Btn small danger label={t('weather.removePlace')} onPress={() => Alert.alert(t('weather.removePlaceAsk'), undefined, [{ text: t('common.cancel'), style: 'cancel' }, { text: t('weather.removePlace'), style: 'destructive', onPress: () => void run(() => deleteWeatherPlace(p.id)) }])} />
          </View>
        ))}
        <Btn small label={t('weather.addPlace')} onPress={() => setPlaceFor('other')} />
      </Card>

      <Card>
        <Text accessibilityRole="header" style={{ color: th.ink, fontSize: 17, fontFamily: font.semi }}>{t('weather.rules')}</Text>
        <Muted>{t('weather.intro')}</Muted>
        {w && w.rules.length === 0 ? <Muted>{t('weather.empty')}</Muted> : null}
        {(w?.rules ?? []).map((r) => {
          const next = w ? nextAlert(w.alerts, r.id, today) : null;
          return (
            <View key={r.id} style={{ gap: 4 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Pressable accessibilityRole="button" accessibilityLabel={`${t('weather.edit')}: ${r.name}`} onPress={() => setDraft(r)} style={{ flex: 1, minHeight: 44, justifyContent: 'center', gap: 2 }}>
                  <Text style={{ color: th.ink, fontSize: 16, fontFamily: font.semi }}>{r.name}</Text>
                  <Muted>{ruleSummary(t, r)}{placeName(r) ? ` · ${placeName(r)}` : ''}{r.owner_id ? ` · ${t('weather.ownerChip', { name: ownerName(r.owner_id) })}` : ''}</Muted>
                </Pressable>
                <Switch value={r.enabled} accessibilityLabel={`${t('weather.enabled')}: ${r.name}`} onValueChange={() => void run(() => saveWeatherRule(householdId, { ...r, enabled: !r.enabled }))} />
              </View>
              {r.enabled && home ? <Muted>{next ? t('weather.next', { reason: reasonText(t, next, dateLabel(next.forDate)) }) : t('weather.nextNone')}</Muted> : null}
              {r.enabled && !home ? <Muted>{t('weather.noHomeRule')}</Muted> : null}
              <View style={{ flexDirection: 'row' }}><Btn small label={t('weather.test')} onPress={() => void sendTest(r)} /></View>
            </View>
          );
        })}
        <Btn primary label={t('weather.add')} onPress={addRule} />
      </Card>

      <Card>
        <Text accessibilityRole="header" style={{ color: th.ink, fontSize: 17, fontFamily: font.semi }}>{t('weather.forecastTitle', { place: home?.name ?? t('weather.home') })}</Text>
        {!home ? <Muted>{t('weather.forecastHome')}</Muted> : w?.forecastError ? <Text style={{ color: th.danger, fontFamily: font.body }}>{t('weather.forecastFail')} ({w.forecastError})</Text>
          : homeForecast.length === 0 ? <Muted>{t('weather.forecastNone')}</Muted>
          : homeForecast.filter((d) => d.date >= today).slice(0, 6).map((d) => <Text key={d.date} style={{ color: th.ink, fontFamily: font.body, fontSize: 14 }}>{dayLine(d, locale)}</Text>)}
      </Card>

      {placeFor ? (
        <AddressSheet title={placeFor === 'home' ? t('weather.homeSetBtn') : t('weather.addPlace')} askName={placeFor === 'other'} onClose={() => setPlaceFor(null)}
          onSave={(a, name) => run(async () => {
            if (placeFor === 'home') await saveWeatherPlace(householdId, { id: home?.id, name: home?.name ?? t('weather.home'), address: a.address || a.name || null, lat: a.lat, lon: a.lon, is_home: true });
            else await saveWeatherPlace(householdId, { name, address: a.address || a.name || null, lat: a.lat, lon: a.lon, is_home: false });
            setPlaceFor(null);
          })} />
      ) : null}
      {draft ? <RuleModal draft={draft} members={members} me={me} others={others} onClose={() => setDraft(null)}
        onSave={async (d) => { await saveWeatherRule(householdId, d); setDraft(null); await changed(); }}
        onDelete={draft.id ? () => Alert.alert(t('weather.deleteAsk'), undefined, [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('weather.delete'), style: 'destructive', onPress: async () => { try { await deleteWeatherRule(draft.id as string); setDraft(null); await changed(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } } },
        ]) : undefined} /> : null}
    </View>
  );
}

function RuleModal({ draft, members, me, others, onClose, onSave, onDelete }: { draft: RuleDraft; members: { user_id: string; display_name: string | null }[]; me: string | null; others: WeatherPlace[]; onClose: () => void; onSave: (d: RuleDraft) => Promise<void>; onDelete?: () => void }) {
  const th = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const [d, setD] = useState<RuleDraft>(draft);
  const [items, setItems] = useState(draft.items.join('\n'));
  const [thr, setThr] = useState(String(thresholdOf(draft) ?? ''));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = <K extends keyof RuleDraft>(k: K, v: RuleDraft[K]) => setD((cur) => ({ ...cur, [k]: v }));
  const label = (s: string) => <Text style={{ color: th.muted, fontFamily: font.semi, fontSize: 14, marginTop: 6 }}>{s}</Text>;

  async function save() {
    const list = items.split('\n').map((x) => x.trim()).filter(Boolean);
    if (!d.name.trim() || list.length === 0) { setErr(t('weather.items')); return; }
    const n = Number(thr.replace(',', '.'));
    setBusy(true);
    try { await onSave({ ...d, name: d.name.trim(), items: list, threshold: d.scenario === 'storm' || thr.trim() === '' || !Number.isFinite(n) ? null : n }); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(false); }
  }

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: th.bg }}>
        <ScrollView automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: insets.bottom + 24 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text accessibilityRole="header" style={{ color: th.ink, fontFamily: font.display, fontSize: 26 }}>{d.id ? t('weather.edit') : t('weather.new')}</Text>
            <Btn small label={t('common.close')} onPress={onClose} />
          </View>
          {err ? <Text style={{ color: th.danger, fontFamily: font.body }}>{err}</Text> : null}
          {label(t('weather.name'))}
          <Field value={d.name} maxLength={60} onChangeText={(v) => set('name', v)} accessibilityLabel={t('weather.name')} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
            {SCENARIOS.map((s) => <Chip key={s} label={t(`weather.s.${s}` as 'weather.s.rain')} on={d.scenario === s} onPress={() => { set('scenario', s); setThr(String(SCENARIO_DEFAULT[s].threshold ?? '')); }} />)}
          </View>
          {d.scenario !== 'storm' && <>{label(t(`weather.thr.${d.scenario}` as 'weather.thr.rain'))}<Field value={thr} keyboardType="numbers-and-punctuation" onChangeText={setThr} accessibilityLabel={t(`weather.thr.${d.scenario}` as 'weather.thr.rain')} /></>}
          {label(t('weather.items'))}
          <Field multiline value={items} onChangeText={setItems} accessibilityLabel={t('weather.items')} />
          {label(t('weather.lead'))}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {(['evening_before', 'same_morning', 'hours_before'] as Lead[]).map((l) => <Chip key={l} label={t(`weather.lead.${l}` as 'weather.lead.same_morning')} on={d.lead === l} onPress={() => set('lead', l)} />)}
          </View>
          {d.lead === 'hours_before'
            ? <><Select<number> label={t('weather.leadHours')} value={d.lead_hours} options={[1, 2, 3, 4, 6, 8, 12].map((n) => ({ value: n, label: String(n) }))} onChange={(n) => set('lead_hours', n)} /><Muted>{t('weather.leadHoursHelp')}</Muted></>
            : <Select<string> label={t('weather.at')} value={d.at_time} options={[...new Set([...TIMES, d.at_time])].sort().map((v) => ({ value: v, label: v }))} onChange={(v) => set('at_time', v)} />}
          {label(t('weather.freq'))}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {(['spell', 'every'] as Frequency[]).map((f) => <Chip key={f} label={t(`weather.freq.${f}` as 'weather.freq.spell')} on={d.frequency === f} onPress={() => set('frequency', f)} />)}
          </View>
          {d.frequency === 'spell' && <Select<number> label={t('weather.gap')} value={d.dry_gap} options={[1, 2, 3, 4, 5, 7].map((n) => ({ value: n, label: String(n) }))} onChange={(n) => set('dry_gap', n)} />}
          {label(t('weather.quiet'))}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {[1, 2, 3, 4, 5, 6, 0].map((wd) => <Chip key={wd} label={t(`weather.dow.${wd}` as 'weather.dow.0')} on={d.quiet_days.includes(wd)} onPress={() => set('quiet_days', d.quiet_days.includes(wd) ? d.quiet_days.filter((x) => x !== wd) : [...d.quiet_days, wd])} />)}
          </View>
          {others.length > 0 && <Select<string | null> label={t('weather.place')} value={d.place_id ?? null} options={[{ value: null, label: t('weather.placeHome') }, ...others.map((p) => ({ value: p.id as string | null, label: p.name }))]} onChange={(v) => set('place_id', v)} />}
          {members.length > 1 && <Select<string | null> label={t('weather.owner')} value={d.owner_id ?? null} options={[{ value: null, label: t('weather.owner.both') }, ...members.map((m) => ({ value: m.user_id as string | null, label: m.user_id === me ? t('weather.owner.me') : t('weather.owner.other', { name: m.display_name ?? '?' }) }))]} onChange={(v) => set('owner_id', v)} />}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 48, marginTop: 6 }}>
            <View style={{ flex: 1 }}><Text style={{ color: th.ink, fontFamily: font.semi, fontSize: 16 }}>{t('weather.makeTodos')}</Text><Muted>{t('weather.makeTodosHelp')}</Muted></View>
            <Switch value={d.make_todos !== false} accessibilityLabel={t('weather.makeTodos')} onValueChange={(v) => set('make_todos', v)} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48, marginTop: 6 }}>
            <Text style={{ flex: 1, color: th.ink, fontFamily: font.body, fontSize: 16 }}>{t('weather.followUp')}</Text>
            <Switch value={d.follow_up} accessibilityLabel={t('weather.followUp')} onValueChange={(v) => set('follow_up', v)} />
          </View>
          <Btn primary disabled={busy} label={t('weather.save')} onPress={() => void save()} />
          {onDelete ? <Btn danger label={t('weather.delete')} onPress={onDelete} /> : null}
        </ScrollView>
      </View>
    </Modal>
  );
}
