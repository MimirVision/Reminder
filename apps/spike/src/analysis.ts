import { LogEvent } from './db';

export type PlaceStats = {
  placeName: string;
  manualArrivals: number;
  detected: number;
  missed: number;
  latenciesSec: number[];
  medianLatencySec: number | null;
  unannotatedEnters: number;
};

const MATCH_WINDOW_MS = 30 * 60 * 1000;

// Match each manual "I'm arriving now" tap with the first geofence enter for that place shortly after.
export function analyse(events: LogEvent[]): PlaceStats[] {
  const byPlace = new Map<number, LogEvent[]>();
  for (const e of events) {
    if (e.place_id == null) continue;
    if (e.kind !== 'manual_arrive' && e.kind !== 'geofence_enter') continue;
    byPlace.set(e.place_id, [...(byPlace.get(e.place_id) ?? []), e]);
  }

  return [...byPlace.values()].map((list) => {
    const manual = list.filter((e) => e.kind === 'manual_arrive');
    const enters = list.filter((e) => e.kind === 'geofence_enter');
    const used = new Set<number>();
    const latenciesSec: number[] = [];
    let missed = 0;

    for (const m of manual) {
      const hit = enters.find((g) => !used.has(g.id) && g.ts >= m.ts - MATCH_WINDOW_MS && g.ts <= m.ts + MATCH_WINDOW_MS);
      if (hit) {
        used.add(hit.id);
        latenciesSec.push(Math.round((hit.ts - m.ts) / 1000));
      } else {
        missed++;
      }
    }

    const sorted = [...latenciesSec].sort((a, b) => a - b);
    return {
      placeName: list[0].place_name ?? `place ${list[0].place_id}`,
      manualArrivals: manual.length,
      detected: latenciesSec.length,
      missed,
      latenciesSec,
      medianLatencySec: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null,
      unannotatedEnters: enters.length - used.size,
    };
  });
}

export function toCsv(events: LogEvent[]): string {
  const header = 'time_iso,kind,place,detail,battery,lat,lon,accuracy_m';
  const rows = events.map((e) =>
    [
      new Date(e.ts).toISOString(),
      e.kind,
      JSON.stringify(e.place_name ?? ''),
      JSON.stringify(e.detail ?? ''),
      e.battery == null ? '' : e.battery.toFixed(2),
      e.lat ?? '',
      e.lon ?? '',
      e.accuracy ?? '',
    ].join(','),
  );
  return [header, ...rows].join('\n');
}
