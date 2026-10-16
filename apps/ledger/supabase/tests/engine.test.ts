// The database engine: TypeScript and SQL must agree on every period and due date, and generation must be idempotent,
// respect pauses and the creation window, survive a failing schedule and catch up after missed runs.
import { beforeAll, describe, expect, it } from 'vitest';
import { addDays, todayIn } from '../../src/lib/dates';
import { listPeriods } from '../../src/lib/recurrence';
import { planGeneration } from '../../src/lib/generation';
import type { DueRule, Recurrence, Schedule } from '../../src/lib/types';
import { A, ledgerDb } from './db';

// A small deterministic random generator, so a failure can be reproduced.
function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
}

function randomRecurrence(r: () => number): Recurrence {
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const unit = r() < 0.25 ? 'week' : 'month';
  const interval = unit === 'week' ? pick([1, 1, 2, 3, 4]) : pick([1, 1, 2, 3, 3, 4, 6, 12, 12, 5]);
  const y = 2023 + Math.floor(r() * 5);
  const startDate = `${y}-${String(1 + Math.floor(r() * 12)).padStart(2, '0')}-${String(1 + Math.floor(r() * 28)).padStart(2, '0')}`;
  const adjust = pick(['none', 'next_business_day', 'previous_business_day', undefined] as const);
  const rules: DueRule[] = [
    { kind: 'month_offset', from: pick(['start', 'end'] as const), months: Math.floor(r() * 8), day: r() < 0.2 ? 'last' : 1 + Math.floor(r() * 31), adjust },
    { kind: 'days_after_end', days: Math.floor(r() * 60), adjust },
  ];
  if (unit === 'week') rules.push({ kind: 'weekday', weekday: 1 + Math.floor(r() * 7), adjust });
  return {
    unit, interval, anchorMonth: 1 + Math.floor(r() * 12), startDate,
    endDate: r() < 0.3 ? addDays(startDate, Math.floor(r() * 900)) : null,
    dueRule: pick(rules),
  };
}

describe('TypeScript and SQL recurrence agree', () => {
  let t: Awaited<ReturnType<typeof ledgerDb>>;
  beforeAll(async () => { t = await ledgerDb(); });

  it('on 300 random schedules, including leap years and month ends', async () => {
    const r = rng(20261016);
    for (let n = 0; n < 300; n++) {
      const rec = randomRecurrence(r);
      const through = addDays(rec.startDate, 200 + Math.floor(r() * 1200));
      const ts = listPeriods(rec, through);
      const sql = await t.all<{ period_key: string; period_start: string; period_end: string; due_date: string }>(
        `select period_key, to_char(period_start, 'YYYY-MM-DD') period_start, to_char(period_end, 'YYYY-MM-DD') period_end,
                to_char(due_date, 'YYYY-MM-DD') due_date
         from public.ledger_periods($1, $2, $3, $4, $5, $6, $7)`,
        [rec.unit, rec.interval, rec.anchorMonth, rec.startDate, rec.endDate, JSON.stringify(rec.dueRule), through]);
      expect(sql.map((p) => [p.period_key, p.period_start, p.period_end, p.due_date]), JSON.stringify(rec))
        .toEqual(ts.map((p) => [p.key, p.start, p.end, p.due]));
    }
  });
});

describe('Database generation', () => {
  let t: Awaited<ReturnType<typeof ledgerDb>>;
  let ws: string, client: string;
  const today = todayIn('Europe/Oslo');

  async function schedule(fields: Partial<Record<string, unknown>> = {}) {
    const f: Record<string, unknown> = {
      title: 'Monthly bookkeeping', frequency: 'monthly', unit: 'month', interval_count: 1, anchor_month: 1,
      due_rule: { kind: 'month_offset', from: 'end', months: 1, day: 10 }, start_date: addDays(today, -400),
      generate_from: addDays(today, -120), lead_days: 21, ...fields,
    };
    return (await t.one<{ id: string }>(
      `insert into ledger_schedules (workspace_id, client_id, title, frequency, unit, interval_count, anchor_month, due_rule, start_date, generate_from, lead_days, auto_generate, end_date)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) returning id`,
      [ws, client, f.title, f.frequency, f.unit, f.interval_count, f.anchor_month, JSON.stringify(f.due_rule), f.start_date, f.generate_from, f.lead_days, f.auto_generate ?? true, f.end_date ?? null])).id;
  }
  const count = async (sid: string) => Number((await t.one<{ n: number }>(`select count(*)::int n from ledger_occurrences where schedule_id = $1`, [sid])).n);
  const generate = () => t.one<{ n: number }>(`select public.ledger_generate() n`).then((r) => Number(r.n));

  beforeAll(async () => {
    t = await ledgerDb();
    await t.as(A, async () => {
      ws = (await t.one<{ id: string }>(`select (public.ledger_my_workspace()).id`)).id;
      client = (await t.one<{ id: string }>(`insert into ledger_clients (workspace_id, name) values ($1, 'Nordlys Rørlegger AS') returning id`, [ws])).id;
    });
  });

  it('creates what the TypeScript planner expects, then nothing on repeat runs', async () => {
    await t.as(A, async () => {
      const sid = await schedule();
      const first = await generate();
      const s = { id: sid, clientId: client, title: 'Monthly bookkeeping', description: '', taskType: 'other', frequency: 'monthly',
        unit: 'month', interval: 1, anchorMonth: 1, dueRule: { kind: 'month_offset', from: 'end', months: 1, day: 10 },
        startDate: addDays(today, -400), endDate: null, generateFrom: addDays(today, -120), leadDays: 21, reminderDays: null,
        autoGenerate: true, status: 'active', defaultPriority: 'normal' } as unknown as Schedule;
      const planned = planGeneration([s], [], [], today);
      expect(first).toBe(planned.length);
      const keys = (await t.all<{ period_key: string }>(`select period_key from ledger_occurrences where schedule_id = $1 order by period_key`, [sid])).map((r) => r.period_key);
      expect(keys).toEqual(planned.map((p) => p.periodKey).sort());
      expect(await generate()).toBe(0);
      expect(await generate()).toBe(0);
      expect(await count(sid)).toBe(planned.length);
    });
  });

  it('never creates periods due before generate_from, nor beyond the lead window', async () => {
    await t.as(A, async () => {
      const sid = await schedule({ title: 'Window', lead_days: 0 });
      await generate();
      const rows = await t.all<{ due: string }>(`select to_char(due_date, 'YYYY-MM-DD') due from ledger_occurrences where schedule_id = $1`, [sid]);
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) {
        expect(r.due >= addDays(today, -120)).toBe(true);
        expect(r.due <= today).toBe(true);
      }
    });
  });

  it('skips periods due while paused, and creates them again after resuming', async () => {
    await t.as(A, async () => {
      const sid = await schedule({ title: 'Paused', generate_from: addDays(today, -1), lead_days: 60 });
      await t.db.query(`select public.ledger_set_paused($1, true, $2)`, [sid, addDays(today, -5)]);
      expect((await t.one<{ status: string }>(`select status from ledger_schedules where id = $1`, [sid])).status).toBe('paused');
      await generate();
      expect(await count(sid)).toBe(0);
      await t.db.query(`select public.ledger_set_paused($1, false, $2)`, [sid, today]);
      await generate();
      expect(await count(sid)).toBeGreaterThan(0);
      const pauses = await t.all(`select * from ledger_schedule_pauses where schedule_id = $1`, [sid]);
      expect(pauses.length).toBe(1);
    });
  });

  it('does not generate for schedules with automatic creation off or archived clients', async () => {
    await t.as(A, async () => {
      const sid = await schedule({ title: 'Check only', auto_generate: false });
      await generate();
      expect(await count(sid)).toBe(0);
      const other = (await t.one<{ id: string }>(`insert into ledger_clients (workspace_id, name, status) values ($1, 'Gone AS', 'archived') returning id`, [ws])).id;
      const archived = (await t.one<{ id: string }>(
        `insert into ledger_schedules (workspace_id, client_id, title, frequency, unit, interval_count, due_rule, start_date, generate_from)
         values ($1, $2, 'Archived', 'monthly', 'month', 1, '{"kind":"month_offset","from":"end","months":1,"day":10}', $3, $3) returning id`,
        [ws, other, addDays(today, -200)])).id;
      await generate();
      expect(await count(archived)).toBe(0);
    });
  });

  it('records a failing schedule and still generates the others', async () => {
    await t.db.exec(`alter table ledger_schedules drop constraint ledger_schedules_due_rule`);
    try {
      await t.as(A, async () => {
        const bad = await schedule({ title: 'Broken', due_rule: { kind: 'lunar_cycle' } });
        const good = await schedule({ title: 'Healthy', generate_from: addDays(today, -60) });
        await generate();
        expect(await count(good)).toBeGreaterThan(0);
        const run = await t.one<{ errors: { scheduleId: string; message: string }[] }>(`select errors from ledger_generation_runs order by id desc limit 1`);
        expect(run.errors).toEqual([{ scheduleId: bad, message: expect.stringMatching(/unknown due-date rule/) }]);
        await t.db.query(`delete from ledger_schedules where id = $1`, [bad]);
      });
    } finally {
      await t.db.exec(`alter table ledger_schedules add constraint ledger_schedules_due_rule check (public.ledger_due_rule_ok(due_rule, unit))`);
    }
  });

  it('catches up after missed runs: a deleted backlog is restored only for open windows, never duplicated', async () => {
    await t.as(A, async () => {
      const sid = await schedule({ title: 'Catch-up', generate_from: addDays(today, -365) });
      // Nothing ran for a year. One run creates the whole backlog at once.
      const created = await generate();
      expect(created).toBeGreaterThanOrEqual(11);
      const n = await count(sid);
      await Promise.all([generate(), generate(), generate()]);
      expect(await count(sid)).toBe(n);
      const dupes = await t.one<{ n: number }>(`select count(*)::int n from (select schedule_id, period_key from ledger_occurrences where schedule_id is not null group by 1, 2 having count(*) > 1) d`);
      expect(Number(dupes.n)).toBe(0);
    });
  });

  it('ending a schedule cancels later open tasks only when asked, never completed ones', async () => {
    await t.as(A, async () => {
      const sid = await schedule({ title: 'Ending', generate_from: addDays(today, -200), lead_days: 90 });
      await generate();
      const rows = await t.all<{ id: string; period_start: string }>(`select id, to_char(period_start, 'YYYY-MM-DD') period_start from ledger_occurrences where schedule_id = $1 order by period_start`, [sid]);
      expect(rows.length).toBeGreaterThan(3);
      const endOn = addDays(rows[rows.length - 3].period_start, 1);
      await t.db.query(`update ledger_occurrences set status = 'done' where id = $1`, [rows[rows.length - 1].id]);
      const cancelled = await t.one<{ n: number }>(`select public.ledger_end_schedule($1, $2, true) n`, [sid, endOn]);
      expect(Number(cancelled.n)).toBe(1);
      const statuses = (await t.all<{ status: string }>(`select status from ledger_occurrences where schedule_id = $1 order by period_start`, [sid])).map((r) => r.status);
      expect(statuses.slice(-3)).toEqual(['todo', 'cancelled', 'done']);
      expect((await t.one<{ status: string }>(`select status from ledger_schedules where id = $1`, [sid])).status).toBe('ended');
      expect(await generate()).toBe(0);
    });
  });

  it('applies an edited due-date rule to open future tasks only, keeping hand-moved dates and edited titles', async () => {
    await t.as(A, async () => {
      const sid = await schedule({ title: 'Apply', generate_from: addDays(today, -100), lead_days: 70 });
      await generate();
      const rows = await t.all<{ id: string; due: string }>(`select id, to_char(due_date, 'YYYY-MM-DD') due from ledger_occurrences where schedule_id = $1 order by due_date`, [sid]);
      const [past, ...future] = rows;
      const open = future.filter((r) => r.due >= today);
      expect(open.length).toBeGreaterThanOrEqual(2);
      await t.db.query(`update ledger_occurrences set status = 'done' where id = $1`, [past.id]);
      await t.db.query(`update ledger_occurrences set due_date = due_date + 3 where id = $1`, [open[0].id]);
      await t.db.query(`update ledger_occurrences set title = 'Apply (special)' where id = $1`, [open[1].id]);
      await t.db.query(`update ledger_schedules set title = 'Apply v2', due_rule = '{"kind":"month_offset","from":"end","months":1,"day":20}' where id = $1`, [sid]);
      await t.db.query(`select public.ledger_apply_schedule($1, $2, 'Apply', '')`, [sid, today]);
      const after = new Map((await t.all<{ id: string; due: string; title: string; sched: string }>(
        `select id, to_char(due_date, 'YYYY-MM-DD') due, title, to_char(scheduled_due_date, 'YYYY-MM-DD') sched from ledger_occurrences where schedule_id = $1`, [sid])).map((r) => [r.id, r]));
      expect(after.get(past.id)?.due).toBe(past.due);
      expect(after.get(past.id)?.title).toBe('Apply');
      expect(after.get(open[0].id)?.due).toBe(addDays(open[0].due, 3));
      expect(after.get(open[0].id)?.sched?.endsWith('-20')).toBe(true);
      expect(after.get(open[1].id)?.title).toBe('Apply (special)');
      expect(after.get(open[1].id)?.due.endsWith('-20')).toBe(true);
    });
  });
});
