// Ledger v3 in the database: checklists (and schedule templates copied into generated tasks), "waiting since",
// client contacts and documents, and holiday-aware due dates that agree with the TypeScript engine.
import { beforeAll, describe, expect, it } from 'vitest';
import { addDays, todayIn } from '../../src/lib/dates';
import { easter } from '../../src/lib/holidays';
import { listPeriods } from '../../src/lib/recurrence';
import type { DueRule, Recurrence } from '../../src/lib/types';
import { A, B, ledgerDb, rejects } from './db';

function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
}

describe('Holidays: TypeScript and SQL agree', () => {
  let t: Awaited<ReturnType<typeof ledgerDb>>;
  beforeAll(async () => { t = await ledgerDb(); });

  it('on Easter for every year from 1990 to 2100', async () => {
    const rows = await t.all<{ y: number; d: string }>(`select y, to_char(public.ledger_easter(y), 'YYYY-MM-DD') d from generate_series(1990, 2100) y`);
    for (const r of rows) expect(r.d, String(r.y)).toBe(easter(Number(r.y)));
  });

  it('on 300 random schedules that move off weekends and Norwegian holidays', async () => {
    const r = rng(17052026);
    const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
    for (let n = 0; n < 300; n++) {
      const unit = r() < 0.25 ? 'week' : 'month';
      const interval = unit === 'week' ? pick([1, 2]) : pick([1, 2, 3, 12]);
      const startDate = `${2024 + Math.floor(r() * 4)}-${String(1 + Math.floor(r() * 12)).padStart(2, '0')}-${String(1 + Math.floor(r() * 28)).padStart(2, '0')}`;
      const adjust = pick(['next_business_day', 'previous_business_day'] as const);
      const rules: DueRule[] = [
        { kind: 'month_offset', from: pick(['start', 'end'] as const), months: Math.floor(r() * 3), day: pick([1, 5, 10, 17, 25, 26, 31, 'last'] as (number | 'last')[]), adjust },
        { kind: 'days_after_end', days: Math.floor(r() * 40), adjust },
      ];
      if (unit === 'week') rules.push({ kind: 'weekday', weekday: 1 + Math.floor(r() * 7), adjust });
      const rec: Recurrence = { unit, interval, anchorMonth: 1, startDate, endDate: null, dueRule: pick(rules), holidays: 'NO' };
      const through = addDays(startDate, 400 + Math.floor(r() * 800));
      const ts = listPeriods(rec, through);
      const sql = await t.all<{ k: string; due: string }>(
        `select period_key k, to_char(due_date, 'YYYY-MM-DD') due from public.ledger_periods($1, $2, $3, $4, $5, $6, $7, 'NO')`,
        [rec.unit, rec.interval, rec.anchorMonth, rec.startDate, rec.endDate, JSON.stringify(rec.dueRule), through]);
      expect(sql.map((p) => [p.k, p.due]), JSON.stringify(rec)).toEqual(ts.map((p) => [p.key, p.due]));
    }
  });
});

describe('Database v3', () => {
  let t: Awaited<ReturnType<typeof ledgerDb>>;
  let ws: string, client: string;
  const today = todayIn('Europe/Oslo');

  beforeAll(async () => {
    t = await ledgerDb();
    await t.as(A, async () => {
      ws = (await t.one<{ id: string }>(`select (public.ledger_my_workspace()).id`)).id;
      client = (await t.one<{ id: string }>(`insert into ledger_clients (workspace_id, name) values ($1, 'Fjordlys Regnskap AS') returning id`, [ws])).id;
    });
  });

  const task = (fields = '') => t.one<{ id: string }>(
    `insert into ledger_occurrences (workspace_id, client_id, title, due_date${fields ? ', ' + fields.split('=')[0] : ''})
     values ($1, $2, 'Chase statements', $3${fields ? ', ' + fields.split('=')[1] : ''}) returning id`, [ws, client, today]).then((r) => r.id);

  it('reports its schema version, so the app can switch the new features on', async () => {
    await t.as(A, async () => {
      expect(Number((await t.one<{ v: number }>(`select public.ledger_schema_version() v`)).v)).toBeGreaterThanOrEqual(3);
    });
  });

  it('keeps "waiting since": set on becoming waiting, kept while waiting, cleared after', async () => {
    await t.as(A, async () => {
      const id = await task();
      const since = async () => (await t.one<{ s: string | null }>(`select waiting_since s from ledger_occurrences where id = $1`, [id])).s;
      expect(await since()).toBeNull();
      await t.db.query(`update ledger_occurrences set status = 'waiting' where id = $1`, [id]);
      const first = await since();
      expect(first).not.toBeNull();
      await t.db.query(`update ledger_occurrences set title = 'Chase bank statements', waiting_since = now() - interval '9 days' where id = $1`, [id]);
      expect(await since()).toEqual(first);
      await t.db.query(`update ledger_occurrences set status = 'in_progress' where id = $1`, [id]);
      expect(await since()).toBeNull();
      // A restored backup keeps its own date.
      const restored = await task(`status, waiting_since='waiting', '2026-01-05T09:00:00Z'`);
      expect(String((await t.one<{ s: string }>(`select to_char(waiting_since at time zone 'UTC', 'YYYY-MM-DD') s from ledger_occurrences where id = $1`, [restored])).s)).toBe('2026-01-05');
    });
  });

  it('accepts a well-formed checklist and rejects a malformed one', async () => {
    await t.as(A, async () => {
      const id = await task();
      await t.db.query(`update ledger_occurrences set checklist = $2 where id = $1`, [id, JSON.stringify([{ id: 'a', text: 'Reconcile bank', done: true }, { id: 'b', text: 'Post receipts', done: false }])]);
      await rejects(t.db.query(`update ledger_occurrences set checklist = $2 where id = $1`, [id, JSON.stringify([{ id: 'a', text: '   ', done: false }])]), /check constraint/);
      await rejects(t.db.query(`update ledger_occurrences set checklist = $2 where id = $1`, [id, JSON.stringify([{ id: 'a', text: 'x' }])]), /check constraint/);
      await rejects(t.db.query(`update ledger_occurrences set checklist = $2 where id = $1`, [id, JSON.stringify(Array.from({ length: 51 }, (_, i) => ({ id: `i${i}`, text: 'x', done: false })))]), /check constraint/);
      await rejects(t.db.query(`update ledger_occurrences set checklist = '{"not":"a list"}' where id = $1`, [id]), /check constraint/);
    });
  });

  it('copies a schedule’s checklist into each generated task, all unticked', async () => {
    await t.as(A, async () => {
      const sid = (await t.one<{ id: string }>(
        `insert into ledger_schedules (workspace_id, client_id, title, frequency, unit, interval_count, due_rule, start_date, generate_from, lead_days, checklist)
         values ($1, $2, 'Monthly bookkeeping', 'monthly', 'month', 1, '{"kind":"month_offset","from":"end","months":1,"day":10}', $3, $4, 21, $5) returning id`,
        [ws, client, addDays(today, -200), addDays(today, -90), JSON.stringify([{ id: 's1', text: 'Reconcile bank', done: true }, { id: 's2', text: 'Send questions', done: false }])])).id;
      await t.one(`select public.ledger_generate()`);
      const lists = await t.all<{ checklist: { id: string; text: string; done: boolean }[] }>(`select checklist from ledger_occurrences where schedule_id = $1`, [sid]);
      expect(lists.length).toBeGreaterThan(0);
      for (const l of lists) expect(l.checklist).toEqual([{ id: 's1', text: 'Reconcile bank', done: false }, { id: 's2', text: 'Send questions', done: false }]);
      // Changing the template is history; the tasks already created keep theirs.
      await t.db.query(`update ledger_schedules set checklist = '[]' where id = $1`, [sid]);
      const log = await t.one<{ details: { fields: string[] } }>(`select details from ledger_activity where entity_id = $1 and action = 'edited' order by id desc limit 1`, [sid]);
      expect(log.details.fields).toContain('checklist');
      expect((await t.one<{ n: number }>(`select count(*)::int n from ledger_occurrences where schedule_id = $1 and jsonb_array_length(checklist) = 2`, [sid])).n).toBe(lists.length);
    });
  });

  it('stores client contacts and documents, with limits', async () => {
    await t.as(A, async () => {
      await t.db.query(`update ledger_clients set contact_name = 'Kari Fjord', contact_email = 'kari@fjordlys.example',
        documents = $2 where id = $1`, [client, JSON.stringify([{ id: 'd1', text: 'Bank statements, October', received: false, requestedOn: today, receivedOn: null }])]);
      const c = await t.one<{ contact_name: string; documents: unknown[] }>(`select contact_name, documents from ledger_clients where id = $1`, [client]);
      expect(c.contact_name).toBe('Kari Fjord');
      expect(c.documents).toHaveLength(1);
      await rejects(t.db.query(`update ledger_clients set documents = $2 where id = $1`, [client, JSON.stringify([{ id: 'd1', text: 'x', received: 'yes' }])]), /check constraint/);
      await rejects(t.db.query(`update ledger_clients set documents = $2 where id = $1`, [client, JSON.stringify([{ id: 'd1', text: 'x', received: true, receivedOn: 'yesterday' }])]), /check constraint/);
      await rejects(t.db.query(`update ledger_clients set contact_phone = $2 where id = $1`, [client, '9'.repeat(51)]), /check constraint/);
      const edited = await t.one<{ n: number }>(`select count(*)::int n from ledger_activity where entity_id = $1 and action = 'edited'`, [client]);
      expect(Number(edited.n)).toBe(1);
    });
  });

  it('uses the workspace’s holiday calendar when generating, and none when switched off', async () => {
    await t.as(A, async () => {
      // A weekly task due on Thursdays, moved to the next business day: Ascension Day 2026 (14 May) is a Thursday.
      const ins = (title: string) => t.one<{ id: string }>(
        `insert into ledger_schedules (workspace_id, client_id, title, frequency, unit, interval_count, due_rule, start_date, generate_from, end_date, lead_days)
         values ($1, $2, $3, 'weekly', 'week', 1, '{"kind":"weekday","weekday":4,"adjust":"next_business_day"}', '2026-05-11', '2026-05-11', '2026-05-17', 0) returning id`,
        [ws, client, title]).then((r) => r.id);
      const due = async (sid: string) => (await t.one<{ d: string }>(`select to_char(due_date, 'YYYY-MM-DD') d from ledger_occurrences where schedule_id = $1`, [sid])).d;
      const norway = await ins('Weekly check (Norway)');
      await t.one(`select public.ledger_generate()`);
      expect(await due(norway)).toBe('2026-05-15');
      await t.db.query(`update ledger_workspaces set settings = settings || '{"holidays":"none"}' where id = $1`, [ws]);
      const plain = await ins('Weekly check (weekends only)');
      await t.one(`select public.ledger_generate()`);
      expect(await due(plain)).toBe('2026-05-14');
      await t.db.query(`update ledger_workspaces set settings = settings - 'holidays' where id = $1`, [ws]);
    });
  });

  it('keeps another person out of the new columns as well', async () => {
    await t.as(B, async () => {
      await t.one(`select public.ledger_my_workspace()`);
      expect(await t.all(`select documents from ledger_clients where id = $1`, [client])).toEqual([]);
      const res = await t.db.query(`update ledger_occurrences set checklist = '[]' where client_id = $1`, [client]);
      expect(res.affectedRows ?? 0).toBe(0);
    });
  });
});
