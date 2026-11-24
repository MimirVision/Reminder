import { describe, expect, it } from 'vitest';
import { clientLoad, dueByDay, groupOf, monthPace, niceMax, onTimeRate, typeMix, weeklyLoad } from './insights';
import type { Occurrence } from './types';

const T = '2026-11-18'; // a Wednesday
let n = 0;
const task = (o: Partial<Occurrence>): Occurrence => ({
  id: `t${++n}`, workspaceId: 'w', clientId: 'c1', scheduleId: null, title: 'Task', description: '', taskType: 'bookkeeping', periodKey: null,
  periodStart: null, periodEnd: null, dueDate: T, scheduledDueDate: null, status: 'todo', priority: 'normal', tags: [], completedAt: null,
  checklist: [], waitingSince: null, createdAt: '', updatedAt: '', ...o,
});
const done = (due: string, on: string, o: Partial<Occurrence> = {}) => task({ dueDate: due, status: 'done', completedAt: `${on}T10:00:00`, ...o });

describe('insights', () => {
  it('groups task types into five colours and Other', () => {
    expect(['annual', 'tax', 'follow_up', 'other', 'vat'].map((t) => groupOf(t as Occurrence['taskType']))).toEqual(['yearEnd', 'yearEnd', 'other', 'other', 'vat']);
  });

  it('counts open work per week ahead, with overdue work in this week', () => {
    const w = weeklyLoad([task({ dueDate: '2026-11-10' }), task({ dueDate: '2026-11-20', taskType: 'vat' }), task({ dueDate: '2026-11-23', taskType: 'tax' }),
      task({ dueDate: '2026-11-23', status: 'done' }), task({ dueDate: '2027-03-01' })], T, 3);
    expect(w.map((x) => [x.start, x.total, x.overdue])).toEqual([['2026-11-16', 2, 1], ['2026-11-23', 1, 0], ['2026-11-30', 0, 0]]);
    expect(w[0].counts).toMatchObject({ bookkeeping: 1, vat: 1 });
    expect(w[1].counts.yearEnd).toBe(1);
  });

  it('counts deadlines per day, leaving out cancelled tasks', () => {
    const m = dueByDay([task({}), done(T, T), task({ status: 'cancelled' }), task({ dueDate: '2026-12-31' })], '2026-11-01', '2026-11-30');
    expect(m.get(T)).toEqual({ date: T, due: 2, done: 1, open: 1 });
    expect(m.size).toBe(1);
  });

  it('follows the month: due so far against done so far, stopping at today', () => {
    const p = monthPace([done('2026-11-05', '2026-11-04'), done('2026-11-10', '2026-11-12'), task({ dueDate: '2026-11-25' }), task({ dueDate: '2026-12-01' })], T);
    expect(p.total).toBe(3);
    expect(p.doneNow).toBe(2);
    const day = (d: string) => p.days.find((x) => x.date === d)!;
    expect(day('2026-11-05')).toEqual({ date: '2026-11-05', due: 1, done: 1 });
    expect(day('2026-11-11')).toEqual({ date: '2026-11-11', due: 2, done: 1 });
    expect(day('2026-11-30')).toEqual({ date: '2026-11-30', due: 3, done: null });
    expect(p.days).toHaveLength(30);
  });

  it('works out the on-time rate and compares it with the 90 days before', () => {
    const r = onTimeRate([done('2026-11-10', '2026-11-09'), done('2026-11-10', '2026-11-12'), done('2026-11-01', '2026-11-01'), done('2026-07-01', '2026-07-02')], T);
    expect(r.rate).toBeCloseTo(2 / 3);
    expect(r.previous).toBe(0);
    expect(r.finished).toBe(3);
    expect(r.weekly).toHaveLength(12);
    expect(r.weekly[11]).toBeNull();
    expect(r.weekly[10]).toBe(0.5);
  });

  it('ranks types and clients by open work', () => {
    expect(typeMix([task({ taskType: 'other' }), task({ taskType: 'vat', dueDate: '2026-11-01' }), task({ taskType: 'vat' }), task({})], T))
      .toEqual([{ group: 'vat', open: 2, overdue: 1 }, { group: 'bookkeeping', open: 1, overdue: 0 }, { group: 'other', open: 1, overdue: 0 }]);
    expect(clientLoad([task({ clientId: 'a', dueDate: '2026-11-01' }), task({ clientId: 'b' }), task({ clientId: 'b', dueDate: '2026-11-30' }), task({ clientId: 'c', dueDate: '2027-02-01' })], T))
      .toEqual([{ clientId: 'b', open: 2, overdue: 0, soon: 2, next: T }, { clientId: 'a', open: 1, overdue: 1, soon: 0, next: null }]);
  });

  it('picks clean axis maximums', () => {
    expect([0, 3, 7, 23, 48, 130].map((x) => niceMax(x).max)).toEqual([4, 3, 8, 25, 50, 150]);
  });
});
