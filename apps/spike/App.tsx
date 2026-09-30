import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, SafeAreaView, ScrollView, Share, StyleSheet, Switch, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import {
  addPlace, clearEvents, deletePlace, listAllEventsAsc, listEvents, listPlaces, logEvent,
  updatePlaceRadius, LogEvent, Place,
} from './src/db';
import {
  getPermissionState, isBreadcrumbOn, PermissionState, requestPermissions, setBreadcrumbs, syncGeofences,
} from './src/tracking';
import { analyse, PlaceStats, toCsv } from './src/analysis';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const RADII = [100, 150, 250, 500];

export default function App() {
  const [perms, setPerms] = useState<PermissionState | null>(null);
  const [places, setPlaces] = useState<Place[]>([]);
  const [events, setEvents] = useState<LogEvent[]>([]);
  const [stats, setStats] = useState<PlaceStats[]>([]);
  const [breadcrumbs, setBreadcrumbsState] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setPerms(await getPermissionState());
    setPlaces(await listPlaces());
    setEvents(await listEvents(100));
    setStats(analyse(await listAllEventsAsc()));
    setBreadcrumbsState(await isBreadcrumbOn());
  }, []);

  useEffect(() => {
    logEvent({ kind: 'app_open' }).then(refresh);
  }, [refresh]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      await refresh();
    }
  };

  const onAddHere = () =>
    run(async () => {
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      await addPlace({
        name: `Place ${places.length + 1}`,
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        radius: 150,
      });
      await syncGeofences();
    });

  const onCycleRadius = (p: Place) =>
    run(async () => {
      const next = RADII[(RADII.indexOf(p.radius) + 1) % RADII.length];
      await updatePlaceRadius(p.id, next);
      await syncGeofences();
    });

  const onDelete = (p: Place) =>
    run(async () => {
      await deletePlace(p.id);
      await syncGeofences();
    });

  const onExport = async () => {
    await Share.share({ message: toCsv(await listAllEventsAsc()), title: 'Home Memory spike log' });
  };

  const ready = perms?.foreground && perms.background && perms.notifications;

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.h1}>Location spike</Text>
        <Text style={styles.muted}>
          Add places where you actually go, then live normally. Tap "I'm arriving" / "I'm leaving" when you do, so
          detection latency and misses can be measured.
        </Text>

        <Section title="1. Permissions">
          <Text>Location while using: {perms?.foreground ? 'yes' : 'no'}</Text>
          <Text>Location always: {perms?.background ? 'yes' : 'no'}</Text>
          <Text>Notifications: {perms?.notifications ? 'yes' : 'no'}</Text>
          {!ready && <Btn label="Grant permissions" onPress={() => run(async () => void (await requestPermissions()))} />}
        </Section>

        <Section title="2. Places (max 20)">
          <Btn label="Add my current location as a place" onPress={onAddHere} disabled={busy || !ready} />
          {places.map((p) => (
            <View key={p.id} style={styles.place}>
              <Text style={styles.bold}>{p.name}</Text>
              <Text style={styles.muted}>
                {p.lat.toFixed(5)}, {p.lon.toFixed(5)}
              </Text>
              <View style={styles.row}>
                <Btn small label={`Radius ${p.radius} m`} onPress={() => onCycleRadius(p)} />
                <Btn small label="I'm arriving" onPress={() => run(() => logEvent({ kind: 'manual_arrive', place: p }))} />
                <Btn small label="I'm leaving" onPress={() => run(() => logEvent({ kind: 'manual_leave', place: p }))} />
                <Btn small danger label="Delete" onPress={() => onDelete(p)} />
              </View>
            </View>
          ))}
        </Section>

        <Section title="3. Breadcrumbs (optional, uses battery)">
          <View style={styles.row}>
            <Switch
              value={breadcrumbs}
              onValueChange={(on) => run(() => setBreadcrumbs(on))}
              disabled={!ready}
            />
            <Text style={styles.muted}>Log a low-power path as ground truth</Text>
          </View>
        </Section>

        <Section title="Results so far">
          {stats.length === 0 && <Text style={styles.muted}>No arrivals annotated yet.</Text>}
          {stats.map((s) => (
            <Text key={s.placeName}>
              {s.placeName}: {s.detected}/{s.manualArrivals} detected, {s.missed} missed
              {s.medianLatencySec != null ? `, median ${s.medianLatencySec}s` : ''}, {s.unannotatedEnters} unmatched
              enters
            </Text>
          ))}
        </Section>

        <Section title="Log (latest 100)">
          <View style={styles.row}>
            <Btn small label="Export CSV" onPress={onExport} />
            <Btn small danger label="Clear log" onPress={() => run(clearEvents)} />
          </View>
          {events.map((e) => (
            <Text key={e.id} style={styles.mono}>
              {new Date(e.ts).toLocaleString()} {e.kind}
              {e.place_name ? ` @ ${e.place_name}` : ''}
              {e.battery != null ? ` ${Math.round(e.battery * 100)}%` : ''}
              {e.detail && e.kind !== 'breadcrumb' ? ` (${e.detail})` : ''}
            </Text>
          ))}
        </Section>
      </ScrollView>
      <StatusBar style="auto" />
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.h2}>{title}</Text>
      {children}
    </View>
  );
}

function Btn({ label, onPress, disabled, small, danger }: {
  label: string; onPress: () => void; disabled?: boolean; small?: boolean; danger?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.btn, small && styles.btnSmall, danger && styles.btnDanger, disabled && styles.btnDisabled]}
    >
      <Text style={styles.btnText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
  scroll: { padding: 16, gap: 12 },
  h1: { fontSize: 26, fontWeight: '700' },
  h2: { fontSize: 17, fontWeight: '600' },
  section: { gap: 8, paddingTop: 8 },
  muted: { color: '#666' },
  bold: { fontWeight: '600' },
  mono: { fontFamily: 'Menlo', fontSize: 11 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  place: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 10, gap: 6 },
  btn: { backgroundColor: '#1d5fd1', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8 },
  btnSmall: { paddingVertical: 6, paddingHorizontal: 10 },
  btnDanger: { backgroundColor: '#b3261e' },
  btnDisabled: { opacity: 0.4 },
  btnText: { color: '#fff', fontWeight: '600' },
});
