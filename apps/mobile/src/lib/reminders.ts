import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { listMemories, listPlaces } from './api';
import { readJson, writeJson } from './store';
import { distanceM } from '../core/geo.ts';
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
  snapshot: 'hm.snapshot',
  pois: 'hm.pois',
  regions: 'hm.regions',
  surface: 'hm.surfaceState',
};

export type Snapshot = { places: PlaceRow[]; memories: MemoryRow[] };

export const rememberHousehold = (id: string) => writeJson(K.household, id);
export const readSnapshot = () => readJson<Snapshot>(K.snapshot, { places: [], memories: [] });
export const readRegionLabels = () => readJson<Record<string, string>>(K.regions, {});
export { K as storeKeys };

export async function setupNotificationCategories() {
  await Notifications.setNotificationCategoryAsync(NOTIFICATION_CATEGORY, [
    { identifier: 'here', buttonTitle: "I'm here", options: { opensAppToForeground: true } },
    { identifier: 'done', buttonTitle: 'Done', options: { opensAppToForeground: true } },
    { identifier: 'notnow', buttonTitle: 'Not now', options: { opensAppToForeground: false } },
  ]);
}

export async function hasBackgroundAccess(): Promise<boolean> {
  const [bg, n] = await Promise.all([Location.getBackgroundPermissionsAsync(), Notifications.getPermissionsAsync()]);
  return bg.granted && n.granted;
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

  const [places, memories] = await Promise.all([listPlaces(householdId), listMemories(householdId, ['active'])]);
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
