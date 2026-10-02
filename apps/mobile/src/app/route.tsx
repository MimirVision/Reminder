import { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { listMemories, listPlaces } from '@/lib/api';
import { Chip } from '@/lib/Chip';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { font, useTheme } from '@/lib/theme';
import { Btn, Card, Check, Field, Icon, Muted, SectionLabel, styles } from '@/lib/ui';
import { distanceM, fetchPois, type LatLon } from '../shared/lib/geo';
import { placeLabel } from '../shared/lib/labels';
import { appleRouteUrl, dwellMinutes, evaluateOrder, fmtClock, googleRouteUrl, planRoute, type Matrix, type Stop } from '../shared/lib/route';
import { driveLine, driveMatrix } from '../shared/lib/routing';
import { todayISO } from '../shared/lib/when';
import type { Memory, Place } from '@/lib/types';

type StopMeta = Stop & { placeId: string; name: string; point: LatLon; tasks: Memory[]; category: string | null };
type Calc = { metas: StopMeta[]; matrix: Matrix; start: LatLon; end: LatLon; estimated: boolean; startMin: number; weekday: number; skipped: string[] };

const HOME = /(home|hjem|huset|house)/i;
const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

// Plan the day's drive: tick the places, choose where to start and finish, and get the order that gets it all done soonest.
export default function RoutePlanner() {
  const th = useTheme();
  const router = useRouter();
  const { t, tn } = useI18n();
  const { household } = useSession();
  const [places, setPlaces] = useState<Place[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [here, setHere] = useState<LatLon | null>(null);
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [start, setStart] = useState('here');
  const [end, setEnd] = useState<string | null>(null);
  const [depart, setDepart] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [calc, setCalc] = useState<Calc | null>(null);
  const [dwell, setDwell] = useState<Record<string, number>>({});
  const [line, setLine] = useState<[number, number][] | null>(null);
  const mapRef = useRef<MapView>(null);

  useEffect(() => {
    if (!household) return;
    listPlaces(household.id).then(setPlaces).catch(() => {});
    listMemories(household.id, ['inbox', 'active']).then(setMemories).catch(() => {});
  }, [household]);

  async function locate(ask: boolean): Promise<LatLon | null> {
    try {
      let perm = await Location.getForegroundPermissionsAsync();
      if (!perm.granted && ask) perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) return null;
      const p = (await Location.getLastKnownPositionAsync()) ?? (await Location.getCurrentPositionAsync({}));
      const pt = { lat: p.coords.latitude, lon: p.coords.longitude };
      setHere(pt);
      return pt;
    } catch { return null; }
  }
  useEffect(() => { void locate(false); }, []);

  const open = useMemo(() => memories.filter((m) => m.status !== 'done' && m.place_id), [memories]);
  const candidates = useMemo(() => places.filter((p) => open.some((m) => m.place_id === p.id) && (p.kind === 'category' || (p.lat != null && p.lon != null))), [places, open]);
  const fixed = useMemo(() => places.filter((p) => p.kind === 'fixed' && p.lat != null && p.lon != null), [places]);
  const home = useMemo(() => fixed.find((p) => HOME.test(p.name)), [fixed]);
  const selected = picked ?? new Set(candidates.map((p) => p.id));
  const endId = end ?? home?.id ?? 'start';

  const flip = (id: string) => { const n = new Set(selected); if (n.has(id)) n.delete(id); else n.add(id); setPicked(n); };
  const pointOf = (id: string): LatLon | null => { const p = fixed.find((x) => x.id === id); return p ? { lat: p.lat as number, lon: p.lon as number } : null; };

  async function prepare() {
    setErr(null);
    const startPt = start === 'here' ? here ?? (await locate(true)) : pointOf(start);
    if (!startPt) { setErr(t('route.needLocation')); return; }
    const endPt = endId === 'start' ? startPt : pointOf(endId) ?? startPt;
    const chosen = candidates.filter((p) => selected.has(p.id));
    if (chosen.length === 0) { setErr(t('route.pickOne')); return; }
    setBusy(true);
    try {
      const today = todayISO();
      const metas: StopMeta[] = [];
      const skipped: string[] = [];
      for (const p of chosen) {
        const tasks = open.filter((m) => m.place_id === p.id);
        let point: LatLon | null = p.kind === 'fixed' ? { lat: p.lat as number, lon: p.lon as number } : null;
        let name = placeLabel(p, t);
        if (!point && p.category) {
          // "Any pharmacy": the one nearest the start.
          const pois = await fetchPois(p.category, startPt).catch(() => []);
          const near = pois.map((poi) => ({ poi, d: distanceM(startPt, poi) })).sort((a, b) => a.d - b.d)[0]?.poi;
          if (near) { point = { lat: near.lat, lon: near.lon }; name = `${name} · ${near.name}`; }
        }
        if (!point) { skipped.push(name); continue; }
        const times = tasks.filter((m) => m.due_on === today && m.due_time).map((m) => toMin(m.due_time as string));
        metas.push({ id: p.id, placeId: p.id, name, point, tasks, category: p.category, dwellMin: dwellMinutes(p.category, tasks.length), byMin: times.length ? Math.min(...times) : null });
      }
      if (metas.length === 0) { setErr(t('route.pickOne')); return; }
      const { matrix, estimated } = await driveMatrix([startPt, ...metas.map((m) => m.point), endPt]);
      const now = new Date();
      const okTime = /^\d{1,2}:\d{2}$/.test(depart.trim());
      setDwell({});
      setLine(null);
      setCalc({ metas, matrix, start: startPt, end: endPt, estimated, startMin: okTime ? toMin(depart.trim().padStart(5, '0')) : now.getHours() * 60 + now.getMinutes(), weekday: now.getDay(), skipped });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  const solved = useMemo(() => {
    if (!calc) return null;
    const stops: Stop[] = calc.metas.map((m) => ({ id: m.id, dwellMin: dwell[m.id] ?? m.dwellMin, byMin: m.byMin }));
    const plan = planRoute(calc.matrix, stops, calc.startMin, calc.weekday);
    const naive = evaluateOrder(stops.map((_, i) => i), calc.matrix, stops, calc.startMin, calc.weekday);
    return { plan, saved: Math.round(naive.endMin - plan.endMin) };
  }, [calc, dwell]);

  const ordered = calc && solved ? solved.plan.order.map((i) => calc.metas[i]) : [];
  const pts = useMemo(() => (calc ? [calc.start, ...ordered.map((m) => m.point), calc.end] : []), [calc, solved]); // eslint-disable-line react-hooks/exhaustive-deps

  // The road line is fetched once the order is known, to draw on the map.
  useEffect(() => {
    if (!calc || !solved) return;
    let live = true;
    void driveLine(pts).then((l) => { if (live) setLine(l); });
    return () => { live = false; };
  }, [calc, solved, pts]);

  const fitMap = () => mapRef.current?.fitToCoordinates(pts.map((p) => ({ latitude: p.lat, longitude: p.lon })), { edgePadding: { top: 40, left: 40, right: 40, bottom: 40 }, animated: false });
  useEffect(() => { if (calc && solved) fitMap(); }, [pts]); // eslint-disable-line react-hooks/exhaustive-deps

  const bump = (m: StopMeta, by: number) => setDwell((d) => ({ ...d, [m.id]: Math.max(0, Math.min(120, (d[m.id] ?? m.dwellMin) + by)) }));
  const title = (m: Memory) => (m.body || t('todo.photo')).split('\n')[0];

  return (
    <ScrollView style={{ backgroundColor: th.bg }} contentContainerStyle={[styles.screen, { paddingTop: 24, paddingBottom: 60 }]} keyboardShouldPersistTaps="handled">
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ color: th.ink, fontSize: 28, fontFamily: font.display }}>{calc ? t('route.result') : t('route.title')}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={() => router.back()} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: th.card, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="xmark" size={16} />
        </Pressable>
      </View>

      {!calc || !solved ? (
        candidates.length === 0 ? <Muted>{t('route.noPlaces')}</Muted> : (
          <>
            <Muted>{t('route.intro')}</Muted>
            <SectionLabel>{t('route.stops')}</SectionLabel>
            <Card gap={4}>
              {candidates.map((p) => {
                const tasks = open.filter((m) => m.place_id === p.id);
                return (
                  <Pressable key={p.id} accessibilityRole="checkbox" accessibilityState={{ checked: selected.has(p.id) }} onPress={() => flip(p.id)} style={{ flexDirection: 'row', gap: 12, paddingVertical: 8, alignItems: 'flex-start' }}>
                    <Check done={selected.has(p.id)} onPress={() => flip(p.id)} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={{ color: th.ink, fontSize: 17, fontFamily: font.semi }}>{placeLabel(p, t)} · {tn('map.todos', tasks.length)}</Text>
                      <Muted>{tasks.slice(0, 3).map(title).join(' · ')}</Muted>
                    </View>
                  </Pressable>
                );
              })}
            </Card>
            <SectionLabel>{t('route.start')}</SectionLabel>
            <View style={styles.row}>
              <Chip icon="location.fill" label={t('route.here')} on={start === 'here'} onPress={() => setStart('here')} />
              {fixed.map((p) => <Chip key={p.id} label={p.name} on={start === p.id} onPress={() => setStart(p.id)} />)}
            </View>
            {start === 'here' && !here && <Btn small label={t('route.allowLocation')} onPress={() => void locate(true)} />}
            <SectionLabel>{t('route.end')}</SectionLabel>
            <View style={styles.row}>
              <Chip label={t('route.sameStart')} on={endId === 'start'} onPress={() => setEnd('start')} />
              {fixed.map((p) => <Chip key={p.id} label={p.name} on={endId === p.id} onPress={() => setEnd(p.id)} />)}
            </View>
            <SectionLabel>{t('route.depart')}</SectionLabel>
            <View style={styles.row}>
              <Chip label={t('route.now')} on={depart === ''} onPress={() => setDepart('')} />
              <Field placeholder="HH:MM" value={depart} onChangeText={setDepart} keyboardType="numbers-and-punctuation" maxLength={5} style={{ minWidth: 110 }} />
            </View>
            {err && <Text style={{ color: th.danger, fontFamily: font.body }}>{err}</Text>}
            <Btn primary label={busy ? t('route.planning') : t('route.plan')} disabled={busy || selected.size === 0} onPress={() => void prepare()} />
          </>
        )
      ) : (
        <>
          <View style={{ gap: 4 }}>
            <Text style={{ color: th.ink, fontSize: 17, fontFamily: font.semi }}>{t('route.summary', { time: fmtClock(solved.plan.endMin) })}</Text>
            <Muted>{t('route.drive', { n: Math.round(solved.plan.driveMin) })} · {t('route.stopsTotal', { n: Math.round(solved.plan.stopMin) })}</Muted>
            {solved.saved >= 1 && ordered.length > 1 && <Muted>{t('route.saved', { n: solved.saved })}</Muted>}
            {calc.estimated && <Muted>{t('route.estimated')}</Muted>}
            {calc.skipped.map((n) => <Muted key={n}>{t('route.noShop', { place: n })}</Muted>)}
          </View>

          <View style={{ height: 220, borderRadius: 20, overflow: 'hidden' }}>
            <MapView
              style={StyleSheet.absoluteFill}
              userInterfaceStyle={th.dark ? 'dark' : 'light'}
              initialRegion={{ latitude: calc.start.lat, longitude: calc.start.lon, latitudeDelta: 0.1, longitudeDelta: 0.1 }}
              ref={mapRef}
              onMapReady={fitMap}
            >
              <Polyline coordinates={(line ?? pts.map((p) => [p.lon, p.lat] as [number, number])).map(([lon, lat]) => ({ latitude: lat, longitude: lon }))} strokeColor={th.accent} strokeWidth={5} />
              {ordered.map((m, i) => (
                <Marker key={m.id} coordinate={{ latitude: m.point.lat, longitude: m.point.lon }}>
                  <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: th.accent, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#FFFFFF' }}>
                    <Text style={{ color: '#FFFFFF', fontSize: 14, fontFamily: font.semi }}>{i + 1}</Text>
                  </View>
                </Marker>
              ))}
            </MapView>
          </View>

          <Card gap={4}>
            {ordered.map((m, i) => {
              const late = Math.round(solved.plan.late[i]);
              return (
                <View key={m.id} style={{ flexDirection: 'row', gap: 12, paddingVertical: 10, alignItems: 'flex-start' }}>
                  <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: th.accent, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ color: '#FFFFFF', fontSize: 14, fontFamily: font.semi }}>{i + 1}</Text>
                  </View>
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={{ color: th.ink, fontSize: 16, fontFamily: font.semi }}>{fmtClock(solved.plan.arriveMin[i])} · {m.name}</Text>
                    <Muted>{t('route.legTo', { n: Math.round(solved.plan.legMin[i]) })} · {t('route.mins', { n: dwell[m.id] ?? m.dwellMin })}</Muted>
                    <Text style={{ color: th.ink, fontSize: 15, fontFamily: font.body }}>{m.tasks.slice(0, 4).map(title).join(' · ')}</Text>
                    {m.byMin != null && <Text style={{ color: late > 0 ? th.danger : th.muted, fontSize: 14, fontFamily: font.semi }}>{late > 0 ? t('route.late', { time: fmtClock(solved.plan.arriveMin[i]), n: late }) : t('route.by', { time: fmtClock(m.byMin) })}</Text>}
                    <View style={styles.row}>
                      <Chip label="−" onPress={() => bump(m, -5)} />
                      <Chip label="+" onPress={() => bump(m, 5)} />
                    </View>
                  </View>
                </View>
              );
            })}
            <View style={{ flexDirection: 'row', gap: 12, paddingVertical: 10, alignItems: 'center' }}>
              <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: th.ink, alignItems: 'center', justifyContent: 'center' }}><Icon name="checkmark" size={14} color={th.card} /></View>
              <View>
                <Text style={{ color: th.ink, fontSize: 16, fontFamily: font.semi }}>{fmtClock(solved.plan.endMin)}</Text>
                <Muted>{t('route.legTo', { n: Math.round(solved.plan.legMin[solved.plan.legMin.length - 1]) })}</Muted>
              </View>
            </View>
          </Card>

          <SectionLabel>{t('route.openIn')}</SectionLabel>
          <View style={styles.row}>
            <Btn label={t('route.apple')} onPress={() => void Linking.openURL(appleRouteUrl(calc.start, ordered.map((m) => m.point), calc.end))} />
            <Btn label={t('route.google')} onPress={() => void Linking.openURL(googleRouteUrl(calc.start, ordered.map((m) => m.point), calc.end))} />
          </View>
          <Muted>{t('route.note')}</Muted>
          <Btn label={t('route.change')} onPress={() => setCalc(null)} />
        </>
      )}
    </ScrollView>
  );
}
