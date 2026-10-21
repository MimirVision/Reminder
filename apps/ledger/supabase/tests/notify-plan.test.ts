// One scheduled run of ledger-notify: which reminders it announces from the rows it read.
import { describe, expect, it } from 'vitest';
import { messagesForClaimed, planRun, ttlFor, windowDates, type RunRows } from '../functions/ledger-notify/plan';

const now = Date.parse('2026-10-22T06:05:00Z'); // 08:05 in Oslo
const rows = (over: Partial<RunRows> = {}): RunRows => ({
  workspaces: [{ id: 'w1', timezone: 'Europe/Oslo', settings: {} }, { id: 'w2', timezone: 'Europe/Oslo', settings: { notifications: { enabled: false } } }],
  occurrences: [
    { id: 't1', workspace_id: 'w1', client_id: 'c1', schedule_id: null, title: 'Deliver VAT', due_date: '2026-10-22', status: 'todo', notify_days: null },
    { id: 't2', workspace_id: 'w2', client_id: 'c2', schedule_id: null, title: 'Run payroll', due_date: '2026-10-22', status: 'todo', notify_days: null },
  ],
  meetings: [{ id: 'm1', workspace_id: 'w1', client_id: null, title: 'Stand-up', meeting_date: '2026-10-22', start_time: '08:15:00', end_time: '08:30:00', location: '', notify_minutes: null }],
  schedules: [],
  clients: [{ id: 'c1', workspace_id: 'w1', name: 'Fjordlys AS' }, { id: 'c2', workspace_id: 'w2', name: 'Other AS' }],
  ...over,
});

describe('planRun', () => {
  it('announces what fell due in the last half hour, per workspace, and nothing for a paused one', () => {
    const plans = planRun(rows(), now);
    expect(plans).toHaveLength(1);
    expect(plans[0].reminders.map((r) => r.key)).toEqual(['t:t1:2026-10-22:0', 'm:m1:2026-10-22T08:15:15']);
  });

  it('drops reminders missed by more than 30 minutes', () => {
    expect(planRun(rows(), Date.parse('2026-10-22T06:31:00Z'))).toEqual([]);
  });

  it('uses the schedule’s own days when the task has none, and the workspace’s time', () => {
    const r = rows({
      workspaces: [{ id: 'w1', timezone: 'Europe/Oslo', settings: { notifications: { taskTime: '07:00', taskDays: [0] } } }],
      occurrences: [{ id: 't1', workspace_id: 'w1', client_id: 'c1', schedule_id: 's1', title: 'Deliver VAT', due_date: '2026-10-29', status: 'todo', notify_days: null }],
      schedules: [{ id: 's1', workspace_id: 'w1', notify_days: [7] }], meetings: [],
    });
    expect(planRun(r, Date.parse('2026-10-22T05:10:00Z'))[0].reminders.map((x) => x.key)).toEqual(['t:t1:2026-10-29:7']);
  });

  it('only sends what this run claimed', () => {
    const [plan] = planRun(rows(), now);
    expect(messagesForClaimed(plan, new Set(['t:t1:2026-10-22:0'])).map((m) => m.title)).toEqual(['Due today: Deliver VAT']);
    expect(messagesForClaimed(plan, new Set())).toEqual([]);
  });

  it('lets a meeting reminder expire when the meeting starts', () => {
    const [plan] = planRun(rows(), now);
    const msgs = messagesForClaimed(plan, new Set(plan.reminders.map((r) => r.key)));
    const meeting = msgs.find((m) => m.title.includes('Stand-up'))!;
    expect(ttlFor(meeting, now, plan.reminders)).toBe(10 * 60);
    expect(ttlFor(msgs.find((m) => m.title.includes('VAT'))!, now, plan.reminders)).toBe(12 * 3600);
  });

  it('reads a window wide enough for every lead', () => {
    expect(windowDates(now)).toEqual({ from: '2026-10-21', tasksTo: '2026-12-23', meetingsTo: '2026-10-30' });
  });
});
