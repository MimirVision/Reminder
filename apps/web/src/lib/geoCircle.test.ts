import test from 'node:test';
import assert from 'node:assert/strict';
import { circlePolygon } from './geoCircle.ts';
import { distanceM } from './geo.ts';

test('every point of the circle is the radius away, and the ring is closed', () => {
  const ring = circlePolygon(59.93, 10.75, 200);
  assert.deepEqual(ring[0], ring[ring.length - 1].map((v, i) => (i === 0 ? v : v)) as [number, number], 'closed');
  for (const [lon, lat] of ring) assert.ok(Math.abs(distanceM({ lat: 59.93, lon: 10.75 }, { lat, lon }) - 200) < 3);
});
