import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPins } from './pins.ts';
import type { Place } from './types.ts';

const place = (o: Partial<Place>): Place => ({ id: 'p', household_id: 'h', name: 'P', kind: 'fixed', category: null, lat: 59.9, lon: 10.7, radius_m: 150, ...o });

test('saved places are pinned even without to-dos; kinds only with to-dos and nearby shops', () => {
  const places = [place({ id: 'a', name: 'Home' }), place({ id: 'b', kind: 'category', category: 'pharmacy', lat: null, lon: null }), place({ id: 'c', kind: 'category', category: 'paint', lat: null, lon: null })];
  const pins = buildPins(places, new Map([['b', 2]]), { pharmacy: [{ id: 'n/1', name: 'Vitus', lat: 59.91, lon: 10.72 }, { id: 'n/2', name: 'Boots', lat: 59.92, lon: 10.73 }], paint: [{ id: 'n/3', name: 'Jotun', lat: 1, lon: 1 }] });
  assert.deepEqual(pins.map((p) => [p.key, p.count]), [['a', 0], ['b|n/1', 2], ['b|n/2', 2]]);
});

test('places without coordinates are skipped', () => {
  assert.deepEqual(buildPins([place({ lat: null, lon: null })], new Map(), {}), []);
});
