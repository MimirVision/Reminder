import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NOTIFY, cleanDays, describeDays, describeMinutes, messagesFor, notifySettings, remindersBetween, zonedInstant, zonedToday,
  type RemMeeting, type RemTask,
} from './reminders';

const OSLO = 'Europe/Oslo';
const task = (over: Partial<RemTask> = {}): RemTask => ({ id: 't1', clientId: 'c1', scheduleId: null, title: 'Deliver VAT', dueDate: '2026-10-22', status: 'todo', ...over });
const meeting = (over: Partial<RemMeeting> = {}): RemMeeting => ({ id: 'm1', clientId: 'c1', title: 'Budget review', date: '2026-10-22', start: '10:00', end: '11:00', location: 'Teams', ...over });
const names: Record<string, string> = { c1: 'Fjordlys AS', c2: 'Nordlys Bygg AS' };
const data = (over: Partial<Parameters<typeof remindersBetween>[0]> = {}) => ({
  tasks: [], meetings: [], schedules: [], clientName: (id: string) => names[id], settings: DEFAULT_NOTIFY, timeZone: OSLO, ...over,
});
const day = (d: string) => [zonedInstant(d, '00:00', OSLO) - 1, zonedInstant(d, '23:59', OSLO)] as const;

describe('time zones', () => {
  it('turns Oslo wall-clock time into the right instant, summer and winter', () => {
    expect(new Date(zonedInstant('2026-07-01', '08:00', OSLO)).toISOString()).toBe('2026-07-01T06:00:00.000Z');
    expect(new Date(zonedInstant('2026-12-01', '08:00', OSLO)).toISOString()).toBe('2026-12-01T07:00:00.000Z');
    // The night the clocks go back (25 Oct 2026) and forward (29 Mar 2026).
    expect(new Date(zonedInstant('2026-10-25', '08:00', OSLO)).toISOString()).toBe('2026-10-25T07:00:00.000Z');
    expect(new Date(zonedInstant('2026-03-29', '08:00', OSLO)).toISOString()).toBe('2026-03-29T06:00:00.000Z');
    expect(new Date(zonedInstant('2026-07-01', '08:00', 'America/New_York')).toISOString()).toBe('2026-07-01T12:00:00.000Z');
  });
  it('knows today in a zone', () => {
    expect(zonedToday(Date.parse('2026-10-21T22:30:00Z'), OSLO)).toBe('2026-10-22');
    expect(zonedToday(Date.parse('2026-10-21T22:30:00Z'), 'UTC')).toBe('2026-10-21');
  });
  it('falls back to UTC for an unknown zone instead of failing', () => {
    expect(new Date(zonedInstant('2026-07-01', '08:00', 'Not/AZone')).toISOString()).toBe('2026-07-01T08:00:00.000Z');
  });
});

describe('settings', () => {
  it('fills in defaults and drops bad values', () => {
    expect(notifySettings(undefined)).toEqual(DEFAULT_NOTIFY);
    expect(notifySettings({ taskTime: '25:00', taskDays: [3, 0, 3, -1, 1.5, 'x'], meetingMinutes: 'no', details: false }))
      .toEqual({ ...DEFAULT_NOTIFY, taskDays: [3, 0], details: false });
    expect(cleanDays([1, 2, 3, 5, 7, 14])).toEqual([14, 7, 5, 3]);
    expect(cleanDays(null)).toBeNull();
    expect(cleanDays([])).toEqual([]);
  });
});

describe('remindersBetween', () => {
  it('reminds on the due date at 08:00 by default, and not for closed tasks', () => {
    const r = remindersBetween(data({ tasks: [task(), task({ id: 't2', status: 'done' }), task({ id: 't3', status: 'waiting' })] }), ...day('2026-10-22'));
    expect(r.map((x) => [x.id, new Date(x.at).toISOString()])).toEqual([['t1', '2026-10-22T06:00:00.000Z'], ['t3', '2026-10-22T06:00:00.000Z']]);
    expect(r[0]).toMatchObject({ kind: 'task', lead: 0, client: 'Fjordlys AS', key: 't:t1:2026-10-22:0' });
  });

  it('adds earlier reminders, from the task, else its schedule, else the default', () => {
    const settings = { ...DEFAULT_NOTIFY, taskDays: [3, 0], taskTime: '07:30' };
    const tasks = [task(), task({ id: 't2', scheduleId: 's1' }), task({ id: 't3', scheduleId: 's1', notifyDays: [1] }), task({ id: 't4', notifyDays: [] })];
    const all = remindersBetween(data({ tasks, settings, schedules: [{ id: 's1', notifyDays: [7] }] }), ...[day('2026-10-01')[0], day('2026-10-31')[1]] as [number, number]);
    expect(all.map((r) => `${r.id}:${r.lead}:${new Date(r.at).toISOString().slice(0, 16)}`)).toEqual([
      't2:7:2026-10-15T05:30', 't1:3:2026-10-19T05:30', 't3:1:2026-10-21T05:30', 't1:0:2026-10-22T05:30',
    ]);
  });

  it('reminds before meetings, by default 15 minutes', () => {
    const r = remindersBetween(data({ meetings: [meeting(), meeting({ id: 'm2', start: '14:00', end: '14:30', notifyMinutes: [60, 0], clientId: null })] }), ...day('2026-10-22'));
    expect(r.map((x) => `${x.id}:${x.lead}:${new Date(x.at).toISOString().slice(11, 16)}`)).toEqual(['m1:15:07:45', 'm2:60:11:00', 'm2:0:12:00']);
    expect(r[1].client).toBeNull();
  });

  it('is empty when notifications are paused, and the window is half-open', () => {
    expect(remindersBetween(data({ tasks: [task()], settings: { ...DEFAULT_NOTIFY, enabled: false } }), ...day('2026-10-22'))).toEqual([]);
    const at = zonedInstant('2026-10-22', '08:00', OSLO);
    expect(remindersBetween(data({ tasks: [task()] }), at - 1, at)).toHaveLength(1);
    expect(remindersBetween(data({ tasks: [task()] }), at, at + 1)).toHaveLength(0);
  });

  it('gives a moved task a fresh key, so it reminds again', () => {
    const [a] = remindersBetween(data({ tasks: [task()] }), ...day('2026-10-22'));
    const [b] = remindersBetween(data({ tasks: [task({ dueDate: '2026-10-23' })] }), ...day('2026-10-23'));
    expect(a.key).not.toBe(b.key);
  });
});

describe('messagesFor', () => {
  const at = (d = '2026-10-22') => day(d);
  it('says what is due, and for which client', () => {
    const [m] = messagesFor(remindersBetween(data({ tasks: [task()] }), ...at()), true);
    expect(m).toMatchObject({ title: 'Due today: Deliver VAT', body: 'Fjordlys AS', url: '/tasks?task=t1', tag: 'ledger-task-t1' });
    const [early] = messagesFor(remindersBetween(data({ tasks: [task({ notifyDays: [3] })] }), ...at('2026-10-19')), true);
    expect(early).toMatchObject({ title: 'Due in 3 days: Deliver VAT', body: 'Fjordlys AS · Thu 22 Oct' });
  });

  it('groups tasks that fall due together into one notification', () => {
    const tasks = [task(), task({ id: 't2', title: 'Run payroll', clientId: 'c2' }), task({ id: 't3', title: 'Reconcile bank', dueDate: '2026-10-23', notifyDays: [1] })];
    const [m] = messagesFor(remindersBetween(data({ tasks }), ...at()), true);
    expect(m.title).toBe('3 tasks coming up');
    expect(m.body.split('\n')).toEqual(['Deliver VAT · Fjordlys AS (due today)', 'Reconcile bank · Fjordlys AS (due tomorrow)', 'Run payroll · Nordlys Bygg AS (due today)']);
    expect(m.keys).toHaveLength(3);
    const [same] = messagesFor(remindersBetween(data({ tasks: tasks.slice(0, 2) }), ...at()), true);
    expect(same.title).toBe('2 tasks due today');
  });

  it('describes meetings', () => {
    const ms = messagesFor(remindersBetween(data({ meetings: [meeting({ notifyMinutes: [1440, 60, 15, 0] })] }), Date.parse('2026-10-20T00:00:00Z'), Date.parse('2026-10-23T00:00:00Z')), true);
    expect(ms.map((m) => m.title)).toEqual(['Tomorrow at 10:00: Budget review', 'In 1 hour: Budget review', 'In 15 min: Budget review', 'Now: Budget review']);
    expect(ms[0]).toMatchObject({ body: '10:00–11:00 · Fjordlys AS · Teams', url: '/calendar?view=day&date=2026-10-22&meeting=m1' });
  });

  it('leaves names out when details are off', () => {
    const ms = messagesFor(remindersBetween(data({ tasks: [task()], meetings: [meeting({ notifyMinutes: [0] })] }), ...at()), false);
    expect(ms.map((m) => `${m.title} | ${m.body}`)).toEqual(['Meeting now | 10:00–11:00', 'A task is due today | Open Ledger to see it.']);
    expect(JSON.stringify(ms)).not.toMatch(/Fjordlys|Deliver|Budget/);
  });
});

describe('descriptions', () => {
  it('reads naturally', () => {
    expect(describeDays([0], '08:00')).toBe('On the day at 08:00');
    expect(describeDays([7, 0, 1])).toBe('On the day, 1 day before and 1 week before');
    expect(describeDays([])).toBe('No notifications');
    expect(describeMinutes([15])).toBe('15 min before');
    expect(describeMinutes([0, 60, 1440])).toBe('When it starts, 1 hour before and 1 day before');
  });
});
