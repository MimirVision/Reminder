import type { MemoryRow, PlaceRow } from './types.ts';

// Notification policy (docs/DESIGN.md §7): fire once per visit, with a cooldown, and never for snoozed memories.
export const PLACE_COOLDOWN_MS = 3 * 3600_000;

export type PlaceVisitState = { inside: boolean; lastNotifiedAt: number | null };
export type SurfaceState = Record<string, PlaceVisitState>;

export type Notice = { placeId: string; label: string; memoryIds: string[]; title: string; body: string };

export function notificationText(label: string, memories: Pick<MemoryRow, 'body'>[]): { title: string; body: string } {
  const lines = memories.map((m) => m.body.trim() || '(photo)');
  const shown = lines.slice(0, 3);
  const extra = lines.length - shown.length;
  return { title: `Near ${label}`, body: shown.join('\n') + (extra > 0 ? `\n+${extra} more` : '') };
}

export function onRegionEvent(args: {
  type: 'enter' | 'exit';
  placeId: string;
  label: string;
  places: PlaceRow[];
  memories: MemoryRow[];
  state: SurfaceState;
  now: number;
}): { notice: Notice | null; state: SurfaceState } {
  const prev = args.state[args.placeId] ?? { inside: false, lastNotifiedAt: null };

  if (args.type === 'exit') {
    return { notice: null, state: { ...args.state, [args.placeId]: { ...prev, inside: false } } };
  }

  const next: PlaceVisitState = { ...prev, inside: true };
  const cooling = prev.lastNotifiedAt != null && args.now - prev.lastNotifiedAt < PLACE_COOLDOWN_MS;
  const due = args.memories.filter(
    (m) =>
      m.status === 'active' &&
      m.place_id === args.placeId &&
      (m.snoozed_until == null || new Date(m.snoozed_until).getTime() <= args.now),
  );

  if (cooling || due.length === 0) {
    return { notice: null, state: { ...args.state, [args.placeId]: next } };
  }

  next.lastNotifiedAt = args.now;
  return {
    notice: { placeId: args.placeId, label: args.label, memoryIds: due.map((m) => m.id), ...notificationText(args.label, due) },
    state: { ...args.state, [args.placeId]: next },
  };
}
