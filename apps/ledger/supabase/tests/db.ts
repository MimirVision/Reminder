// An in-process Postgres (PGlite) with the few Supabase pieces Ledger relies on, and Ledger's migrations applied.
import { PGlite } from '@electric-sql/pglite';
import { buildLedgerSql } from '../build.mjs';

export async function ledgerDb() {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated, anon;
    grant usage on schema public to authenticated, anon;
    grant execute on function auth.uid() to authenticated, anon;
  `);
  await db.exec(buildLedgerSql());
  // Running it twice must be harmless.
  await db.exec(buildLedgerSql());

  async function as<T>(uid: string | null, fn: () => Promise<T>): Promise<T> {
    await db.exec(`set role ${uid ? 'authenticated' : 'anon'}; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false)`);
    try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false)`); }
  }
  const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];
  const all = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
  return { db, as, one, all };
}

export const A = '11111111-1111-1111-1111-111111111111';
export const B = '22222222-2222-2222-2222-222222222222';

export async function rejects(p: Promise<unknown>, re: RegExp) {
  try { await p; } catch (e) {
    if (!re.test(String((e as Error).message))) throw new Error(`Rejected with "${(e as Error).message}", expected ${re}`);
    return;
  }
  throw new Error(`Expected rejection matching ${re}`);
}
