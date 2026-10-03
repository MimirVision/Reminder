// "Time to leave" reminders: for a to-do at a place with a clock time, ring when the drive there (plus a small buffer) has to start.
// Pure, unit tested. The drive time itself comes from routing.ts.
import { trafficFactor } from './route.ts';

export const LEAVE_BUFFER_MIN = 5;

/** Minutes to drive, from free-flow seconds, slowed down for rush hour at the arrival time. Rounded up. */
export function travelMinutes(freeFlowSeconds: number, arrival: Date): number {
  const minute = arrival.getHours() * 60 + arrival.getMinutes();
  return Math.max(1, Math.ceil((freeFlowSeconds / 60) * trafficFactor(minute, arrival.getDay())));
}

export type LeaveCandidate = {
  id: string; body: string; status: string;
  due_on: string | null; due_time: string | null; remind_travel?: boolean | null;
  travelMin: number | null; // null = could not be worked out
  placeName?: string;
};
export type LeaveReminder = { id: string; body: string; at: Date; travelMin: number; due: Date; placeName?: string };

const dueAt = (on: string, time: string) => {
  const [h, m] = time.split(':').map(Number);
  return new Date(+on.slice(0, 4), +on.slice(5, 7) - 1, +on.slice(8, 10), h || 0, m || 0, 0, 0);
};

/** Those with a leave-by reminder, a clock time and a drive time, whose leave moment is still ahead. Soonest first. */
export function pickLeaveReminders(items: LeaveCandidate[], now: Date, buffer = LEAVE_BUFFER_MIN, max = 12): LeaveReminder[] {
  return items
    .filter((m) => m.remind_travel && m.due_on && m.due_time && m.travelMin != null && (m.status === 'active' || m.status === 'inbox'))
    .map((m) => {
      const due = dueAt(m.due_on as string, m.due_time as string);
      const travelMin = m.travelMin as number;
      return { id: m.id, body: m.body.split('\n')[0].trim(), at: new Date(due.getTime() - (travelMin + buffer) * 60_000), travelMin, due, placeName: m.placeName };
    })
    .filter((r) => r.at.getTime() > now.getTime())
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .slice(0, max);
}
