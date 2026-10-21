// Notifications in the database: per-item reminder lists, push devices private to their owner, and server-only logs.
import { beforeAll, describe, expect, it } from 'vitest';
import { A, B, ledgerDb, rejects } from './db';

describe('Notifications', () => {
  let t: Awaited<ReturnType<typeof ledgerDb>>;
  let ws: string, client: string;
  beforeAll(async () => {
    t = await ledgerDb();
    await t.as(A, async () => {
      ws = (await t.one<{ id: string }>(`select (public.ledger_my_workspace()).id`)).id;
      client = (await t.one<{ id: string }>(`insert into ledger_clients (workspace_id, name) values ($1, 'Fjordlys Regnskap AS') returning id`, [ws])).id;
    });
  });
  const device = (endpoint = 'https://fcm.googleapis.com/fcm/send/abc', label = 'Chrome on Windows') => t.one<{ id: string }>(
    `insert into ledger_push_devices (workspace_id, endpoint, p256dh, auth, label) values ($1, $2, $3, $4, $5) returning id`,
    [ws, endpoint, 'B'.repeat(87), 'a'.repeat(22), label]);

  it('reports schema version 5', async () => {
    await t.as(A, async () => {
      expect(Number((await t.one<{ v: number }>(`select public.ledger_schema_version() v`)).v)).toBe(5);
    });
  });

  it('stores reminder lists on tasks, schedules and meetings, within limits', async () => {
    await t.as(A, async () => {
      const task = await t.one<{ id: string; notify_days: number[] | null }>(
        `insert into ledger_occurrences (workspace_id, client_id, title, due_date, notify_days) values ($1, $2, 'Deliver VAT', '2026-10-22', '{7,1,0}') returning id, notify_days`, [ws, client]);
      expect(task.notify_days).toEqual([7, 1, 0]);
      await t.db.query(`update ledger_occurrences set notify_days = null where id = $1`, [task.id]);
      await t.db.query(`update ledger_occurrences set notify_days = '{}' where id = $1`, [task.id]);
      await rejects(t.db.query(`update ledger_occurrences set notify_days = '{1,2,3,4,5}' where id = $1`, [task.id]), /check constraint/);
      await rejects(t.db.query(`update ledger_occurrences set notify_days = '{61}' where id = $1`, [task.id]), /check constraint/);
      await rejects(t.db.query(`update ledger_occurrences set notify_days = '{-1}' where id = $1`, [task.id]), /check constraint/);
      await rejects(t.db.query(`update ledger_occurrences set notify_days = '{1,null}' where id = $1`, [task.id]), /check constraint/);
      const m = await t.one<{ notify_minutes: number[] }>(
        `insert into ledger_meetings (workspace_id, title, meeting_date, start_time, end_time, notify_minutes) values ($1, 'Stand-up', '2026-10-22', '09:00', '09:15', '{1440,15}') returning notify_minutes`, [ws]);
      expect(m.notify_minutes).toEqual([1440, 15]);
      await rejects(t.db.query(`insert into ledger_meetings (workspace_id, title, meeting_date, start_time, end_time, notify_minutes) values ($1, 'X', '2026-10-22', '09:00', '09:15', '{10081}')`, [ws]), /check constraint/);
    });
  });

  it('keeps one row per device and lets you remove it', async () => {
    await t.as(A, async () => {
      await device();
      await rejects(device(), /duplicate key/);
      await t.db.query(`insert into ledger_push_devices (workspace_id, endpoint, p256dh, auth, label) values ($1, $2, $3, $4, 'Safari on iPhone')
        on conflict (workspace_id, endpoint) do update set label = excluded.label`, [ws, 'https://fcm.googleapis.com/fcm/send/abc', 'B'.repeat(87), 'a'.repeat(22)]);
      expect((await t.all<{ label: string }>(`select label from ledger_push_devices`)).map((r) => r.label)).toEqual(['Safari on iPhone']);
      await rejects(device('http://example.com/push'), /check constraint/);
    });
  });

  it('keeps devices private to their owner', async () => {
    await t.as(B, async () => {
      const other = (await t.one<{ id: string }>(`select (public.ledger_my_workspace()).id`)).id;
      expect(await t.all(`select id from ledger_push_devices`)).toEqual([]);
      const res = await t.db.query(`delete from ledger_push_devices`);
      expect(res.affectedRows ?? 0).toBe(0);
      await rejects(t.db.query(`insert into ledger_push_devices (workspace_id, endpoint, p256dh, auth) values ($1, 'https://fcm.googleapis.com/x', $2, $3)`,
        [ws, 'B'.repeat(87), 'a'.repeat(22)]), /row-level security/);
      expect(other).not.toBe(ws);
    });
    await t.as(A, async () => {
      expect(await t.all(`select id from ledger_push_devices`)).toHaveLength(1);
    });
  });

  it('keeps the sent log and run status away from signed-in users', async () => {
    await t.as(A, async () => {
      await rejects(t.db.query(`select * from ledger_push_sent`), /permission denied/);
      await rejects(t.db.query(`insert into ledger_push_sent (workspace_id, key) values ($1, 'x')`, [ws]), /permission denied/);
      await rejects(t.db.query(`select * from ledger_notify_status`), /permission denied/);
    });
    await t.as(null, async () => {
      await rejects(t.db.query(`select * from ledger_push_devices`), /permission denied/);
    });
  });
});
