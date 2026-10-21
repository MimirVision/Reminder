// When Ledger notifies you, and what the notification says. Shared, word for word, by the app (reminders while it is open)
// and the `ledger-notify` edge function (reminders with Ledger closed), so both always agree. It therefore imports nothing:
// supabase/build-function.mjs pastes this file into the function as it is.
//
// A task reminds you on its due date at a time of day (default 08:00), and optionally some days earlier. A meeting reminds
// you some minutes before it starts (default 15). Each task, schedule and meeting can choose its own; null means "the default".

export interface NotifySettings {
  /** Off pauses every notification, on every device. */
  enabled: boolean;
  /** Days before the due date (0 = on the day). */
  taskDays: number[];
  /** "HH:MM": when task reminders arrive. */
  taskTime: string;
  /** Minutes before a meeting starts (0 = when it starts). */
  meetingMinutes: number[];
  /** Task titles and client names in the notification. Off shows only "2 tasks due today", for a lock screen others can see. */
  details: boolean;
}

export const DEFAULT_NOTIFY: NotifySettings = { enabled: true, taskDays: [0], taskTime: '08:00', meetingMinutes: [15], details: true };

/** The choices offered; anything in range is accepted, so a value set elsewhere is kept. */
export const TASK_DAY_CHOICES = [0, 1, 2, 3, 5, 7, 14, 30];
export const MEETING_MINUTE_CHOICES = [0, 5, 10, 15, 30, 60, 120, 1440];
export const MAX_REMINDERS = 4;
export const MAX_DAYS = 60;
export const MAX_MINUTES = 10080;

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function cleanList(raw: unknown, max: number): number[] | null {
  if (!Array.isArray(raw)) return null;
  const ok = raw.filter((n): n is number => Number.isInteger(n) && n >= 0 && n <= max);
  return [...new Set(ok)].sort((a, b) => b - a).slice(0, MAX_REMINDERS);
}
/** A task's or schedule's own days, or null for "use the default". */
export const cleanDays = (raw: unknown): number[] | null => cleanList(raw, MAX_DAYS);
/** A meeting's own minutes, or null for "use the default". */
export const cleanMinutes = (raw: unknown): number[] | null => cleanList(raw, MAX_MINUTES);

/** The workspace's notification settings, with defaults for anything missing or malformed. */
export function notifySettings(raw: unknown): NotifySettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof NotifySettings, unknown>>;
  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : DEFAULT_NOTIFY.enabled,
    taskDays: cleanDays(r.taskDays) ?? DEFAULT_NOTIFY.taskDays,
    taskTime: typeof r.taskTime === 'string' && TIME.test(r.taskTime) ? r.taskTime : DEFAULT_NOTIFY.taskTime,
    meetingMinutes: cleanMinutes(r.meetingMinutes) ?? DEFAULT_NOTIFY.meetingMinutes,
    details: typeof r.details === 'boolean' ? r.details : DEFAULT_NOTIFY.details,
  };
}

// ---- time zones ----

const formatters = new Map<string, Intl.DateTimeFormat>();
function zoneFormat(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      f = zoneFormat('UTC');
    }
    formatters.set(tz, f);
  }
  return f;
}
/** How far the zone's clock is ahead of UTC at that instant, in ms. */
function offset(ts: number, tz: string): number {
  const p = Object.fromEntries(zoneFormat(tz).formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - Math.floor(ts / 1000) * 1000;
}
/** The instant a wall-clock date and time happen in a time zone. A time skipped by daylight saving lands an hour later. */
export function zonedInstant(date: string, time: string, tz: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const wall = Date.UTC(y, m - 1, d, h, mi);
  const first = wall - offset(wall, tz);
  return wall - offset(first, tz);
}
/** Today's date in a time zone, as YYYY-MM-DD. */
export function zonedToday(now: number, tz: string): string {
  const p = Object.fromEntries(zoneFormat(tz).formatToParts(new Date(now)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
export function addDaysISO(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// ---- what is due ----

export interface RemTask { id: string; clientId: string; scheduleId: string | null; title: string; dueDate: string; status: string; notifyDays?: number[] | null }
export interface RemMeeting { id: string; clientId: string | null; title: string; date: string; start: string; end: string; location?: string; notifyMinutes?: number[] | null }
export interface RemSchedule { id: string; notifyDays?: number[] | null }

export interface Reminder {
  /** Unique per item, lead and due date/time: moving a task re-arms its reminders, and nothing is announced twice. */
  key: string;
  at: number;
  kind: 'task' | 'meeting';
  id: string;
  /** Days (tasks) or minutes (meetings) before. */
  lead: number;
  title: string;
  client: string | null;
  date: string;
  start?: string;
  end?: string;
  location?: string;
}

const OPEN = new Set(['todo', 'in_progress', 'waiting']);

/** The days a task reminds you: its own, else its schedule's, else the workspace default. */
export function taskDays(t: RemTask, schedules: Map<string, RemSchedule>, s: NotifySettings): number[] {
  return t.notifyDays ?? (t.scheduleId ? schedules.get(t.scheduleId)?.notifyDays : null) ?? s.taskDays;
}
export const meetingMinutes = (m: RemMeeting, s: NotifySettings): number[] => m.notifyMinutes ?? s.meetingMinutes;

/** Every reminder that falls in (from, to], earliest first. */
export function remindersBetween(data: {
  tasks: RemTask[]; meetings: RemMeeting[]; schedules: RemSchedule[]; clientName: (id: string) => string | null | undefined;
  settings: NotifySettings; timeZone: string;
}, from: number, to: number): Reminder[] {
  const { settings: s, timeZone: tz } = data;
  if (!s.enabled) return [];
  const schedules = new Map(data.schedules.map((x) => [x.id, x]));
  const out: Reminder[] = [];
  for (const t of data.tasks) {
    if (!OPEN.has(t.status)) continue;
    for (const lead of taskDays(t, schedules, s)) {
      const at = zonedInstant(addDaysISO(t.dueDate, -lead), s.taskTime, tz);
      if (at > from && at <= to) out.push({ key: `t:${t.id}:${t.dueDate}:${lead}`, at, kind: 'task', id: t.id, lead, title: t.title, client: data.clientName(t.clientId) ?? null, date: t.dueDate });
    }
  }
  for (const m of data.meetings) {
    const startsAt = zonedInstant(m.date, m.start, tz);
    for (const lead of meetingMinutes(m, s)) {
      const at = startsAt - lead * 60_000;
      if (at > from && at <= to) {
        out.push({ key: `m:${m.id}:${m.date}T${m.start}:${lead}`, at, kind: 'meeting', id: m.id, lead, title: m.title,
          client: m.clientId ? data.clientName(m.clientId) ?? null : null, date: m.date, start: m.start, end: m.end, location: m.location || undefined });
      }
    }
  }
  return out.sort((a, b) => a.at - b.at || a.title.localeCompare(b.title));
}

// ---- what it says ----

export interface PushMessage {
  title: string;
  body: string;
  /** Same tag, same notification: a repeat replaces the earlier one instead of stacking. */
  tag: string;
  /** In-app path to open on a tap. */
  url: string;
  /** The reminder keys this message covers. */
  keys: string[];
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const dayLabel = (date: string) => new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));

/** "due today", "due tomorrow", "due in 3 days". */
export function dueWhen(lead: number): string {
  return lead === 0 ? 'due today' : lead === 1 ? 'due tomorrow' : `due in ${lead} days`;
}
/** "now", "in 15 min", "in 1 hour", "tomorrow at 10:00". */
export function meetingWhen(lead: number, start: string, date: string): string {
  if (lead === 0) return 'now';
  if (lead < 60) return `in ${lead} min`;
  if (lead < 1440 && lead % 60 === 0) return `in ${plural(lead / 60, 'hour')}`;
  if (lead < 1440) return `in ${Math.floor(lead / 60)} h ${lead % 60} min`;
  return lead === 1440 ? `tomorrow at ${start}` : `${dayLabel(date)} at ${start}`;
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The notifications for reminders that fall due together: tasks at the same moment become one ("3 tasks due today"),
 * each meeting gets its own.
 */
export function messagesFor(reminders: Reminder[], details: boolean): PushMessage[] {
  const out: PushMessage[] = [];
  const taskGroups = new Map<number, Reminder[]>();
  for (const r of reminders) {
    if (r.kind === 'task') taskGroups.set(r.at, [...(taskGroups.get(r.at) ?? []), r]);
    else {
      const when = meetingWhen(r.lead, r.start!, r.date);
      const time = `${r.start}–${r.end}`;
      out.push({
        title: details ? `${cap(when)}: ${clip(r.title, 80)}` : `Meeting ${when}`,
        body: details ? [time, r.client, r.location].filter(Boolean).map((x) => clip(String(x), 80)).join(' · ') : time,
        tag: `ledger-meeting-${r.id}`, url: `/calendar?view=day&date=${r.date}&meeting=${r.id}`, keys: [r.key],
      });
    }
  }
  for (const [at, list] of taskGroups) {
    const leads = new Set(list.map((r) => r.lead));
    const same = leads.size === 1 ? dueWhen(list[0].lead) : null;
    if (list.length === 1) {
      const r = list[0];
      out.push({
        title: details ? `${cap(dueWhen(r.lead))}: ${clip(r.title, 80)}` : `A task is ${dueWhen(r.lead)}`,
        body: details ? [r.client && clip(r.client, 80), r.lead > 0 ? dayLabel(r.date) : null].filter(Boolean).join(' · ') || 'Open Ledger to see it.' : 'Open Ledger to see it.',
        tag: `ledger-task-${r.id}`, url: `/tasks?task=${r.id}`, keys: [r.key],
      });
      continue;
    }
    const shown = list.slice(0, 4).map((r) => clip(`${r.title}${r.client ? ` · ${r.client}` : ''}${same ? '' : ` (${dueWhen(r.lead)})`}`, 90));
    out.push({
      title: same ? `${plural(list.length, 'task')} ${same}` : `${plural(list.length, 'task')} coming up`,
      body: details ? [...shown, list.length > 4 ? `+${list.length - 4} more` : ''].filter(Boolean).join('\n') : 'Open Ledger to see them.',
      tag: `ledger-tasks-${at}`, url: '/tasks', keys: list.map((r) => r.key),
    });
  }
  return out.sort((a, b) => a.tag.localeCompare(b.tag));
}

/** Describes a reminder list for a person: "On the day and 3 days before at 08:00". */
export function describeDays(days: number[], time?: string): string {
  if (!days.length) return 'No notifications';
  const parts = [...days].sort((a, b) => a - b).map((d) => (d === 0 ? 'on the day' : d === 1 ? '1 day before' : d % 7 === 0 ? `${plural(d / 7, 'week')} before` : `${d} days before`));
  const text = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return cap(text) + (time ? ` at ${time}` : '');
}
export function describeMinutes(minutes: number[]): string {
  if (!minutes.length) return 'No notifications';
  const parts = [...minutes].sort((a, b) => a - b).map((m) => (m === 0 ? 'when it starts'
    : m % 1440 === 0 ? `${plural(m / 1440, 'day')} before` : m % 60 === 0 ? `${plural(m / 60, 'hour')} before` : `${m} min before`));
  return cap(parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`);
}
