export type LatLon = { lat: number; lon: number };
export type Poi = { id: string; name: string; lat: number; lon: number };

const R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

export function distanceM(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Category places ("any pharmacy") are resolved to real shops via OpenStreetMap. Keep in sync with
// apps/mobile/src/core/pois.ts.
const OSM: Record<string, { key: string; values: string[]; fallbackName: string }> = {
  pharmacy: { key: 'amenity', values: ['pharmacy'], fallbackName: 'Pharmacy' },
  hardware: { key: 'shop', values: ['doityourself', 'hardware', 'building_materials'], fallbackName: 'Hardware store' },
  grocery: { key: 'shop', values: ['supermarket', 'convenience', 'greengrocer'], fallbackName: 'Grocery store' },
  paint: { key: 'shop', values: ['paint'], fallbackName: 'Paint shop' },
  garden: { key: 'shop', values: ['garden_centre', 'agrarian'], fallbackName: 'Garden centre' },
};

export async function fetchPois(category: string, center: LatLon, radiusM = 8000): Promise<Poi[]> {
  const c = OSM[category];
  if (!c) return [];
  const filter = c.values.length === 1 ? `["${c.key}"="${c.values[0]}"]` : `["${c.key}"~"^(${c.values.join('|')})$"]`;
  const q = `[out:json][timeout:25];nwr${filter}(around:${radiusM},${center.lat},${center.lon});out center tags;`;
  const res = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: `data=${encodeURIComponent(q)}` });
  if (!res.ok) throw new Error(`overpass ${res.status}`);
  const json = (await res.json()) as { elements?: { type: string; id: number; lat?: number; lon?: number; center?: LatLon & { lat: number; lon: number }; tags?: Record<string, string> }[] };
  const out: Poi[] = [];
  for (const el of json.elements ?? []) {
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (lat == null || lon == null) continue;
    out.push({ id: `${el.type}/${el.id}`, name: el.tags?.name ?? el.tags?.brand ?? c.fallbackName, lat, lon });
  }
  return out;
}
