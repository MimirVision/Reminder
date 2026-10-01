// Runs the migration in an in-process Postgres (PGlite) with minimal Supabase stubs and
// checks that household isolation actually holds.
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import http from 'node:http';
import remind from '../../apps/web/netlify/functions/remind.mjs';
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
  create publication supabase_realtime;
  grant usage on schema auth, storage to authenticated;
  grant select, insert, update, delete on storage.objects to authenticated;
`);
for (const f of ['0001_init.sql', '0002_capture_keys.sql', '0003_maintenance.sql', '0004_suggestions.sql', '0005_hardening.sql', '0006_facts_and_custom_tasks.sql', '0007_feed_keys.sql', '0008_due_dates_and_addresses.sql', '0009_repeat_pushes_recap.sql', '0010_ai_limits_and_account_delete.sql'])
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

// Facts and custom tasks.
await as(B, async () => {
  await db.query(`insert into house_facts (household_id, title, value, category, surface_at) values ($1, 'Water shutoff', 'Under the kitchen sink, left valve', 'emergency', '{}')`, [hid]);
  await db.query(`insert into house_facts (household_id, title, value, category, surface_at) values ($1, 'Hallway bulbs', 'E27, 3000 K', 'appliance', '{hardware}')`, [hid]);
  await rejects(() => db.query(`insert into house_facts (household_id, title, created_by) values ($1, 'spoof', $2)`, [hid, A]), /row-level security/);
  const t1 = (await db.query(`select add_maintenance_task($1, 'Oil the terrace', null, 'interval', 12, null, null, null, '2026-09-30') as id`, [hid])).rows[0].id;
  const r1 = (await db.query(`select next_due_at::text as d, due_until from maintenance_tasks where id = $1`, [t1])).rows[0];
  assert.equal(r1.d, '2027-09-30', 'interval starts from today when never done');
  const t2 = (await db.query(`select add_maintenance_task($1, 'Sweep the roof', null, 'interval', 6, null, null, '2026-06-01', '2026-09-30') as id`, [hid])).rows[0].id;
  assert.equal((await db.query(`select next_due_at::text as d from maintenance_tasks where id = $1`, [t2])).rows[0].d, '2026-12-01', 'uses last done date');
  const t3 = (await db.query(`select add_maintenance_task($1, 'Paint the fence', 'two coats', 'seasonal', null, 5, 6, null, '2026-09-30') as id`, [hid])).rows[0].id;
  assert.deepEqual((await db.query(`select next_due_at::text as d, due_until::text as u from maintenance_tasks where id = $1`, [t3])).rows[0], { d: '2027-05-01', u: '2027-06-30' });
  await rejects(() => db.query(`select add_maintenance_task($1, '  ', null, 'interval', 3)`, [hid]), /title required/);
  await rejects(() => db.query(`select add_maintenance_task($1, 'x', null, 'seasonal')`, [hid]), /season required/);
});
await as(A, async () => {
  assert.equal((await db.query(`select * from house_facts`)).rows.length, 2, 'facts are shared in the household');
  const up = await db.query(`update house_facts set value = 'Under the sink, right valve' where title = 'Water shutoff' returning id`);
  assert.equal(up.rows.length, 1, 'the other partner can edit a shared fact');
});
await as(C, async () => {
  assert.equal((await db.query(`select * from house_facts`)).rows.length, 0);
  await rejects(() => db.query(`select add_maintenance_task($1, 'x', null, 'interval', 3)`, [hid]), /not a member/);
});

// Reminder keys: read-only feed for Shortcuts / Calendar links.
let fkey;
await as(A, async () => {
  fkey = (await db.query(`select public.create_feed_key($1, 'iPhone') as k`, [hid])).rows[0].k;
  assert.match(fkey, /^hmr_[0-9a-f]{64}$/);
  const stored = (await db.query(`select key_hash from feed_keys`)).rows[0].key_hash;
  assert.ok(!Buffer.from(stored).toString('utf8').includes(fkey), 'plaintext key is not stored');
});
await as(C, async () => {
  await rejects(() => db.query(`select public.create_feed_key($1)`, [hid]), /not a member/);
  assert.equal((await db.query(`select * from feed_keys`)).rows.length, 0, 'stranger cannot list keys');
});
await as(B, async () => {
  assert.equal((await db.query(`select * from feed_keys`)).rows.length, 0, 'keys are private to whoever made them');
});
await db.exec(`set role anon; select set_config('request.jwt.claim.sub', '', false)`);
const feed = (await db.query(`select public.reminder_feed($1) as f`, [fkey])).rows[0].f;
assert.equal(feed.household, 'Home');
assert.ok(feed.places.length >= 1 && feed.places.every((p) => p.id && p.name));
assert.ok(feed.todos.length >= 1 && feed.todos.every((x) => ['id', 'body', 'place_id', 'created_at'].every((k) => k in x)));
assert.ok(feed.todos.every((x) => x.body !== 'milk'), 'done to-dos are not in the feed');
assert.ok(feed.tasks.length >= 3 && feed.tasks.every((x) => x.title && x.next_due_at));
assert.deepEqual(feed.facts.map((f) => f.title), ['Hallway bulbs'], 'only facts tagged for a shop; the emergency card stays private');
assert.equal(feed.todos.some((x) => 'author_id' in x), false, 'no authors in the feed');
assert.equal((await db.query(`select public.reminder_feed('hmr_wrong') as f`)).rows[0].f, null, 'unknown key -> null');
assert.equal((await db.query(`select public.reminder_feed(null) as f`)).rows[0].f, null);
await rejects(() => db.query(`select * from memories`), /permission denied/);
await rejects(() => db.query(`select * from feed_keys`), /permission denied/);
await db.exec(`reset role`);
await as(A, async () => {
  assert.notEqual((await db.query(`select last_used_at from feed_keys`)).rows[0].last_used_at, null, 'use is recorded');
  await db.query(`delete from feed_keys`);
});
await db.exec(`set role anon`);
assert.equal((await db.query(`select public.reminder_feed($1) as f`, [fkey])).rows[0].f, null, 'revoked key -> null');
await db.exec(`reset role`);

// End to end: real SQL feed -> the Netlify function -> notification text and calendar file.
{
  let key2, pharmacyId, ikeaId;
  await as(A, async () => {
    key2 = (await db.query(`select public.create_feed_key($1, 'e2e') as k`, [hid])).rows[0].k;
    pharmacyId = (await db.query(`select id from places where category = 'pharmacy' limit 1`)).rows[0].id;
    ikeaId = (await db.query(`insert into places (household_id, name, kind, category, lat, lon, radius_m) values ($1, 'IKEA Furuset', 'fixed', 'hardware', 59.93, 10.9, 300) returning id`, [hid])).rows[0].id;
    await db.query(`insert into memories (household_id, body, status, place_id) values ($1, 'Buy plasters', 'active', $2)`, [hid, pharmacyId]);
    await db.query(`insert into memories (household_id, body, status, place_id) values ($1, 'Bookshelf' || chr(10) || 'white', 'active', $2)`, [hid, ikeaId]);
  });
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    if (req.method === 'POST' && req.url === '/rest/v1/rpc/reminder_feed') {
      await db.exec(`set role anon; select set_config('request.jwt.claim.sub', '', false)`);
      const r = await db.query(`select public.reminder_feed($1) as f`, [JSON.parse(body).p_key]);
      await db.exec(`reset role`);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(r.rows[0].f));
    } else { res.writeHead(404); res.end(); }
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const env = { VITE_SUPABASE_URL: `http://127.0.0.1:${server.address().port}`, VITE_SUPABASE_ANON_KEY: 'test' };
  globalThis.Netlify = { env: { get: (k) => env[k] } };
  const call = (path) => remind(new Request(`https://site.example${path}`));

  const pharmacy = await (await call(`/api/remind?key=${key2}&category=pharmacy`)).text();
  assert.equal(pharmacy, '1 to-do at Any pharmacy:\n- Buy plasters');
  const ikea = await (await call(`/api/remind?key=${key2}&place=ikea`)).text();
  assert.match(ikea, /^1 to-do at IKEA Furuset:\n- Bookshelf\n\nUseful here:\n- Hallway bulbs: E27, 3000 K$/, 'first line only, plus the fact tagged for hardware shops');
  assert.doesNotMatch(ikea, /Water shutoff/, 'the emergency card never leaves the database');
  const digest = await (await call(`/api/remind?key=${key2}`)).text();
  assert.match(digest, /^Home Memory\n/);
  assert.match(digest, /To-dos: \d+ waiting/);
  const ics = await (await call(`/calendar.ics?key=${key2}`)).text();
  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.ok((ics.match(/BEGIN:VEVENT/g) ?? []).length >= 3, 'the seeded house tasks are in the calendar');
  assert.match(ics, /SUMMARY:Clean gutters/);
  assert.equal((await call(`/api/remind?key=hmr_${'0'.repeat(64)}`)).status, 401, 'a well-formed but unknown key is rejected');
  await as(A, async () => { await db.query(`delete from feed_keys where label = 'e2e'`); });
  assert.equal((await call(`/api/remind?key=${key2}`)).status, 401, 'revoked key stops working through the whole chain');
  await new Promise((ok) => server.close(ok));
}

// 0008: due dates, addresses, realtime, feed fields; and upgrade.sql is safe to run again on a migrated database.
await as(A, async () => {
  const id = (await db.query(`insert into memories (household_id, body, status, due_on, due_time) values ($1, 'Buy milk', 'active', '2026-10-01', '18:00') returning id`, [hid])).rows[0].id;
  const r = (await db.query(`select due_on::text as d, due_time::text as t from memories where id = $1`, [id])).rows[0];
  assert.deepEqual(r, { d: '2026-10-01', t: '18:00:00' });
  await db.query(`insert into memories (household_id, body, due_on) values ($1, 'All day', '2026-10-02')`, [hid]);
  await rejects(() => db.query(`insert into memories (household_id, body, due_time) values ($1, 'time but no date', '09:00')`, [hid]), /memories_due_time_needs_date|check constraint/);
  await db.query(`update places set address = 'Storgata 5, 0155 Oslo' where name = 'Any pharmacy'`);
});
{
  await db.exec(buildSetup(UPGRADE_AFTER));
  await db.exec(buildSetup(UPGRADE_AFTER));
}
{
  let key3;
  await as(A, async () => { key3 = (await db.query(`select public.create_feed_key($1, 'due') as k`, [hid])).rows[0].k; });
  await db.exec(`set role anon; select set_config('request.jwt.claim.sub', '', false)`);
  const f = (await db.query(`select public.reminder_feed($1) as f`, [key3])).rows[0].f;
  await db.exec(`reset role`);
  const milk = f.todos.find((x) => x.body === 'Buy milk');
  assert.deepEqual([milk.due_on, milk.due_time], ['2026-10-01', '18:00:00'], 'due date and time reach the feed');
  assert.equal(f.todos.find((x) => x.body === 'All day').due_time, null);
  assert.ok(f.places.some((p) => p.address === 'Storgata 5, 0155 Oslo'), 'place addresses reach the feed');
  await as(A, async () => { await db.query(`delete from feed_keys where label = 'due'`); });
}

// 0009: repeating to-dos, done_by, web push subscriptions, weekly done count.
{
  let ids = {};
  await as(A, async () => {
    const ins = async (body, extra) => (await db.query(`insert into memories (household_id, body, status, due_on, due_time, repeat_rule) values ($1, $2, 'active', $3, $4, $5) returning id`, [hid, body, ...extra])).rows[0].id;
    ids.weekly = await ins('Bins', ['2020-01-07', '07:30', 'weekly']);
    ids.monthly = await ins('Rent', ['2020-01-31', null, 'monthly']);
    ids.once = await ins('One-off', ['2020-01-07', null, null]);
    await rejects(() => db.query(`insert into memories (household_id, body, repeat_rule) values ($1, 'repeat without a date', 'daily')`, [hid]), /memories_repeat_rule_valid|check constraint/);
    await rejects(() => db.query(`insert into memories (household_id, body, due_on, repeat_rule) values ($1, 'bad rule', '2030-01-01', 'hourly')`, [hid]), /memories_repeat_rule_valid|check constraint/);
  });
  await as(C, async () => {
    assert.equal((await db.query(`select public.complete_memory($1) as n`, [ids.weekly])).rows[0].n, null, 'a stranger cannot complete');
  });
  await as(B, async () => {
    const next = (await db.query(`select public.complete_memory($1) as n`, [ids.weekly])).rows[0].n;
    assert.ok(next, 'a repeating to-do returns the next occurrence');
    const done = (await db.query(`select status, done_by from memories where id = $1`, [ids.weekly])).rows[0];
    assert.deepEqual(done, { status: 'done', done_by: B }, 'who ticked it off is recorded');
    const n = (await db.query(`select body, status, due_on::text as d, due_time::text as t, repeat_rule, author_id from memories where id = $1`, [next])).rows[0];
    assert.equal(n.status, 'active'); assert.equal(n.body, 'Bins'); assert.equal(n.t, '07:30:00'); assert.equal(n.repeat_rule, 'weekly');
    assert.equal(n.author_id, A, 'the next one keeps its author');
    const days = (await db.query(`select (due_on - current_date) as d, extract(dow from due_on) = extract(dow from date '2020-01-07') as sameweekday from memories where id = $1`, [next])).rows[0];
    assert.ok(days.d > 0 && days.d <= 7 && days.sameweekday, 'the next date is in the future and on the same weekday');
    assert.equal((await db.query(`select public.complete_memory($1) as n`, [ids.weekly])).rows[0].n, null, 'completing twice does nothing');
    const once = (await db.query(`select public.complete_memory($1) as n`, [ids.once])).rows[0].n;
    assert.equal(once, null, 'a one-off creates no next occurrence');
    const monthly = (await db.query(`select public.complete_memory($1) as n`, [ids.monthly])).rows[0].n;
    assert.ok(monthly);
    assert.ok((await db.query(`select due_on > current_date as ok from memories where id = $1`, [monthly])).rows[0].ok);
  });
  // web push subscriptions
  await as(A, async () => {
    await db.query(`select public.save_push_subscription('https://push.example/1', 'p256', 'authsecret', 'nb')`);
    assert.equal((await db.query(`select lang from web_push_subscriptions`)).rows[0].lang, 'nb');
  });
  await as(B, async () => {
    assert.equal((await db.query(`select * from web_push_subscriptions`)).rows.length, 0, 'you only see your own subscriptions');
    await db.query(`select public.save_push_subscription('https://push.example/1', 'p2', 'a2', 'en')`);
    assert.equal((await db.query(`select user_id from web_push_subscriptions`)).rows[0].user_id, B, 'a device that signs in as someone else takes the subscription');
    await rejects(() => db.query(`insert into web_push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, 'https://push.example/2', 'x', 'y')`, [A]), /row-level security/);
  });
  await as(A, async () => { assert.equal((await db.query(`select * from web_push_subscriptions`)).rows.length, 0); });
  await db.exec(`reset role`);
  await db.exec(buildSetup(UPGRADE_AFTER)); // safe to run again
  let k;
  await as(A, async () => { k = (await db.query(`select public.create_feed_key($1, 'week') as k`, [hid])).rows[0].k; });
  await db.exec(`set role anon; select set_config('request.jwt.claim.sub', '', false)`);
  const f = (await db.query(`select public.reminder_feed($1) as f`, [k])).rows[0].f;
  await db.exec(`reset role`);
  assert.ok(f.done_week >= 3, 'finished to-dos this week are counted');
  assert.ok(f.todos.some((x) => x.repeat_rule === 'weekly'), 'repeat rules reach the feed');
  await as(A, async () => { await db.query(`delete from feed_keys where label = 'week'`); });
}

// 0010: daily AI limits and account deletion.
{
  await as(A, async () => {
    const take = async (fn, limit) => (await db.query(`select public.ai_take($1, $2) as ok`, [fn, limit])).rows[0].ok;
    assert.deepEqual([await take('read-label', 2), await take('read-label', 2), await take('read-label', 2)], [true, true, false], 'the third use of the day is refused');
    assert.equal(await take('suggest', 2), true, 'each function has its own count');
  });
  await as(B, async () => {
    assert.equal((await db.query(`select public.ai_take('read-label', 2) as ok`)).rows[0].ok, true, 'each person has their own count');
    await rejects(() => db.query(`select * from ai_usage`), /permission denied/);
  });
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false)`);
  assert.equal((await db.query(`select public.ai_take('x', 5) as ok`)).rows[0].ok, false, 'not signed in: refused');

  // Account deletion: a lone user's household disappears; in a shared household the data stays with the partner.
  const D = '66666666-6666-6666-6666-666666666666';
  await db.exec(`insert into auth.users values ('${D}')`);
  let solo;
  await as(D, async () => {
    solo = (await db.query(`select public.create_household('Solo', 'Dee') as id`)).rows[0].id;
    await db.query(`insert into memories (household_id, body) values ($1, 'mine')`, [solo]);
  });
  await as(D, async () => { await db.query(`select public.delete_my_account()`); });
  await db.exec(`reset role`);
  assert.equal((await db.query(`select count(*)::int as n from households where id = $1`, [solo])).rows[0].n, 0, 'a lone user takes the household with them');
  assert.equal((await db.query(`select count(*)::int as n from auth.users where id = $1`, [D])).rows[0].n, 0, 'the user is gone');

  const E = '77777777-7777-7777-7777-777777777777';
  await db.exec(`insert into auth.users values ('${E}')`);
  const liveCode = (await db.query(`select invite_code from households where id = $1`, [hid])).rows[0].invite_code;
  await as(E, async () => { await db.query(`select public.join_household($1, 'Eve')`, [liveCode]); await db.query(`insert into memories (household_id, body) values ($1, 'from eve')`, [hid]); });
  await as(E, async () => { await db.query(`select public.delete_my_account()`); });
  await db.exec(`reset role`);
  const kept = (await db.query(`select author_id from memories where body = 'from eve'`)).rows[0];
  assert.ok(kept && kept.author_id !== E, 'a shared household keeps the to-do, handed to a remaining member');
  assert.equal((await db.query(`select count(*)::int as n from household_members where user_id = $1`, [E])).rows[0].n, 0);
  assert.equal((await db.query(`select count(*)::int as n from households where id = $1`, [hid])).rows[0].n, 1, 'the shared household survives');
}

assert.equal(readFileSync(new URL('../setup.sql', import.meta.url), 'utf8'), buildSetup(), 'setup.sql is stale: run npm run build:setup');
assert.equal(readFileSync(new URL('../upgrade.sql', import.meta.url), 'utf8'), buildSetup(UPGRADE_AFTER), 'upgrade.sql is stale: run npm run build:setup');

console.log('RLS checks passed');
