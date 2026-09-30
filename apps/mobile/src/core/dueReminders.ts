// Local notifications for to-dos that have a date: which ones to schedule, and when. Pure, unit tested.
import type { MemoryRow } from './types.ts';

export type DueMemory = Pick<MemoryRow, 'id' | 'body' | 'status'> & { due_on: string | null; due_time: string | null };
export type DueReminder = { id: string; body: string; at: Date };

/** The moment a to-do is due in the phone's own time zone: its time, or 09:00 when it only has a date. */
export function dueMoment(dueOn: string, dueTime: string | null): Date {
  const [h, m] = (dueTime ?? '09:00').split(':').map(Number);
  return new Date(+dueOn.slice(0, 4), +dueOn.slice(5, 7) - 1, +dueOn.slice(8, 10), h || 0, m || 0, 0, 0);
}

/** Open dated to-dos that are still ahead, soonest first. iOS keeps at most 64 pending local notifications, so we cap it. */
export function pickDueReminders(memories: DueMemory[], now: Date, max = 60): DueReminder[] {
  return memories
    .filter((m) => m.due_on && (m.status === 'active' || m.status === 'inbox'))
    .map((m) => ({ id: m.id, body: m.body.split('\n')[0].trim(), at: dueMoment(m.due_on as string, m.due_time) }))
    .filter((r) => r.at.getTime() > now.getTime())
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .slice(0, max);
}
