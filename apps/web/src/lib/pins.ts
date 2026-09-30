import type { Poi } from './geo';
import type { Place } from './types';

export type MapPin = { key: string; placeId: string; label: string; lat: number; lon: number; count: number; radius: number | null };

/** Pins for the map. A saved place with no open to-dos is still drawn (as a quiet dot); "any pharmacy" places are drawn
 *  at the real shops found nearby, only while they have to-dos. */
export function buildPins(places: Place[], countByPlace: Map<string, number>, pois: Record<string, Poi[]>, labelOf: (p: Place) => string = (p) => p.name): MapPin[] {
  const out: MapPin[] = [];
  for (const p of places) {
    const count = countByPlace.get(p.id) ?? 0;
    if (p.kind === 'fixed' && p.lat != null && p.lon != null) out.push({ key: p.id, placeId: p.id, label: labelOf(p), lat: p.lat, lon: p.lon, count, radius: p.radius_m });
    else if (p.kind === 'category' && p.category && count > 0) for (const poi of pois[p.category] ?? []) out.push({ key: `${p.id}|${poi.id}`, placeId: p.id, label: poi.name, lat: poi.lat, lon: poi.lon, count, radius: null });
  }
  return out;
}
