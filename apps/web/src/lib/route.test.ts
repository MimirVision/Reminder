import test from 'node:test';
import assert from 'node:assert/strict';
import { appleRouteUrl, dwellMinutes, fmtClock, googleRouteUrl, planRoute, trafficFactor, type Matrix } from './route.ts';

// Points on a line: start 0, stops at 10, 20, 30 (minutes of driving = distance), end back at 0.
const pos = [0, 10, 20, 30, 0];
const line = (): Matrix => pos.map((a) => pos.map((b) => Math.abs(a - b) * 60));
const stops = (n: number, extra = {}) => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, dwellMin: 5, ...extra }));
const SAT = 6; // no rush hour
const MON = 1;

test('visits stops in the cheapest order along a line', () => {
  // Stops given scrambled: positions 20, 30, 10 -> best order is 10, 20, 30 (index 2, 0, 1).
  const p = [0, 20, 30, 10, 0];
  const m = p.map((a) => p.map((b) => Math.abs(a - b) * 60));
  const r = planRoute(m, stops(3), 10 * 60, SAT);
  assert.deepEqual(r.order, [2, 0, 1]);
  assert.equal(Math.round(r.driveMin), 60);
  assert.equal(r.stopMin, 15);
  assert.equal(Math.round(r.endMin - 10 * 60), 75);
});

test('a deadline can beat the shortest drive', () => {
  // Stop 2 (position 30) must be reached within 40 minutes of leaving, so it goes first even though that is not the shortest.
  const free = planRoute(line(), stops(3), 600, SAT);
  assert.deepEqual(free.order, [0, 1, 2]);
  const s = stops(3); (s[2] as { byMin?: number }).byMin = 600 + 31;
  const dl = planRoute(line(), s, 600, SAT);
  assert.equal(dl.late.every((l) => l === 0), true);
  assert.deepEqual(dl.order, [2, 1, 0], 'the far stop with a deadline goes first at no extra drive');
  // A real conflict: stop 0 (pos 10) has a tight deadline too, both cannot be met; the plan minimises lateness, not crashes.
  const t = stops(3); (t[2] as { byMin?: number }).byMin = 600 + 31; (t[0] as { byMin?: number }).byMin = 600 + 11;
  const r = planRoute(line(), t, 600, SAT);
  assert.equal(r.order.length, 3);
});

test('rush hour makes the same drive longer; weekends and evenings do not', () => {
  assert.ok(trafficFactor(8 * 60, MON) > 1.2);
  assert.ok(trafficFactor(16 * 60, MON) > 1.2);
  assert.equal(trafficFactor(20 * 60, MON), 1);
  assert.equal(trafficFactor(8 * 60, SAT), 1);
  const rush = planRoute(line(), stops(3), 8 * 60, MON);
  const calm = planRoute(line(), stops(3), 20 * 60, MON);
  assert.ok(rush.driveMin > calm.driveMin * 1.2);
  assert.equal(Math.round(calm.freeFlowMin), 60);
});

test('more than eight stops still gives a valid, sensible order', () => {
  const n = 11;
  const p = [0, ...Array.from({ length: n }, (_, i) => ((i * 7) % n) * 10 + 10), 0];
  const m = p.map((a) => p.map((b) => Math.abs(a - b) * 60));
  const r = planRoute(m, stops(n), 600, SAT);
  assert.deepEqual([...r.order].sort((a, b) => a - b), Array.from({ length: n }, (_, i) => i));
  assert.ok(r.driveMin <= 2 * 110 * 1.11, 'a sweep along the line: out and back');
});

test('no stops is just start to end; dwell time grows with the number of tasks', () => {
  const r = planRoute([[0, 300], [300, 0]], [], 600, SAT);
  assert.deepEqual(r.order, []);
  assert.equal(Math.round(r.driveMin), 5);
  assert.equal(dwellMinutes('grocery', 1), 15);
  assert.equal(dwellMinutes('grocery', 4), 24);
  assert.equal(dwellMinutes(null, 1), 10);
  assert.equal(dwellMinutes('hardware', 100), 60);
});

test('navigation links list the stops in order', () => {
  const a = { lat: 59.9, lon: 10.7 }, b = { lat: 59.91, lon: 10.71 }, c = { lat: 59.92, lon: 10.72 }, d = { lat: 59.93, lon: 10.73 };
  assert.match(googleRouteUrl(a, [b, c], d), /origin=59\.900000,10\.700000&destination=59\.930000,10\.730000&waypoints=59\.910000,10\.710000%7C59\.920000,10\.720000/);
  assert.match(appleRouteUrl(a, [b, c], d), /saddr=59\.900000,10\.700000&daddr=59\.910000,10\.710000\+to:59\.920000,10\.720000\+to:59\.930000,10\.730000/);
  assert.doesNotMatch(googleRouteUrl(a, [], d), /waypoints/);
  assert.equal(fmtClock(9 * 60 + 5), '09:05');
});
