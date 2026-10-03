import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { listMemories, listPlaces } from './api';
import { readJson, writeJson } from './store';
import { distanceM } from '../core/geo.ts';
import { pickDueReminders, type DueMemory } from '../core/dueReminders.ts';
import { currentLang, tNow, tnNow } from './i18n';
import { leadShort } from '../shared/lib/details';
import { planBriefings } from '../shared/lib/briefing';
import { pickLeaveReminders, travelMinutes, type LeaveCandidate } from '../shared/lib/leave';
import { driveMatrix } from '../shared/lib/routing';
import { needsRefresh, overpassQuery, parseOverpass, type PoiCache } from '../core/pois.ts';
import { MAX_REGIONS, selectRegions } from '../core/regions.ts';
import type { LatLon, MemoryRow, PlaceRow, Region } from '../core/types.ts';

export const GEOFENCE_TASK = 'home-memory-geofence';
export const REFRESH_ID = '__refresh__';
const REFRESH_RADIUS_M = 1500;
const POI_SEARCH_RADIUS_M = 8000;
export const NOTIFICATION_CATEGORY = 'memory';

const K = {
  household: 'hm.householdId',
  user: 'hm.userId',
  snapshot: 'hm.snapshot',
  pois: 'hm.pois',
  regions: 'hm.regions',
  surface: 'hm.surfaceState',
};

export type Snapshot = { places: PlaceRow[]; memories: MemoryRow[] };

export const rememberHousehold = (id: string) => writeJson(K.household, id);
export const rememberUser = (id: string | null) => writeJson(K.user, id);
/** A to-do given to your partner should not remind you: keep what is for you or for anyone. */
const mine = <T extends { assignee_id?: string | null }>(list: T[]): T[] => {
  const me = readJson<string | null>(K.user, null);
  return me ? list.filter((m) => !m.assignee_id || m.assignee_id === me) : list;
};
export const readSnapshot = () => readJson<Snapshot>(K.snapshot, { places: [], memories: [] });
export const readRegionLabels = () => readJson<Record<string, string>>(K.regions, {});
export { K as storeKeys };

export async function setupNotificationCategories() {
  await Notifications.setNotificationCategoryAsync(NOTIFICATION_CATEGORY, [
    { identifier: 'here', buttonTitle: tNow('here.imHere'), options: { opensAppToForeground: true } },
    { identifier: 'done', buttonTitle: tNow('common.done'), options: { opensAppToForeground: true } },
    { identifier: 'notnow', buttonTitle: tNow('common.notNow'), options: { opensAppToForeground: false } },
  ]);
}

export async function hasBackgroundAccess(): Promise<boolean> {
  try {
    const [bg, n] = await Promise.all([Location.getBackgroundPermissionsAsync(), Notifications.getPermissionsAsync()]);
    return bg.granted && n.granted;
  } catch {
    return false; // e.g. Expo Go, which has no "Always" location entitlement
  }
}

export async function enableReminders(): Promise<boolean> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (!fg.granted) return false;
  const bg = await Location.requestBackgroundPermissionsAsync();
  const n = await Notifications.requestPermissionsAsync();
  if (!bg.granted || !n.granted) return false;
  await setupNotificationCategories();
  await refreshRegions();
  return true;
}

async function currentPosition(): Promise<LatLon | null> {
  try {
    const last = await Location.getLastKnownPositionAsync();
    if (last) return { lat: last.coords.latitude, lon: last.coords.longitude };
    const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return { lat: p.coords.latitude, lon: p.coords.longitude };
  } catch {
    return null;
  }
}

async function fetchPois(category: string, center: LatLon) {
  const q = overpassQuery(category, center, POI_SEARCH_RADIUS_M);
  if (!q) return null;
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(q)}`,
  });
  if (!res.ok) throw new Error(`overpass ${res.status}`);
  return parseOverpass(category, await res.json());
}

// Re-picks which (max 20) places iOS should watch. Runs on app open, after edits, and when the phone
// leaves the "refresh" region around its last known position.
export async function refreshRegions(): Promise<{ watching: number }> {
  const householdId = readJson<string | null>(K.household, null);
  if (!householdId) return { watching: 0 };

  const [places, all] = await Promise.all([listPlaces(householdId), listMemories(householdId, ['active'])]);
  const memories = mine(all);
  writeJson(K.snapshot, { places, memories } satisfies Snapshot);

  const here = await currentPosition();
  let cache = readJson<PoiCache | null>(K.pois, null);

  const categories = [...new Set(places.filter((p) => p.kind === 'category' && p.category).map((p) => p.category as string))];
  if (here && categories.length > 0 && needsRefresh(cache, here, Date.now())) {
    const byCategory: PoiCache['byCategory'] = {};
    for (const c of categories) {
      try {
        const pois = await fetchPois(c, here);
        if (pois) byCategory[c] = pois;
      } catch {
        byCategory[c] = cache?.byCategory[c] ?? [];
      }
    }
    cache = { center: here, fetchedAt: Date.now(), byCategory };
    writeJson(K.pois, cache);
  }

  const regions: Region[] = selectRegions({
    places, memories, pois: cache?.byCategory ?? {}, here, max: MAX_REGIONS - 1,
  });
  writeJson(K.regions, Object.fromEntries(regions.map((r) => [r.identifier, r.label])));

  // The list snapshot and shop lookups above also feed the in-app "Are you here?" bar, which only needs
  // foreground location. Registering background geofences needs "Always" + notifications.
  if (!(await hasBackgroundAccess())) return { watching: 0 };

  const watched = regions.map((r) => ({
    identifier: r.identifier,
    latitude: r.latitude,
    longitude: r.longitude,
    radius: r.radius,
    notifyOnEnter: true,
    notifyOnExit: true,
  }));
  if (here) {
    watched.push({
      identifier: REFRESH_ID,
      latitude: here.lat,
      longitude: here.lon,
      radius: REFRESH_RADIUS_M,
      notifyOnEnter: false,
      notifyOnExit: true,
    });
  }
  if (watched.length === 0) {
    if (await Location.hasStartedGeofencingAsync(GEOFENCE_TASK)) await Location.stopGeofencingAsync(GEOFENCE_TASK);
  } else {
    await Location.startGeofencingAsync(GEOFENCE_TASK, watched);
  }
  return { watching: regions.length };
}

// "Heading out" pull view: active memories whose place is within reach of where you are now.
export async function nearbyMemories(withinM = 3000): Promise<{ label: string; distanceM: number; memories: MemoryRow[] }[]> {
  const here = await currentPosition();
  if (!here) return [];
  const { places, memories } = readSnapshot();
  const pois = readJson<PoiCache | null>(K.pois, null)?.byCategory ?? {};
  const regions = selectRegions({ places, memories, pois, here, max: 200 });
  const seen = new Set<string>();
  const out: { label: string; distanceM: number; memories: MemoryRow[] }[] = [];
  for (const r of regions) {
    const d = distanceM(here, { lat: r.latitude, lon: r.longitude });
    if (d > withinM || seen.has(r.placeId)) continue;
    seen.add(r.placeId);
    out.push({ label: r.label, distanceM: Math.round(d), memories: memories.filter((m) => m.place_id === r.placeId) });
  }
  return out;
}

export type Pin = { key: string; placeId: string; label: string; lat: number; lon: number; radius: number; count: number; fixed: boolean };

// Pins for the map view: every watched place (specific ones and the shops found for "any pharmacy") with its open to-do count.
export async function mapPins(): Promise<{ here: LatLon | null; pins: Pin[] }> {
  const here = await currentPosition();
  const { places, memories } = readSnapshot();
  const pois = readJson<PoiCache | null>(K.pois, null)?.byCategory ?? {};
  const regions = selectRegions({ places, memories, pois, here, max: 60 });
  const pins = regions.map((r) => ({
    key: r.identifier,
    placeId: r.placeId,
    label: r.label,
    lat: r.latitude,
    lon: r.longitude,
    radius: r.radius,
    count: memories.filter((m) => m.place_id === r.placeId).length,
    fixed: r.identifier.endsWith('|fixed'),
  }));
  return { here, pins };
}

// To-dos with a date get a normal notification at their time (09:00 when they only have a date). Re-planned after every change,
// because a finished, moved or deleted to-do must not ring. Silent when notifications are not allowed.
export async function scheduleDueReminders(all: (DueMemory & { assignee_id?: string | null })[]): Promise<void> {
  const memories = mine(all);
  try {
    if (!(await Notifications.getPermissionsAsync()).granted) return;
    for (const n of await Notifications.getAllScheduledNotificationsAsync()) {
      if (n.identifier.startsWith('due-')) await Notifications.cancelScheduledNotificationAsync(n.identifier);
    }
    for (const r of pickDueReminders(memories, new Date(), 40)) {
      await Notifications.scheduleNotificationAsync({
        identifier: `due-${r.id}`,
        content: { title: r.lead > 0 ? tNow('notif.dueIn', { lead: leadShort(r.lead, currentLang()) }) : tNow('notif.due'), body: r.body, data: { memoryIds: [r.id] } },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: r.at },
      });
    }
  } catch {
    // reminders are best effort
  }
}

// ---- "Time to leave" reminders -------------------------------------------------------------------------------------------------
type LeaveMemory = DueMemory & { assignee_id?: string | null; place_id?: string | null; remind_travel?: boolean | null };
const driveCache = new Map<string, { at: number; sec: number }>();

/** Seconds of free-flow driving between two points (cached for 15 minutes so reopening the app does not ask the server again). */
async function driveSeconds(a: LatLon, b: LatLon): Promise<number> {
  const key = `${a.lat.toFixed(3)},${a.lon.toFixed(3)}>${b.lat.toFixed(4)},${b.lon.toFixed(4)}`;
  const hit = driveCache.get(key);
  if (hit && Date.now() - hit.at < 15 * 60_000) return hit.sec;
  const sec = (await driveMatrix([a, b])).matrix[0][1];
  driveCache.set(key, { at: Date.now(), sec });
  return sec;
}

/** For to-dos with "tell me when to leave": the drive from where you are to the place, and a notification that rings that long (plus 5 min)
 *  before the time. Planned again every time the app loads, so it follows you. Silent when anything is missing. */
export async function scheduleLeaveReminders(all: LeaveMemory[], places: PlaceRow[], here: LatLon | null, pins: Pin[]): Promise<void> {
  try {
    if (!(await Notifications.getPermissionsAsync()).granted) return;
    for (const n of await Notifications.getAllScheduledNotificationsAsync()) {
      if (n.identifier.startsWith('leave-')) await Notifications.cancelScheduledNotificationAsync(n.identifier);
    }
    if (!here) return;
    const now = new Date();
    const wanted = mine(all).filter((m) => m.remind_travel && m.due_on && m.due_time && m.place_id).slice(0, 25);
    const cands: LeaveCandidate[] = [];
    for (const m of wanted) {
      const place = places.find((p) => p.id === m.place_id);
      const dest = place?.kind === 'fixed' && place.lat != null && place.lon != null
        ? { lat: place.lat, lon: place.lon }
        : pins.filter((p) => p.placeId === m.place_id).map((p) => ({ lat: p.lat, lon: p.lon })).sort((a, b) => distanceM(here, a) - distanceM(here, b))[0] ?? null;
      let travelMin: number | null = null;
      if (dest) {
        const [h, mi] = (m.due_time as string).split(':').map(Number);
        const arrival = new Date(+(m.due_on as string).slice(0, 4), +(m.due_on as string).slice(5, 7) - 1, +(m.due_on as string).slice(8, 10), h || 0, mi || 0);
        if (arrival.getTime() > now.getTime()) travelMin = travelMinutes(await driveSeconds(here, dest), arrival);
      }
      cands.push({ id: m.id, body: m.body, status: m.status, due_on: m.due_on, due_time: m.due_time, remind_travel: true, travelMin, placeName: place ? place.name : undefined });
    }
    for (const r of pickLeaveReminders(cands, now)) {
      const time = `${String(r.due.getHours()).padStart(2, '0')}:${String(r.due.getMinutes()).padStart(2, '0')}`;
      await Notifications.scheduleNotificationAsync({
        identifier: `leave-${r.id}`,
        content: {
          title: r.placeName ? tNow('notif.leaveTitle', { place: r.placeName }) : tNow('notif.leaveTitleNoPlace'),
          body: tNow('notif.leaveBody', { title: r.body, time, n: r.travelMin }),
          data: { memoryIds: [r.id] },
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: r.at },
      });
    }
  } catch {
    // reminders are best effort
  }
}

// ---- Morning briefing ----------------------------------------------------------------------------------------------------------
export type BriefingSetting = { on: boolean; time: string };
export const readBriefing = (): BriefingSetting => readJson<BriefingSetting>('hm.briefing', { on: false, time: '07:30' });
export const writeBriefing = (s: BriefingSetting) => writeJson('hm.briefing', s);

/** One notification a day at the chosen time with what is due that day, planned a week ahead. */
export async function scheduleBriefings(all: (DueMemory & { assignee_id?: string | null })[]): Promise<void> {
  try {
    if (!(await Notifications.getPermissionsAsync()).granted) return;
    for (const n of await Notifications.getAllScheduledNotificationsAsync()) {
      if (n.identifier.startsWith('brief-')) await Notifications.cancelScheduledNotificationAsync(n.identifier);
    }
    const s = readBriefing();
    if (!s.on) return;
    for (const b of planBriefings(mine(all), new Date(), s.time)) {
      await Notifications.scheduleNotificationAsync({
        identifier: `brief-${b.day}`,
        content: { title: tnNow('notif.brief', b.count), body: [b.titles.join(' · '), b.late > 0 ? tNow('notif.briefLate', { n: b.late }) : ''].filter(Boolean).join(' — ') },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: b.at },
      });
    }
  } catch { /* the briefing is a nicety */ }
}

/** Plan every local notification again from the server (after changing a setting). */
export async function replanNotifications(householdId: string): Promise<void> {
  try {
    const [m, p] = await Promise.all([listMemories(householdId, ['inbox', 'active']), listPlaces(householdId)]);
    await scheduleDueReminders(m);
    await scheduleBriefings(m);
    const mp = await mapPins();
    await scheduleLeaveReminders(m, p, mp.here, mp.pins);
  } catch { /* offline */ }
}

export type NotifyStatus = 'granted' | 'denied' | 'undetermined';
export async function notifyStatus(): Promise<NotifyStatus> {
  try {
    const cur = await Notifications.getPermissionsAsync();
    return cur.granted ? 'granted' : cur.canAskAgain ? 'undetermined' : 'denied';
  } catch {
    return 'denied';
  }
}

/** The number on the app icon: what is due today or earlier. Silent when notifications are not allowed. */
export async function setBadge(list: (DueMemory & { assignee_id?: string | null })[], todayIso: string): Promise<void> {
  try {
    if (!(await Notifications.getPermissionsAsync()).granted) return;
    const n = mine(list).filter((m) => m.due_on && m.due_on <= todayIso && (m.status === 'active' || m.status === 'inbox')).length;
    await Notifications.setBadgeCountAsync(n);
  } catch { /* the badge is a nicety */ }
}

/** A notification a few seconds from now, to check that permission, sound and the banner work. */
export async function sendTestNotification(): Promise<boolean> {
  try {
    if (!(await ensureNotifyPermission())) return false;
    await Notifications.scheduleNotificationAsync({
      content: { title: 'Home Memory', body: tNow('set.notifTestBody') },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 5 },
    });
    return true;
  } catch {
    return false;
  }
}

/** Ask once for permission to notify (needed for dated to-do reminders). */
export async function ensureNotifyPermission(): Promise<boolean> {
  try {
    const cur = await Notifications.getPermissionsAsync();
    if (cur.granted) return true;
    if (!cur.canAskAgain) return false;
    return (await Notifications.requestPermissionsAsync()).granted;
  } catch {
    return false;
  }
}
