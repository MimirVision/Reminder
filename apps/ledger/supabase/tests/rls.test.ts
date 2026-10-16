import { describe, expect, it, beforeAll } from 'vitest';
import { ledgerDb, A, B, rejects } from './db';

const monthly = { kind: 'month_offset', from: 'end', months: 1, day: 10 };

describe('Ledger database: isolation and integrity', () => {
  let t: Awaited<ReturnType<typeof ledgerDb>>;
  let wsA: string, wsB: string, clientA: string, scheduleA: string;

  beforeAll(async () => {
    t = await ledgerDb();
    wsA = (await t.as(A, () => t.one<{ id: string }>(`select (public.ledger_my_workspace()).id`))).id;
    wsB = (await t.as(B, () => t.one<{ id: string }>(`select (public.ledger_my_workspace()).id`))).id;
    await t.as(A, async () => {
      clientA = (await t.one<{ id: string }>(`insert into ledger_clients (workspace_id, name, reference) values ($1, 'Fjordline Bakeri AS', 'FB-01') returning id`, [wsA])).id;
      scheduleA = (await t.one<{ id: string }>(
        `insert into ledger_schedules (workspace_id, client_id, title, frequency, unit, interval_count, due_rule, start_date, generate_from)
         values ($1, $2, 'Monthly bookkeeping', 'monthly', 'month', 1, $3, '2026-01-01', '2026-01-01') returning id`, [wsA, clientA, JSON.stringify(monthly)])).id;
      await t.one(`insert into ledger_occurrences (workspace_id, client_id, title, due_date) values ($1, $2, 'Call about receipts', '2026-10-20') returning id`, [wsA, clientA]);
    });
  });

  it('creates one workspace per person, idempotently', async () => {
    const again = await t.as(A, () => t.one<{ id: string }>(`select (public.ledger_my_workspace()).id`));
    expect(again.id).toBe(wsA);
    expect(wsA).not.toBe(wsB);
  });

  it('hides one person’s data from another', async () => {
    await t.as(B, async () => {
      for (const table of ['ledger_clients', 'ledger_schedules', 'ledger_occurrences', 'ledger_activity', 'ledger_reviews']) {
        expect((await t.all(`select * from ${table}`)).length, table).toBe(0);
      }
      expect((await t.all(`select * from ledger_workspaces`)).map((r) => r.id)).toEqual([wsB]);
      await rejects(t.db.query(`insert into ledger_clients (workspace_id, name) values ($1, 'Intruder')`, [wsA]), /row-level security/);
      // Updates and deletes on someone else's rows silently match nothing.
      await t.db.query(`update ledger_clients set name = 'Hacked' where id = $1`, [clientA]);
      await t.db.query(`delete from ledger_occurrences where workspace_id = $1`, [wsA]);
    });
    await t.as(A, async () => {
      expect((await t.one(`select name from ledger_clients where id = $1`, [clientA]))?.name).toBe('Fjordline Bakeri AS');
      expect((await t.all(`select * from ledger_occurrences`)).length).toBe(1);
    });
  });

  it('gives signed-out visitors nothing', async () => {
    await t.as(null, async () => {
      await rejects(t.db.query(`select * from ledger_clients`), /permission denied/);
      await rejects(t.db.query(`select public.ledger_generate()`), /permission denied/);
    });
  });

  it('does not let a person write history or generation runs directly', async () => {
    await t.as(A, async () => {
      await rejects(t.db.query(`insert into ledger_activity (workspace_id, entity, entity_id, action) values ($1, 'client', $2, 'fake')`, [wsA, clientA]), /permission denied/);
      await rejects(t.db.query(`insert into ledger_generation_runs (workspace_id, trigger) values ($1, 'app')`, [wsA]), /permission denied/);
      await rejects(t.db.query(`select public.ledger_generate_all()`), /permission denied/);
      await rejects(t.db.query(`select public.ledger_generate_for($1, 'app')`, [wsB]), /permission denied/);
    });
  });

  it('records history for task changes with the actor', async () => {
    await t.as(A, async () => {
      const o = await t.one<{ id: string }>(`select id from ledger_occurrences where schedule_id is null`);
      await t.db.query(`update ledger_occurrences set status = 'waiting', due_date = '2026-10-22' where id = $1`, [o.id]);
      const log = await t.all<{ action: string; actor_id: string; details: { from: string; to: string } }>(
        `select action, actor_id, details from ledger_activity where entity_id = $1 order by id`, [o.id]);
      expect(log.map((l) => l.action)).toEqual(['created', 'status', 'rescheduled']);
      expect(log[1].details).toMatchObject({ from: 'todo', to: 'waiting' });
      expect(log[2].details).toMatchObject({ from: '2026-10-20', to: '2026-10-22' });
      expect(log.every((l) => l.actor_id === A)).toBe(true);
    });
  });

  it('sets and clears completed_at with the status', async () => {
    await t.as(A, async () => {
      const o = await t.one<{ id: string }>(`select id from ledger_occurrences where schedule_id is null`);
      const done = await t.one<{ completed_at: string | null }>(`update ledger_occurrences set status = 'done' where id = $1 returning completed_at`, [o.id]);
      expect(done.completed_at).not.toBeNull();
      const reopened = await t.one<{ completed_at: string | null }>(`update ledger_occurrences set status = 'todo' where id = $1 returning completed_at`, [o.id]);
      expect(reopened.completed_at).toBeNull();
    });
  });

  it('validates input in the database', async () => {
    await t.as(A, async () => {
      await rejects(t.db.query(`insert into ledger_clients (workspace_id, name) values ($1, '   ')`, [wsA]), /check constraint/);
      await rejects(t.db.query(`insert into ledger_clients (workspace_id, name, reference) values ($1, 'Other', 'fb-01')`, [wsA]), /duplicate key/);
      await rejects(t.db.query(`insert into ledger_occurrences (workspace_id, client_id, title, due_date, status) values ($1, $2, 'x', '2026-01-01', 'finished')`, [wsA, clientA]), /check constraint/);
      await rejects(t.db.query(
        `insert into ledger_schedules (workspace_id, client_id, title, frequency, unit, interval_count, due_rule, start_date)
         values ($1, $2, 'Bad rule', 'monthly', 'month', 1, '{"kind":"month_offset","from":"end","months":1,"day":40}', '2026-01-01')`, [wsA, clientA]), /ledger_schedules_due_rule/);
      await rejects(t.db.query(
        `insert into ledger_schedules (workspace_id, client_id, title, frequency, unit, interval_count, due_rule, start_date)
         values ($1, $2, 'Mismatch', 'quarterly', 'month', 1, $3, '2026-01-01')`, [wsA, clientA, JSON.stringify(monthly)]), /ledger_schedules_frequency/);
      await rejects(t.db.query(
        `insert into ledger_schedules (workspace_id, client_id, title, frequency, unit, interval_count, due_rule, start_date, end_date)
         values ($1, $2, 'Backwards', 'monthly', 'month', 1, $3, '2026-05-01', '2026-01-01')`, [wsA, clientA, JSON.stringify(monthly)]), /ledger_schedules_dates/);
      await rejects(t.db.query(`insert into ledger_reviews (workspace_id, schedule_id, period_key, status) values ($1, $2, 'M1:2026-01-01', 'exception')`, [wsA, scheduleA]), /exception_note/);
      await rejects(t.db.query(`update ledger_workspaces set timezone = 'Mars/Olympus' where id = $1`, [wsA]), /time zone/);
    });
  });

  it('keeps schedule tasks: they can be cancelled but not deleted, and archiving a client keeps its history', async () => {
    await t.as(A, async () => {
      await t.db.query(`select public.ledger_generate()`);
      const generated = await t.all<{ id: string }>(`select id from ledger_occurrences where schedule_id = $1`, [scheduleA]);
      expect(generated.length).toBeGreaterThan(0);
      await t.db.query(`delete from ledger_occurrences where id = $1`, [generated[0].id]);
      expect((await t.all(`select id from ledger_occurrences where id = $1`, [generated[0].id])).length).toBe(1);
      await rejects(t.db.query(`delete from ledger_clients where id = $1`, [clientA]), /foreign key/);
      await t.db.query(`update ledger_clients set status = 'archived' where id = $1`, [clientA]);
      expect((await t.all(`select id from ledger_occurrences where client_id = $1`, [clientA])).length).toBe(generated.length + 1);
    });
  });

  it('refuses to change how often a schedule repeats once it has tasks', async () => {
    await t.as(A, async () => {
      await rejects(t.db.query(`update ledger_schedules set frequency = 'quarterly', interval_count = 3 where id = $1`, [scheduleA]), /cannot change once it has tasks/);
      await t.db.query(`update ledger_schedules set title = 'Monthly bookkeeping and reconciliation' where id = $1`, [scheduleA]);
    });
  });

  it('refuses to move a task to another period or schedule', async () => {
    await t.as(A, async () => {
      const o = await t.one<{ id: string }>(`select id from ledger_occurrences where schedule_id = $1 limit 1`, [scheduleA]);
      await rejects(t.db.query(`update ledger_occurrences set period_key = 'M1:2030-01-01' where id = $1`, [o.id]), /cannot change/);
    });
  });

  it('erases a workspace only with the right confirmation', async () => {
    await t.as(B, async () => {
      await rejects(t.db.query(`select public.ledger_erase_workspace($1)`, [wsA]), /confirmation/);
    });
    await t.as(A, async () => {
      expect((await t.all(`select id from ledger_clients`)).length).toBe(1);
    });
  });
});
