import type { Poi } from './geo';
import type { Place } from './types';

export type MapPin = { key: string; placeId: string; label: string; lat: number; lon: number; count: number; radius: number | null };

export function buildPins(places: Place[], countByPlace: Map<string, number>, pois: Record<string, Poi[]>): MapPin[] {
  const out: MapPin[] = [];
  for (const p of places) {
    const count = countByPlace.get(p.id) ?? 0;
    if (count === 0) continue;
    if (p.kind === 'fixed' && p.lat != null && p.lon != null) out.push({ key: p.id, placeId: p.id, label: p.name, lat: p.lat, lon: p.lon, count, radius: p.radius_m });
    else if (p.kind === 'category' && p.category) for (const poi of pois[p.category] ?? []) out.push({ key: `${p.id}|${poi.id}`, placeId: p.id, label: poi.name, lat: poi.lat, lon: poi.lon, count, radius: null });
  }
  return out;
}
