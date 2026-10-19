// Meetings in the database: a time of day, an optional client, row level security, history, erase.
import { beforeAll, describe, expect, it } from 'vitest';
import { A, B, ledgerDb, rejects } from './db';

describe('Meetings', () => {
  let t: Awaited<ReturnType<typeof ledgerDb>>;
  let ws: string, client: string;
  beforeAll(async () => {
    t = await ledgerDb();
    await t.as(A, async () => {
      ws = (await t.one<{ id: string }>(`select (public.ledger_my_workspace()).id`)).id;
      client = (await t.one<{ id: string }>(`insert into ledger_clients (workspace_id, name) values ($1, 'Fjordlys Regnskap AS') returning id`, [ws])).id;
    });
  });
  const book = (fields: Record<string, unknown> = {}) => t.one<{ id: string }>(
    `insert into ledger_meetings (workspace_id, client_id, title, meeting_date, start_time, end_time, location)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [ws, 'client' in fields ? fields.client : client, fields.title ?? 'Year-end planning', fields.date ?? '2026-10-20', fields.start ?? '10:00', fields.end ?? '11:00', fields.location ?? 'Teams']).then((r) => r.id);

  it('reports schema version 4', async () => {
    await t.as(A, async () => {
      expect(Number((await t.one<{ v: number }>(`select public.ledger_schema_version() v`)).v)).toBe(4);
    });
  });

  it('books a meeting with or without a client, and keeps the wall-clock time', async () => {
    await t.as(A, async () => {
      const id = await book();
      const internal = await book({ client: null, title: 'Team stand-up', start: '09:00', end: '09:15' });
      const rows = await t.all<{ id: string; s: string; e: string }>(`select id, to_char(start_time, 'HH24:MI') s, to_char(end_time, 'HH24:MI') e from ledger_meetings where id = any($1) order by start_time`, [[id, internal]]);
      expect(rows.map((r) => `${r.s}-${r.e}`)).toEqual(['09:00-09:15', '10:00-11:00']);
    });
  });

  it('rejects a meeting that ends before it starts, or an empty title', async () => {
    await t.as(A, async () => {
      await rejects(book({ start: '11:00', end: '10:00' }), /check constraint/);
      await rejects(book({ title: '  ' }), /check constraint/);
    });
  });

  it('records booking and moving in the client’s history', async () => {
    await t.as(A, async () => {
      const id = await book({ title: 'Budget review' });
      await t.db.query(`update ledger_meetings set meeting_date = '2026-10-22', start_time = '14:00', end_time = '15:00' where id = $1`, [id]);
      await t.db.query(`update ledger_meetings set notes = 'Bring last year’s figures' where id = $1`, [id]);
      const acts = await t.all<{ action: string; details: Record<string, string> }>(`select action, details from ledger_activity where entity = 'meeting' and entity_id = $1 order by id`, [id]);
      expect(acts.map((a) => a.action)).toEqual(['created', 'rescheduled']);
      expect(acts[1].details).toMatchObject({ to: '2026-10-22', start: '14:00' });
    });
  });

  it('keeps meetings private to their owner', async () => {
    let id = '';
    await t.as(A, async () => { id = await book({ title: 'Private' }); });
    await t.as(B, async () => {
      await t.one(`select public.ledger_my_workspace()`);
      expect(await t.all(`select id from ledger_meetings where id = $1`, [id])).toEqual([]);
      const res = await t.db.query(`delete from ledger_meetings where id = $1`, [id]);
      expect(res.affectedRows ?? 0).toBe(0);
      await rejects(t.db.query(`insert into ledger_meetings (workspace_id, title, meeting_date, start_time, end_time) values ($1, 'Sneaky', '2026-10-20', '10:00', '11:00')`, [ws]), /row-level security|violates/);
    });
  });

  it('keeps a client with meetings from being deleted, and erase removes them', async () => {
    await t.as(A, async () => {
      await rejects(t.db.query(`delete from ledger_clients where id = $1`, [client]), /foreign key|violates/);
      await t.db.query(`select public.ledger_erase_workspace($1)`, [ws]);
      expect(Number((await t.one<{ n: number }>(`select count(*)::int n from ledger_meetings`)).n)).toBe(0);
    });
  });
});
