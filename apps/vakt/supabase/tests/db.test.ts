// Vakt's SQL in an in-process Postgres (PGlite) with the few Supabase pieces it relies on.
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, expect, it } from 'vitest';
import { buildVaktSql } from '../build.mjs';

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';
let db: PGlite;

async function as<T>(uid: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role ${uid ? 'authenticated' : 'anon'}; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false)`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false)`); }
}
const rows = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated, anon;
    grant usage on schema public to authenticated, anon;
    grant execute on function auth.uid() to authenticated, anon;
  `);
  await db.exec(buildVaktSql());
  await db.exec(buildVaktSql()); // running it twice must be harmless
});

it('vakt.sql matches the migrations (run npm run build:sql after changing them)', () => {
  expect(readFileSync(new URL('../vakt.sql', import.meta.url), 'utf8')).toBe(buildVaktSql());
});

it('only creates vakt_* objects in the shared project', () => {
  const sql = buildVaktSql();
  const created = [...sql.matchAll(/create (?:or replace )?(?:table|function|index|unique index|policy|trigger)(?: if not exists)? (?:public\.)?(\w+)/gi)].map((m) => m[1]);
  expect(created.length).toBeGreaterThan(5);
  expect(created.filter((n) => !n.startsWith('vakt_'))).toEqual([]);
  expect(sql).not.toMatch(/references auth\.users/i);
});

it('keeps each person’s shifts, supplements and settings to themselves', async () => {
  await as(A, () => rows(`insert into vakt_shifts (date, start_time, end_time) values ('2026-10-21', '07:30', '15:30')`));
  await as(A, () => rows(`insert into vakt_supplements (name, amount_type, amount, days, start_time, end_time) values ('Helg', 'kr_per_hour', 60, '{sat,sun}', '00:00', '00:00')`));
  await as(A, () => rows(`insert into vakt_profiles (settings) values ('{"goal": 30000}')`));
  expect(await as(A, () => rows('select * from vakt_shifts'))).toHaveLength(1);
  expect(await as(B, () => rows('select * from vakt_shifts'))).toHaveLength(0);
  expect(await as(B, () => rows('select * from vakt_supplements'))).toHaveLength(0);
  expect(await as(B, () => rows('select * from vakt_profiles'))).toHaveLength(0);
  expect(await as(B, () => rows(`update vakt_shifts set note = 'x' returning id`))).toHaveLength(0);
  expect(await as(B, () => rows(`delete from vakt_shifts returning id`))).toHaveLength(0);
  await expect(as(B, () => rows(`insert into vakt_shifts (owner_id, date, start_time, end_time) values ('${A}', '2026-10-21', '07:30', '15:30')`))).rejects.toThrow(/row-level security/);
  await expect(as(null, () => rows('select * from vakt_shifts'))).rejects.toThrow(/permission denied/);
});

it('rejects impossible values', async () => {
  await expect(as(A, () => rows(`insert into vakt_shifts (date, start_time, end_time) values ('2026-10-21', '25:00', '15:30')`))).rejects.toThrow(/check/);
  await expect(as(A, () => rows(`insert into vakt_supplements (name, amount_type, amount, days, start_time, end_time) values ('X', 'kr_per_hour', 60, '{funday}', '00:00', '00:00')`))).rejects.toThrow(/check/);
  await expect(as(A, () => rows(`insert into vakt_supplements (name, amount_type, amount, days, start_time, end_time) values ('X', 'bonus', 60, '{mon}', '00:00', '00:00')`))).rejects.toThrow(/check/);
});
