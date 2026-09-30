import test from 'node:test';
import assert from 'node:assert/strict';
import { distanceM } from './geo.ts';
import { needsRefresh, overpassQuery, parseOverpass } from './pois.ts';
import { MAX_REGIONS, selectRegions } from './regions.ts';
import { notificationText, onRegionEvent, PLACE_COOLDOWN_MS, type SurfaceState } from './surfacing.ts';
import type { MemoryRow, PlaceRow } from './types.ts';

const oslo = { lat: 59.9139, lon: 10.7522 };
const mem = (id: string, place: string | null, over: Partial<MemoryRow> = {}): MemoryRow => ({
  id, body: `memory ${id}`, status: 'active', place_id: place, snoozed_until: null, ...over,
});
const pharmacy: PlaceRow = { id: 'ph', name: 'Any pharmacy', kind: 'category', category: 'pharmacy', lat: null, lon: null, radius_m: 150 };
const home: PlaceRow = { id: 'home', name: 'Home', kind: 'fixed', category: null, lat: 59.95, lon: 10.8, radius_m: 150 };

test('distance is roughly right', () => {
  const d = distanceM(oslo, { lat: 59.9239, lon: 10.7522 }); // ~0.01 deg lat
  assert.ok(d > 1090 && d < 1130, String(d));
});

test('overpass query and parsing', () => {
  assert.equal(overpassQuery('nope', oslo, 1000), null);
  assert.match(overpassQuery('pharmacy', oslo, 5000)!, /nwr\["amenity"="pharmacy"\]\(around:5000,59\.9139,10\.7522\)/);
  assert.match(overpassQuery('hardware', oslo, 5000)!, /\["shop"~"\^\(doityourself\|hardware\|building_materials\)\$"\]/);
  const pois = parseOverpass('pharmacy', {
    elements: [
      { type: 'node', id: 1, lat: 59.91, lon: 10.75, tags: { name: 'Apotek 1' } },
      { type: 'way', id: 2, center: { lat: 59.92, lon: 10.76 } },
      { type: 'node', id: 3 }, // no coordinates: skipped
    ],
  });
  assert.deepEqual(pois.map((p) => [p.id, p.name]), [['node/1', 'Apotek 1'], ['way/2', 'Pharmacy']]);
});

test('poi cache refresh rules', () => {
  const now = Date.now();
  const cache = { center: oslo, fetchedAt: now, byCategory: {} };
  assert.equal(needsRefresh(null, oslo, now), true);
  assert.equal(needsRefresh(cache, oslo, now + 1000), false);
  assert.equal(needsRefresh(cache, { lat: 60.0, lon: 10.75 }, now + 1000), true, 'moved >2km');
  assert.equal(needsRefresh(cache, oslo, now + 25 * 3600_000), true, 'stale');
});

test('regions only cover places that have active memories, nearest first', () => {
  const pois = { pharmacy: [
    { id: 'far', name: 'Far Apotek', lat: 60.2, lon: 10.9 },
    { id: 'near', name: 'Near Apotek', lat: 59.915, lon: 10.753 },
  ] };
  const r = selectRegions({ places: [pharmacy, home], memories: [mem('a', 'ph')], pois, here: oslo });
  assert.deepEqual(r.map((x) => x.identifier), ['ph|near', 'ph|far']);
  assert.ok(!r.some((x) => x.placeId === 'home'), 'home has no memories');

  const done = selectRegions({ places: [pharmacy], memories: [mem('a', 'ph', { status: 'done' })], pois, here: oslo });
  assert.equal(done.length, 0);
});

test('regions respect the iOS limit', () => {
  const pois = { pharmacy: Array.from({ length: 50 }, (_, i) => ({ id: `p${i}`, name: `A${i}`, lat: 59.9 + i * 0.001, lon: 10.75 })) };
  const r = selectRegions({ places: [pharmacy], memories: [mem('a', 'ph')], pois, here: oslo });
  assert.equal(r.length, MAX_REGIONS);
  assert.equal(r[0].identifier, 'ph|p14'); // closest to 59.9139
});

test('notification text batches long lists', () => {
  const t = notificationText('Apotek 1', [1, 2, 3, 4, 5].map((n) => ({ body: `item ${n}` })));
  assert.equal(t.title, 'Near Apotek 1');
  assert.equal(t.body, 'item 1\nitem 2\nitem 3\n+2 more');
  assert.equal(notificationText('X', [{ body: '  ' }]).body, '(photo)');
});

test('fires once per visit and respects cooldown, snooze and status', () => {
  const t0 = 1_700_000_000_000;
  const memories = [mem('a', 'ph'), mem('b', 'ph', { snoozed_until: new Date(t0 + 3600_000).toISOString() }), mem('c', 'ph', { status: 'done' })];
  let state: SurfaceState = {};
  const base = { placeId: 'ph', label: 'Apotek 1', places: [pharmacy], memories };

  let r = onRegionEvent({ ...base, type: 'enter', state, now: t0 });
  assert.deepEqual(r.notice?.memoryIds, ['a'], 'snoozed and done are skipped');
  state = r.state;

  r = onRegionEvent({ ...base, type: 'enter', state, now: t0 + 60_000 });
  assert.equal(r.notice, null, 'cooldown: second pharmacy right after');
  state = r.state;

  r = onRegionEvent({ ...base, type: 'exit', state, now: t0 + 120_000 });
  state = r.state;
  assert.equal(state['ph'].inside, false);

  r = onRegionEvent({ ...base, type: 'enter', state, now: t0 + PLACE_COOLDOWN_MS - 1 });
  assert.equal(r.notice, null, 'still cooling down');
  r = onRegionEvent({ ...base, type: 'enter', state, now: t0 + PLACE_COOLDOWN_MS + 2 * 3600_000 });
  assert.deepEqual(r.notice?.memoryIds, ['a', 'b'], 'next visit after cooldown, snooze expired');
});

test('no memories, no notification (and no cooldown consumed)', () => {
  const r = onRegionEvent({ type: 'enter', placeId: 'ph', label: 'X', places: [pharmacy], memories: [], state: {}, now: 1 });
  assert.equal(r.notice, null);
  assert.equal(r.state['ph'].lastNotifiedAt, null);
});
