import type { MemoryRow, PlaceRow } from './types.ts';

// Notification policy (docs/DESIGN.md §7): fire once per visit, with a cooldown, and never for snoozed memories.
export const PLACE_COOLDOWN_MS = 3 * 3600_000;

export type PlaceVisitState = { inside: boolean; lastNotifiedAt: number | null; lastLeaveNotifiedAt?: number | null };
export type SurfaceState = Record<string, PlaceVisitState>;

export type Notice = { placeId: string; label: string; memoryIds: string[]; title: string; body: string };

// The words in a notification, so the caller can supply Norwegian; English by default.
export type Words = { near: (label: string) => string; more: (n: number) => string; photo: string; leaving?: (label: string) => string };
export const ENGLISH: Words = { near: (label) => `Near ${label}`, more: (n) => `+${n} more`, photo: '(photo)', leaving: (label) => `Leaving ${label}` };

export function notificationText(label: string, memories: Pick<MemoryRow, 'body'>[], w: Words = ENGLISH, leaving = false): { title: string; body: string } {
  const lines = memories.map((m) => m.body.trim() || w.photo);
  const shown = lines.slice(0, 3);
  const extra = lines.length - shown.length;
  return { title: leaving ? (w.leaving ?? ENGLISH.leaving!)(label) : w.near(label), body: shown.join('\n') + (extra > 0 ? `\n${w.more(extra)}` : '') };
}

export function onRegionEvent(args: {
  type: 'enter' | 'exit';
  placeId: string;
  label: string;
  places: PlaceRow[];
  memories: MemoryRow[];
  state: SurfaceState;
  now: number;
  words?: Words;
}): { notice: Notice | null; state: SurfaceState } {
  const prev = args.state[args.placeId] ?? { inside: false, lastNotifiedAt: null };

  const awake = (m: MemoryRow) => m.status === 'active' && m.place_id === args.placeId && (m.snoozed_until == null || new Date(m.snoozed_until).getTime() <= args.now);

  // Leaving a place: only to-dos set to "when I leave" ring, once per departure (with the same cooldown).
  if (args.type === 'exit') {
    const out: PlaceVisitState = { ...prev, inside: false };
    const leaveDue = args.memories.filter((m) => awake(m) && m.place_trigger === 'leave');
    const cooling = prev.lastLeaveNotifiedAt != null && args.now - prev.lastLeaveNotifiedAt < PLACE_COOLDOWN_MS;
    if (cooling || leaveDue.length === 0) return { notice: null, state: { ...args.state, [args.placeId]: out } };
    out.lastLeaveNotifiedAt = args.now;
    return {
      notice: { placeId: args.placeId, label: args.label, memoryIds: leaveDue.map((m) => m.id), ...notificationText(args.label, leaveDue, args.words, true) },
      state: { ...args.state, [args.placeId]: out },
    };
  }

  const next: PlaceVisitState = { ...prev, inside: true };
  const cooling = prev.lastNotifiedAt != null && args.now - prev.lastNotifiedAt < PLACE_COOLDOWN_MS;
  const due = args.memories.filter((m) => awake(m) && m.place_trigger !== 'leave');

  if (cooling || due.length === 0) {
    return { notice: null, state: { ...args.state, [args.placeId]: next } };
  }

  next.lastNotifiedAt = args.now;
  return {
    notice: { placeId: args.placeId, label: args.label, memoryIds: due.map((m) => m.id), ...notificationText(args.label, due, args.words) },
    state: { ...args.state, [args.placeId]: next },
  };
}
