// Runs the migration in an in-process Postgres (PGlite) with minimal Supabase stubs and
// checks that household isolation actually holds.
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';

const db = new PGlite();

await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  create function storage.foldername(name text) returns text[] language sql immutable as
    $$ select string_to_array(name, '/') $$;
  grant usage on schema auth, storage to authenticated;
  grant select, insert, update, delete on storage.objects to authenticated;
`);
await db.exec(readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8'));
await db.exec(`alter table storage.objects enable row level security;`).catch(() => {});

const A = '11111111-1111-1111-1111-111111111111'; // you
const B = '22222222-2222-2222-2222-222222222222'; // spouse
const C = '33333333-3333-3333-3333-333333333333'; // stranger
await db.exec(`insert into auth.users values ('${A}'), ('${B}'), ('${C}')`);

async function as(uid, fn) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false)`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false)`); }
}
const rejects = async (fn, re) => { try { await fn(); } catch (e) { assert.match(String(e.message), re); return; } assert.fail('expected rejection'); };

let hid, code;
await as(A, async () => {
  hid = (await db.query(`select public.create_household('Home', 'Andreas') as id`)).rows[0].id;
  code = (await db.query(`select invite_code from households where id = $1`, [hid])).rows[0].invite_code;
  await db.query(`insert into memories (household_id, body) values ($1, 'buy paracetamol')`, [hid]);
  await db.query(`insert into places (household_id, name, kind, category) values ($1, 'Any pharmacy', 'category', 'pharmacy')`, [hid]);
});

await as(C, async () => {
  assert.equal((await db.query(`select * from memories`)).rows.length, 0, 'stranger sees no memories');
  assert.equal((await db.query(`select * from households`)).rows.length, 0, 'stranger sees no households');
  await rejects(() => db.query(`insert into memories (household_id, body) values ($1, 'x')`, [hid]), /row-level security/);
  await rejects(() => db.query(`insert into household_members (household_id, user_id) values ($1, $2)`, [hid, C]), /permission denied|row-level security/);
  await rejects(() => db.query(`select public.join_household('nope')`), /invalid invite code/);
});

await as(B, async () => {
  await db.query(`select public.join_household($1, 'Wife')`, [code]);
  const m = await db.query(`select body from memories`);
  assert.deepEqual(m.rows.map((r) => r.body), ['buy paracetamol'], 'spouse sees shared memory');
  await db.query(`insert into memories (household_id, body) values ($1, 'milk')`, [hid]);
  await rejects(() => db.query(`insert into memories (household_id, body, author_id) values ($1, 'spoof', $2)`, [hid, A]), /row-level security/);
  await db.query(`update memories set status = 'done', done_at = now() where body = 'milk'`);
});

await as(A, async () => {
  const r = await db.query(`select body, status, updated_at is not null as touched from memories order by body`);
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows.find((x) => x.body === 'milk').status, 'done', 'spouse update visible to owner');
});

await db.query(`insert into storage.objects (bucket_id, name) values ('media', '${hid}/m1/a.jpg')`);
await as(C, async () => {
  assert.equal((await db.query(`select * from storage.objects`)).rows.length, 0, 'stranger cannot see photos');
});
await as(A, async () => {
  assert.equal((await db.query(`select * from storage.objects`)).rows.length, 1, 'member sees photos');
});

console.log('RLS checks passed');
