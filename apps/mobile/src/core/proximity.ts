import { distanceM } from './geo.ts';
import type { LatLon, Region } from './types.ts';

// "Are you here?" prompt: shown while the app is open once you are inside a watched region's radius.
export const PROMPT_COOLDOWN_MS = 3 * 3600_000;

export type Dismissals = Record<string, number>; // placeId -> last dismissed/opened timestamp

export function hereCandidate(args: {
  here: LatLon;
  regions: Region[];
  dismissed: Dismissals;
  now: number;
}): { region: Region; distanceM: number } | null {
  let best: { region: Region; distanceM: number } | null = null;
  for (const r of args.regions) {
    const d = distanceM(args.here, { lat: r.latitude, lon: r.longitude });
    if (d > r.radius) continue;
    const last = args.dismissed[r.placeId];
    if (last != null && args.now - last < PROMPT_COOLDOWN_MS) continue;
    if (!best || d < best.distanceM) best = { region: r, distanceM: d };
  }
  return best;
}
