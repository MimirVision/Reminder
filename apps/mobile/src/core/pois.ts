import { distanceM } from './geo.ts';
import type { LatLon, Poi } from './types.ts';

// Category places are resolved to real shops via OpenStreetMap (Overpass). Coverage in Norway is good for chains.
const OSM: Record<string, { key: string; values: string[]; fallbackName: string }> = {
  pharmacy: { key: 'amenity', values: ['pharmacy'], fallbackName: 'Pharmacy' },
  hardware: { key: 'shop', values: ['doityourself', 'hardware', 'building_materials'], fallbackName: 'Hardware store' },
  grocery: { key: 'shop', values: ['supermarket', 'convenience', 'greengrocer'], fallbackName: 'Grocery store' },
  paint: { key: 'shop', values: ['paint'], fallbackName: 'Paint shop' },
  garden: { key: 'shop', values: ['garden_centre', 'agrarian'], fallbackName: 'Garden centre' },
};

export const knownCategories = () => Object.keys(OSM);

export function overpassQuery(category: string, center: LatLon, radiusM: number): string | null {
  const c = OSM[category];
  if (!c) return null;
  const filter = c.values.length === 1 ? `["${c.key}"="${c.values[0]}"]` : `["${c.key}"~"^(${c.values.join('|')})$"]`;
  return `[out:json][timeout:25];nwr${filter}(around:${Math.round(radiusM)},${center.lat},${center.lon});out center tags;`;
}

type OverpassElement = {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

export function parseOverpass(category: string, json: { elements?: OverpassElement[] }): Poi[] {
  const fallback = OSM[category]?.fallbackName ?? category;
  const out: Poi[] = [];
  for (const el of json.elements ?? []) {
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (lat == null || lon == null) continue;
    out.push({ id: `${el.type}/${el.id}`, name: el.tags?.name ?? el.tags?.brand ?? fallback, lat, lon });
  }
  return out;
}

export type PoiCache = { center: LatLon; fetchedAt: number; byCategory: Record<string, Poi[]> };

const REFRESH_DISTANCE_M = 2_000;
const REFRESH_AGE_MS = 24 * 3600_000;

export function needsRefresh(cache: PoiCache | null, here: LatLon, now: number): boolean {
  if (!cache) return true;
  return distanceM(cache.center, here) > REFRESH_DISTANCE_M || now - cache.fetchedAt > REFRESH_AGE_MS;
}
