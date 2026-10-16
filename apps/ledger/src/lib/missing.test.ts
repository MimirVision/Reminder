import { describe, expect, it } from 'vitest';
import { detectExpected, needsReview } from './missing';
import { planGeneration, liveSchedules } from './generation';
import type { Occurrence, Pause, Review, Schedule } from './types';

const today = '2026-10-16';
const base: Schedule = {
  id: 's1', workspaceId: 'w', clientId: 'c1', title: 'Monthly bookkeeping', description: '', taskType: 'bookkeeping',
  frequency: 'monthly', unit: 'month', interval: 1, anchorMonth: 1,
  dueRule: { kind: 'month_offset', from: 'end', months: 1, day: 10 },
  startDate: '2026-06-01', endDate: null, generateFrom: '2026-08-01', leadDays: 14, reminderDays: null,
  autoGenerate: true, status: 'active', defaultPriority: 'normal', createdAt: '', updatedAt: '',
};
const occ = (o: Partial<Occurrence>): Occurrence => ({
  id: Math.random().toString(36), workspaceId: 'w', clientId: 'c1', scheduleId: 's1', title: 't', description: '', taskType: 'other',
  periodKey: null, periodStart: null, periodEnd: null, dueDate: today, scheduledDueDate: null, status: 'todo', priority: 'normal',
  tags: [], completedAt: null, createdAt: '', updatedAt: '', ...o,
});
const run = (input: { schedules?: Schedule[]; occurrences?: Occurrence[]; reviews?: Review[]; pauses?: Pause[] }) =>
  detectExpected({ schedules: [base], occurrences: [], reviews: [], pauses: [], runs: [], ...input }, today);

describe('generation plan', () => {
  it('creates periods due from generate_from whose creation date has come, once', () => {
    // Periods Jun..Oct; due 10 Jul, 10 Aug, 10 Sep, 10 Oct, 10 Nov (created 27 Oct, not yet).
    const plan = planGeneration([base], [], [], today);
    expect(plan.map((p) => p.dueDate)).toEqual(['2026-08-10', '2026-09-10', '2026-10-10']);
    const existing = plan.map((p, i) => occ({ ...p, id: `o${i}` }));
    expect(planGeneration([base], [], existing, today)).toEqual([]);
  });

  it('skips archived clients', () => {
    expect(liveSchedules([base], [{ id: 'c1', status: 'archived' }])).toEqual([]);
  });
});

describe('missing-task detection', () => {
  it('flags periods due before the schedule started creating tasks as missing, with a reason', () => {
    const items = run({});
    const jul = items.find((i) => i.period.key === 'M1:2026-06-01');
    expect(jul?.state).toBe('missing');
    expect(jul?.reason).toMatch(/before this schedule started creating tasks/);
  });

  it('flags a period the generator should have created as a generation failure', () => {
    const items = run({});
    expect(items.filter((i) => i.state === 'generation_failure').map((i) => i.period.due)).toEqual(['2026-08-10', '2026-09-10', '2026-10-10']);
  });

  it('is quiet once the occurrences exist, including cancelled ones', () => {
    const occurrences = planGeneration([base], [], [], today).map((p) => occ({ ...p, status: 'cancelled' }));
    occurrences.push(occ({ periodKey: 'M1:2026-06-01' }));
    const items = run({ occurrences });
    expect(needsReview(items)).toEqual([]);
    expect(items.map((i) => i.state)).toEqual(['not_yet_due']);
    expect(items[0].period.due).toBe('2026-11-10');
    expect(items[0].reason).toMatch(/Will be created on 27 Oct 2026/);
  });

  it('respects reviews and exceptions', () => {
    const reviews: Review[] = [
      { id: 'r', workspaceId: 'w', scheduleId: 's1', periodKey: 'M1:2026-06-01', status: 'exception', note: 'Client had no activity in June', createdAt: '', updatedAt: '' },
    ];
    const jul = run({ reviews }).find((i) => i.period.key === 'M1:2026-06-01');
    expect(jul?.state).toBe('exception');
    expect(jul?.reason).toBe('Exception recorded: Client had no activity in June');
  });

  it('does not expect anything for paused periods', () => {
    const pauses: Pause[] = [{ id: 'p', workspaceId: 'w', scheduleId: 's1', pausedFrom: '2026-07-01', resumedOn: '2026-09-01', createdAt: '' }];
    const due = run({ pauses }).filter((i) => i.state !== 'not_yet_due').map((i) => i.period.due);
    expect(due).toEqual(['2026-09-10', '2026-10-10']);
  });

  it('reports check-only schedules as missing rather than failures', () => {
    const items = run({ schedules: [{ ...base, autoGenerate: false }] });
    expect(new Set(needsReview(items).map((i) => i.state))).toEqual(new Set(['missing']));
    expect(needsReview(items)).toHaveLength(4);
  });
});
