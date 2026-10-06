// post.sql is what a project that already runs Home Memory pastes to get Post: it must work on its own, and be safe to run again.
import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import { buildPost } from '../build-setup.mjs';

const db = new PGlite();
await db.exec(`create role anon nologin; create role authenticated nologin;`); // all a Supabase project has that post.sql touches

await db.exec(buildPost());
await db.exec(buildPost()); // safe to run again
for (const t of ['post_alert_accounts', 'post_alert_seen', 'post_alert_devices', 'post_signins', 'post_config']) {
  assert.equal((await db.query(`select to_regclass('public.${t}') is not null as there`)).rows[0].there, true, `${t} exists`);
}
for (const c of ['session_hashes', 'sub_error', 'sub_error_at']) {
  assert.equal((await db.query(`select count(*)::int as n from information_schema.columns where table_name = 'post_alert_accounts' and column_name = $1`, [c])).rows[0].n, 1, `${c} exists`);
}
const said = (await db.query(`select public.post_setup('11111111-2222-3333-4444-555555555555', 'andreas@outlook.com') as m`)).rows[0].m;
assert.match(said, /Post is set up/);
console.log('post.sql OK');
