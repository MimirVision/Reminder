// What one scheduled run of `ledger-notify` announces, from the database rows it read. Pure, so it is tested without a
// database or a network (supabase/tests/notify-plan.test.ts).
import { addDaysISO, cleanDays, cleanMinutes, messagesFor, notifySettings, remindersBetween, type PushMessage, type Reminder } from '../../../src/lib/reminders.ts';

/** A reminder missed by more than this (the schedule did not run, the server was down) is dropped, not sent late. */
export const LATE_MS = 30 * 60_000;
/** How far ahead the rows are read: the longest reminder lead, plus a day either side for time zones. */
export const TASK_DAYS_AHEAD = 62;
export const MEETING_DAYS_AHEAD = 8;

type Row = Record<string, unknown>;
export interface RunRows { workspaces: Row[]; occurrences: Row[]; meetings: Row[]; schedules: Row[]; clients: Row[] }
export interface WorkspacePlan { workspaceId: string; reminders: Reminder[]; details: boolean }

const str = (v: unknown) => (v == null ? '' : String(v));
const hhmm = (v: unknown) => str(v).slice(0, 5);

/** The date range of rows a run needs, around today (UTC; a day of slack covers every time zone). */
export function windowDates(now: number) {
  const today = new Date(now).toISOString().slice(0, 10);
  return { from: addDaysISO(today, -1), tasksTo: addDaysISO(today, TASK_DAYS_AHEAD), meetingsTo: addDaysISO(today, MEETING_DAYS_AHEAD) };
}

/** Per workspace: the reminders due in the last LATE_MS up to now. */
export function planRun(rows: RunRows, now: number): WorkspacePlan[] {
  const clientName = new Map(rows.clients.map((c) => [str(c.id), str(c.name)]));
  return rows.workspaces.map((w) => {
    const id = str(w.id);
    const settings = notifySettings((w.settings as Row | null)?.notifications);
    const mine = <T extends Row>(list: T[]) => list.filter((r) => r.workspace_id === id);
    const reminders = remindersBetween({
      settings, timeZone: str(w.timezone) || 'Europe/Oslo', clientName: (c) => clientName.get(c),
      tasks: mine(rows.occurrences).map((o) => ({ id: str(o.id), clientId: str(o.client_id), scheduleId: o.schedule_id ? str(o.schedule_id) : null,
        title: str(o.title), dueDate: str(o.due_date), status: str(o.status), notifyDays: cleanDays(o.notify_days) })),
      schedules: mine(rows.schedules).map((s) => ({ id: str(s.id), notifyDays: cleanDays(s.notify_days) })),
      meetings: mine(rows.meetings).map((m) => ({ id: str(m.id), clientId: m.client_id ? str(m.client_id) : null, title: str(m.title), date: str(m.meeting_date),
        start: hhmm(m.start_time), end: hhmm(m.end_time), location: str(m.location), notifyMinutes: cleanMinutes(m.notify_minutes) })),
    }, now - LATE_MS, now);
    return { workspaceId: id, reminders, details: settings.details };
  }).filter((p) => p.reminders.length > 0);
}

/** The notifications for the reminders this run claimed (another run may have sent the rest). */
export function messagesForClaimed(plan: WorkspacePlan, claimed: Set<string>): PushMessage[] {
  return messagesFor(plan.reminders.filter((r) => claimed.has(r.key)), plan.details);
}

/** Seconds a push may wait for a device that is off: a meeting reminder is useless after the meeting starts. */
export function ttlFor(m: PushMessage, now: number, reminders: Reminder[]): number {
  const meeting = reminders.find((r) => r.kind === 'meeting' && m.keys.includes(r.key));
  if (!meeting) return 12 * 3600;
  const startsIn = Math.round((meeting.at + meeting.lead * 60_000 - now) / 1000);
  return Math.max(60, Math.min(12 * 3600, startsIn));
}

/** The test notification from Settings. */
export const TEST_MESSAGE = { title: 'Ledger notifications work', body: 'This device will get your reminders.', tag: 'ledger-test', url: '/settings' };
