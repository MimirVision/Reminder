// Steps and time in the database: a task coming after another, and a planned block of time.
import { beforeAll, describe, expect, it } from 'vitest';
import { A, B, ledgerDb, rejects } from './db';

describe('Steps and planned time', () => {
  let t: Awaited<ReturnType<typeof ledgerDb>>;
  let ws: string, client: string;
  beforeAll(async () => {
    t = await ledgerDb();
    await t.as(A, async () => {
      ws = (await t.one<{ id: string }>(`select (public.ledger_my_workspace()).id`)).id;
      client = (await t.one<{ id: string }>(`insert into ledger_clients (workspace_id, name) values ($1, 'Fjordlys Regnskap AS') returning id`, [ws])).id;
    });
  });
  const task = (title: string, after: string | null = null) => t.one<{ id: string }>(
    `insert into ledger_occurrences (workspace_id, client_id, title, due_date, after_id) values ($1, $2, $3, '2026-11-30', $4) returning id`, [ws, client, title, after]).then((r) => r.id);

  it('reports schema version 6', async () => {
    await t.as(A, async () => {
      expect(Number((await t.one<{ v: number }>(`select public.ledger_schema_version() v`)).v)).toBe(6);
    });
  });

  it('links a step to the one before, and unlinks it when that one is deleted', async () => {
    await t.as(A, async () => {
      const a = await task('Mottak av lønnsgrunnlag');
      const b = await task('Lønnskjøring', a);
      expect((await t.one<{ after_id: string }>(`select after_id from ledger_occurrences where id = $1`, [b])).after_id).toBe(a);
      await t.db.query(`delete from ledger_occurrences where id = $1`, [a]);
      expect((await t.one<{ after_id: string | null }>(`select after_id from ledger_occurrences where id = $1`, [b])).after_id).toBeNull();
    });
  });

  it('accepts a whole chain in one insert, each step after the one before it', async () => {
    await t.as(A, async () => {
      const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
      await t.db.query(`insert into ledger_occurrences (id, workspace_id, client_id, title, due_date, after_id) values
        ($1, $4, $5, 'Grunnlag', '2026-11-10', null), ($2, $4, $5, 'Lønn', '2026-11-19', $1), ($3, $4, $5, 'A-melding', '2026-12-05', $2)`, [...ids, ws, client]);
      expect((await t.all<{ after_id: string }>(`select after_id from ledger_occurrences where id = any($1) order by due_date`, [ids])).map((r) => r.after_id)).toEqual([null, ids[0], ids[1]]);
    });
  });

  it('refuses a task after itself, and a loop', async () => {
    await t.as(A, async () => {
      const a = await task('A'), b = await task('B', a), c = await task('C', b);
      await rejects(t.db.query(`update ledger_occurrences set after_id = id where id = $1`, [a]), /after itself/);
      await rejects(t.db.query(`update ledger_occurrences set after_id = $2 where id = $1`, [a, c]), /wait for each other/);
    });
  });

  it('refuses a step from another workspace', async () => {
    let mine = '';
    await t.as(A, async () => { mine = await task('Mine'); });
    await t.as(B, async () => {
      const other = (await t.one<{ id: string }>(`select (public.ledger_my_workspace()).id`)).id;
      const c = (await t.one<{ id: string }>(`insert into ledger_clients (workspace_id, name) values ($1, 'Annen AS') returning id`, [other])).id;
      await rejects(t.db.query(`insert into ledger_occurrences (workspace_id, client_id, title, due_date, after_id) values ($1, $2, 'X', '2026-11-30', $3)`, [other, c, mine]), /not in this workspace/);
    });
  });

  it('stores a planned block, all or nothing, ending after it starts', async () => {
    await t.as(A, async () => {
      const a = await task('Plan me');
      await t.db.query(`update ledger_occurrences set planned_on = '2026-11-26', planned_start = '09:00', planned_end = '10:30' where id = $1`, [a]);
      const r = await t.one<{ s: string; e: string }>(`select to_char(planned_start, 'HH24:MI') s, to_char(planned_end, 'HH24:MI') e from ledger_occurrences where id = $1`, [a]);
      expect(`${r.s}-${r.e}`).toBe('09:00-10:30');
      await rejects(t.db.query(`update ledger_occurrences set planned_end = '08:00' where id = $1`, [a]), /check constraint/);
      await rejects(t.db.query(`update ledger_occurrences set planned_on = null where id = $1`, [a]), /check constraint/);
      await t.db.query(`update ledger_occurrences set planned_on = null, planned_start = null, planned_end = null where id = $1`, [a]);
    });
  });
});
