import test from 'node:test';
import assert from 'node:assert/strict';
import handler, { config } from '../functions/remind.mjs';

const KEY = 'hmr_' + 'a'.repeat(64);
const feed = {
  household: 'Home', generated_at: '',
  places: [{ id: 'p1', name: 'IKEA Furuset', kind: 'fixed', category: 'hardware', radius_m: 300 }],
  todos: [{ id: 't1', body: 'Bookshelf', place_id: 'p1', created_at: '' }],
  tasks: [{ id: 'k1', title: 'Clean gutters', notes: null, schedule: 'interval', interval_months: 12, window_start_month: null, window_end_month: null, next_due_at: '2020-01-01', due_until: null, last_done_at: null }],
  facts: [],
};

function setup({ env = { VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_ANON_KEY: 'sb_publishable_k' }, rpc } = {}) {
  globalThis.Netlify = { env: { get: (k) => env[k] } };
  const calls = [];
  globalThis.fetch = async (u, init) => { calls.push({ u, init }); return rpc ? rpc(u, init) : Response.json(feed); };
  return calls;
}
const call = (path) => handler(new Request(`https://site.netlify.app${path}`));

test('config serves both links', () => {
  assert.deepEqual(config.path, ['/api/remind', '/calendar.ics']);
});

test('ping works without a key and reports configuration', async () => {
  setup();
  assert.equal(await (await call('/api/remind?ping=1')).text(), 'ok: configured');
  setup({ env: {} });
  assert.match(await (await call('/api/remind?ping=1')).text(), /missing Supabase/);
  assert.equal((await call('/api/remind?key=x')).status, 500, 'not configured');
});

test('rejects malformed keys without calling the database', async () => {
  const calls = setup();
  for (const path of ['/api/remind', '/api/remind?key=', '/api/remind?key=hmr_short', '/api/remind?key=' + 'z'.repeat(68)]) {
    assert.equal((await call(path)).status, 401, path);
  }
  assert.equal(calls.length, 0);
});

test('place and digest text', async () => {
  setup();
  const place = await call(`/api/remind?key=${KEY}&place=ikea`);
  assert.equal(place.status, 200);
  assert.match(place.headers.get('content-type'), /text\/plain/);
  assert.equal(place.headers.get('cache-control'), 'no-store');
  assert.equal(await place.text(), '1 to-do at IKEA Furuset:\n- Bookshelf');
  const digest = await (await call(`/api/remind?key=${KEY}`)).text();
  assert.match(digest, /^Home Memory\nDue now: Clean gutters\nTo-dos: 1 waiting/);
  assert.equal(await (await call(`/api/remind?key=${KEY}&place=nowhere`)).text(), '', 'empty when there is nothing');
});

test('calendar feed', async () => {
  setup();
  const res = await call(`/calendar.ics?key=${KEY}`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/calendar/);
  const body = await res.text();
  assert.match(body, /BEGIN:VCALENDAR/);
  assert.match(body, /SUMMARY:Clean gutters/);
});

test('revoked key and database trouble', async () => {
  setup({ rpc: async () => Response.json(null) });
  const revoked = await call(`/api/remind?key=${KEY}`);
  assert.equal(revoked.status, 401);
  assert.match(await revoked.text(), /revoked/);
  setup({ rpc: async () => new Response('boom', { status: 500 }) });
  assert.equal((await call(`/api/remind?key=${KEY}`)).status, 502);
});

test('the key is sent to Supabase in the body, never in the URL', async () => {
  const calls = setup();
  await call(`/api/remind?key=${KEY}`);
  assert.equal(calls[0].u, 'https://x.supabase.co/rest/v1/rpc/reminder_feed');
  assert.ok(!calls[0].u.includes(KEY));
  assert.equal(JSON.parse(calls[0].init.body).p_key, KEY);
});
