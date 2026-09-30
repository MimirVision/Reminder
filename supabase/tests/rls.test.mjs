// Runs the migration in an in-process Postgres (PGlite) with minimal Supabase stubs and
// checks that household isolation actually holds.
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import { buildSetup } from '../build-setup.mjs';

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
for (const f of ['0001_init.sql', '0002_capture_keys.sql'])
  await db.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), 'utf8'));
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

// Capture keys: anonymous capture works with a valid key only, lands in the right household as the key's owner.
let key;
await as(A, async () => {
  key = (await db.query(`select public.create_capture_key($1, 'iPhone Shortcut') as k`, [hid])).rows[0].k;
  assert.match(key, /^hm_[0-9a-f]{64}$/);
  const stored = (await db.query(`select key_hash from capture_keys`)).rows[0].key_hash;
  assert.ok(!Buffer.from(stored).toString('utf8').includes(key), 'plaintext key is not stored');
});
await as(C, async () => {
  await rejects(() => db.query(`select public.create_capture_key($1)`, [hid]), /not a member/);
  assert.equal((await db.query(`select * from capture_keys`)).rows.length, 0, 'stranger cannot list keys');
});
await db.exec(`set role anon; select set_config('request.jwt.claim.sub', '', false)`);
await db.query(`select public.capture_memory($1, '  remember the gutters  ', 59.91, 10.75)`, [key]);
await rejects(() => db.query(`select public.capture_memory('hm_wrong', 'x')`), /invalid capture key/);
await rejects(() => db.query(`select public.capture_memory($1, '   ')`, [key]), /empty memory/);
await rejects(() => db.query(`select * from memories`), /permission denied/);
await db.exec(`reset role`);
await as(B, async () => {
  const r = (await db.query(`select body, author_id, status, capture_lat from memories where body = 'remember the gutters'`)).rows;
  assert.equal(r.length, 1);
  assert.equal(r[0].author_id, A, 'attributed to key owner');
  assert.equal(r[0].status, 'inbox');
});
await as(A, async () => {
  await db.query(`delete from capture_keys`);
});
await db.exec(`set role anon`);
await rejects(() => db.query(`select public.capture_memory($1, 'after revoke')`, [key]), /invalid capture key/);
await db.exec(`reset role`);

assert.equal(readFileSync(new URL('../setup.sql', import.meta.url), 'utf8'), buildSetup(), 'setup.sql is stale: run npm run build:setup');

console.log('RLS checks passed');
