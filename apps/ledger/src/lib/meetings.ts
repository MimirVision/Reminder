// Meetings in time: "09:30" strings, minutes since midnight, and how overlapping meetings share a column.
import type { Meeting } from './types';

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const isTime = (t: string) => HHMM.test(t);

/** Minutes since midnight for "HH:MM". */
export function toMinutes(t: string): number {
  const m = HHMM.exec(t);
  if (!m) throw new Error(`Not a time: ${t}`);
  return +m[1] * 60 + +m[2];
}

export function fromMinutes(n: number): string {
  const c = Math.max(0, Math.min(23 * 60 + 59, Math.round(n)));
  return `${String(Math.floor(c / 60)).padStart(2, '0')}:${String(c % 60).padStart(2, '0')}`;
}

/** Reads what people type: "9", "930", "9:30", "09.30", "14". Null when it isn't a time. */
export function parseTime(input: string): string | null {
  const s = input.trim().replace('.', ':');
  let h: number, m = 0;
  if (/^\d{1,2}$/.test(s)) h = +s;
  else if (/^\d{3,4}$/.test(s)) { h = +s.slice(0, -2); m = +s.slice(-2); }
  else if (/^\d{1,2}:\d{2}$/.test(s)) { [h, m] = s.split(':').map(Number) as [number, number]; }
  else return null;
  if (h > 23 || m > 59) return null;
  return fromMinutes(h * 60 + m);
}

export const durationMinutes = (m: Pick<Meeting, 'start' | 'end'>) => toMinutes(m.end) - toMinutes(m.start);

export function formatDuration(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), r = min % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

/** Problems with a meeting, in words a person can act on. */
export function meetingErrors(m: Pick<Meeting, 'title' | 'start' | 'end'>): { title: string | null; time: string | null } {
  return {
    title: !m.title.trim() ? 'Give the meeting a title.' : m.title.length > 200 ? 'Keep the title under 200 characters.' : null,
    time: !isTime(m.start) || !isTime(m.end) ? 'Enter times like 09:30.' : toMinutes(m.end) <= toMinutes(m.start) ? 'The meeting must end after it starts.' : null,
  };
}

export const sortMeetings = <T extends Pick<Meeting, 'date' | 'start' | 'end'>>(ms: T[]) =>
  [...ms].sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start) || a.end.localeCompare(b.end));

/**
 * Side-by-side columns for one day's meetings, the way calendars draw overlaps: each meeting gets a lane, and every
 * meeting in a cluster of overlapping ones knows how many lanes that cluster needs.
 */
export function layoutDay<T extends Pick<Meeting, 'id' | 'start' | 'end'>>(ms: T[]): Map<string, { lane: number; lanes: number }> {
  const out = new Map<string, { lane: number; lanes: number }>();
  const sorted = [...ms].sort((a, b) => a.start.localeCompare(b.start) || b.end.localeCompare(a.end));
  let cluster: { id: string; lane: number }[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -1;
  const flush = () => {
    for (const c of cluster) out.set(c.id, { lane: c.lane, lanes: laneEnds.length });
    cluster = []; laneEnds = []; clusterEnd = -1;
  };
  for (const m of sorted) {
    const s = toMinutes(m.start), e = toMinutes(m.end);
    if (s >= clusterEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= s);
    if (lane < 0) { lane = laneEnds.length; laneEnds.push(e); } else laneEnds[lane] = e;
    cluster.push({ id: m.id, lane });
    clusterEnd = Math.max(clusterEnd, e);
  }
  flush();
  return out;
}
