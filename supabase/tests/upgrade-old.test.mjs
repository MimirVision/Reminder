// A project that ran setup.sql before migration 0006 existed (it had 0001-0005) must be brought up to date by upgrade.sql alone:
// that is the "Could not find the function add_maintenance_task" error.
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
  create publication supabase_realtime;
  grant usage on schema auth, storage to authenticated;
  grant select, insert, update, delete on storage.objects to authenticated;
`);
for (const f of ['0001_init.sql', '0002_capture_keys.sql', '0003_maintenance.sql', '0004_suggestions.sql', '0005_hardening.sql'])
  await db.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), 'utf8'));
const fn = async () => (await db.query(`select count(*)::int as n from pg_proc where proname = 'add_maintenance_task'`)).rows[0].n;
assert.equal(await fn(), 0, 'the old project has no custom-task function');

await db.exec(buildSetup(UPGRADE_AFTER));
assert.equal(await fn(), 1, 'upgrade.sql adds it');
assert.equal((await db.query(`select count(*)::int as n from information_schema.tables where table_name = 'house_facts'`)).rows[0].n, 1, 'and the facts table');
await db.exec(buildSetup(UPGRADE_AFTER)); // and it is safe to run again
console.log('upgrade from 0005 OK');
