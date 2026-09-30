import { distanceM } from './geo.ts';
import type { LatLon, MemoryRow, PlaceRow, Poi, Region } from './types.ts';

// iOS monitors at most 20 regions per app, so watch only the nearest ones and re-select on significant movement.
export const MAX_REGIONS = 20;

export function selectRegions(input: {
  places: PlaceRow[];
  memories: MemoryRow[];
  pois: Record<string, Poi[]>;
  here: LatLon | null;
  max?: number;
}): Region[] {
  const wanted = new Set(
    input.memories.filter((m) => m.status === 'active' && m.place_id).map((m) => m.place_id as string),
  );

  const regions: Region[] = [];
  for (const p of input.places) {
    if (!wanted.has(p.id)) continue;
    if (p.kind === 'fixed' && p.lat != null && p.lon != null) {
      regions.push({
        identifier: `${p.id}|fixed`, placeId: p.id, label: p.name,
        latitude: p.lat, longitude: p.lon, radius: p.radius_m,
      });
    } else if (p.kind === 'category' && p.category) {
      for (const poi of input.pois[p.category] ?? []) {
        regions.push({
          identifier: `${p.id}|${poi.id}`, placeId: p.id, label: poi.name,
          latitude: poi.lat, longitude: poi.lon, radius: p.radius_m,
        });
      }
    }
  }

  const here = input.here;
  if (here) {
    const d = (r: Region) => distanceM(here, { lat: r.latitude, lon: r.longitude });
    regions.sort((a, b) => d(a) - d(b));
  }
  return regions.slice(0, input.max ?? MAX_REGIONS);
}
