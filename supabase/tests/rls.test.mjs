// Runs the migration in an in-process Postgres (PGlite) with minimal Supabase stubs and
// checks that household isolation actually holds.
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import { buildSetup, UPGRADE_AFTER } from '../build-setup.mjs';

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
for (const f of ['0001_init.sql', '0002_capture_keys.sql', '0003_maintenance.sql', '0004_suggestions.sql', '0005_hardening.sql'])
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
  assert.equal((await db.query(`select public.join_household('nope') as h`)).rows[0].h, null, 'unknown code returns null');
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

// Maintenance: seeding, scheduling rules, completion, isolation.
const due = async (schedule, months, ws, we, from) =>
  (await db.query(`select next_due::text as d, due_until::text as u from next_maintenance_due($1, $2, $3, $4, $5::date)`, [schedule, months, ws, we, from])).rows[0];
assert.deepEqual(await due('interval', 6, null, null, '2026-08-31'), { d: '2027-02-28', u: null });
assert.deepEqual(await due('seasonal', null, 9, 10, '2026-09-20'), { d: '2027-09-01', u: '2027-10-31' }, 'done inside window: next year');
assert.deepEqual(await due('seasonal', null, 9, 10, '2026-07-15'), { d: '2027-09-01', u: '2027-10-31' }, 'done a bit early counts for this window');
assert.deepEqual(await due('seasonal', null, 9, 10, '2026-02-01'), { d: '2026-09-01', u: '2026-10-31' }, 'done long before: this year');
assert.deepEqual(await due('seasonal', null, 11, 2, '2026-12-05'), { d: '2027-11-01', u: '2028-02-29' }, 'window wrapping the new year');
const first = async (ws, we, today) => (await db.query(`select next_due::text as d, due_until::text as u from first_seasonal_due($1, $2, $3::date)`, [ws, we, today])).rows[0];
assert.deepEqual(await first(9, 10, '2026-09-30'), { d: '2026-09-01', u: '2026-10-31' }, 'inside window: due now');
assert.deepEqual(await first(9, 10, '2026-11-15'), { d: '2027-09-01', u: '2027-10-31' }, 'after window: next year');
assert.deepEqual(await first(11, 2, '2027-01-10'), { d: '2026-11-01', u: '2027-02-28' }, 'inside a window that started last year');

let seeded;
await as(A, async () => {
  seeded = (await db.query(`select seed_house_template($1, '{"has_garden": true, "has_heat_pump": true}', '2026-09-30') as n`, [hid])).rows[0].n;
  const again = (await db.query(`select seed_house_template($1, '{"has_garden": true, "has_heat_pump": true}', '2026-09-30') as n`, [hid])).rows[0].n;
  assert.equal(again, 0, 'seeding is idempotent');
  const keys = (await db.query(`select template_key from maintenance_tasks`)).rows.map((r) => r.template_key);
  assert.ok(keys.includes('gutters_autumn') && keys.includes('garden_autumn') && keys.includes('heat_pump_filters'));
  assert.ok(!keys.includes('septic') && !keys.includes('chimney'), 'optional groups stay off');
  assert.equal(keys.length, seeded);
  const g = (await db.query(`select next_due_at::text as d from maintenance_tasks where template_key = 'gutters_autumn'`)).rows[0];
  assert.equal(g.d, '2026-09-01', 'gutters due now (we are in the window)');
  const stagger = (await db.query(`select min(next_due_at)::text as a, max(next_due_at)::text as b from maintenance_tasks where schedule = 'interval'`)).rows[0];
  assert.ok(stagger.a >= '2026-10-07' && stagger.b <= '2026-11-25', `interval tasks are staggered: ${JSON.stringify(stagger)}`);
});
await as(C, async () => {
  await rejects(() => db.query(`select seed_house_template($1)`, [hid]), /not a member/);
  assert.equal((await db.query(`select * from maintenance_tasks`)).rows.length, 0);
});
await as(B, async () => {
  const id = (await db.query(`select id from maintenance_tasks where template_key = 'gutters_autumn'`)).rows[0].id;
  await db.query(`select complete_maintenance($1, '2026-09-30', 450, 'did the front only')`, [id]);
  const t = (await db.query(`select last_done_at::text as l, next_due_at::text as n, due_until::text as u from maintenance_tasks where id = $1`, [id])).rows[0];
  assert.deepEqual(t, { l: '2026-09-30', n: '2027-09-01', u: '2027-10-31' });
  const e = (await db.query(`select cost_nok::text as c, note, done_by from maintenance_events where task_id = $1`, [id])).rows;
  assert.equal(e.length, 1); assert.equal(e[0].c, '450.00'); assert.equal(e[0].done_by, B);
  await rejects(() => db.query(`insert into maintenance_events (task_id, household_id) values ($1, $2)`, [id, hid]), /permission denied|row-level security/);
});
await as(C, async () => {
  const id = (await db.query(`select id from maintenance_tasks limit 1`)).rows;
  assert.equal(id.length, 0);
  await rejects(() => db.query(`select complete_maintenance(gen_random_uuid())`), /not found/);
});

// Suggestions: members can store and clear a suggestion on a shared to-do; strangers cannot.
await as(B, async () => {
  const id = (await db.query(`select id from memories where body = 'milk'`)).rows[0].id;
  await db.query(`update memories set suggestion = '{"kind":"category","category":"grocery","label":"x","reason":"y","confidence":"high"}', suggested_at = now() where id = $1`, [id]);
  const r = (await db.query(`select suggestion->>'category' as c, suggested_at is not null as asked from memories where id = $1`, [id])).rows[0];
  assert.deepEqual(r, { c: 'grocery', asked: true });
});
await as(C, async () => {
  const n = (await db.query(`update memories set suggestion = null returning id`)).rows.length;
  assert.equal(n, 0, 'stranger cannot touch suggestions');
});

// Hardening: rotate invite code, throttled guessing, same-household integrity.
const D = '44444444-4444-4444-4444-444444444444';
await db.exec(`insert into auth.users values ('${D}')`);
await as(D, async () => {
  for (let i = 0; i < 10; i++) await db.query(`select public.join_household('guess${i}')`);
  await rejects(() => db.query(`select public.join_household('guess11')`), /too many attempts/);
  const real = (await db.query(`select invite_code from households where id = $1`, [hid])).rows.length;
  assert.equal(real, 0, 'outsider still cannot read households');
});
let newCode;
await as(A, async () => {
  newCode = (await db.query(`select public.rotate_invite_code($1) as c`, [hid])).rows[0].c;
  assert.match(newCode, /^[0-9a-f]{16}$/);
  assert.notEqual(code, newCode);
  const second = (await db.query(`select public.create_household('Other') as id`)).rows[0].id;
  assert.equal((await db.query(`select length(invite_code) as n from households where id = $1`, [second])).rows[0].n, 16, 'new households get long codes');
  const place = (await db.query(`select id from places where household_id = $1 limit 1`, [hid])).rows[0].id;
  await rejects(() => db.query(`insert into memories (household_id, body, place_id) values ($1, 'x', $2)`, [second, place]), /another household/);
  const mem = (await db.query(`select id from memories where household_id = $1 limit 1`, [hid])).rows[0].id;
  await rejects(() => db.query(`insert into media (memory_id, household_id, storage_path) values ($1, $2, 'p')`, [mem, second]), /another household/);
  await db.query(`insert into media (memory_id, household_id, storage_path) values ($1, $2, 'ok')`, [mem, hid]);
});
await as(C, async () => {
  await rejects(() => db.query(`select public.rotate_invite_code($1)`, [hid]), /not a member/);
});
await as(D, async () => {
  // the old attempts window is per hour; a fresh user with the rotated code would join, the old code no longer works
  await db.exec(`delete from join_attempts`).catch(() => {});
});

assert.equal(readFileSync(new URL('../setup.sql', import.meta.url), 'utf8'), buildSetup(), 'setup.sql is stale: run npm run build:setup');
assert.equal(readFileSync(new URL('../upgrade.sql', import.meta.url), 'utf8'), buildSetup(UPGRADE_AFTER), 'upgrade.sql is stale: run npm run build:setup');

console.log('RLS checks passed');
