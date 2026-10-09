import test from 'node:test';
import assert from 'node:assert/strict';
import { LOOKS_BY_SEASON, SEASONS, activeSeason, easterSunday, piecesFor, seasonOn } from './seasons.ts';
import { DEFAULT_SETTINGS, loadSettings } from './settings.ts';

const d = (y: number, m: number, day: number) => new Date(y, m - 1, day, 12);

test('Easter Sunday is right for known years', () => {
  assert.deepEqual(easterSunday(2026), { month: 4, day: 5 });
  assert.deepEqual(easterSunday(2025), { month: 4, day: 20 });
  assert.deepEqual(easterSunday(2024), { month: 3, day: 31 });
});

test('the calendar picks the season (Norway)', () => {
  assert.equal(seasonOn(d(2026, 1, 1)), 'newyear');
  assert.equal(seasonOn(d(2026, 1, 20)), 'winter');
  assert.equal(seasonOn(d(2026, 2, 14)), 'valentine');
  assert.equal(seasonOn(d(2026, 2, 20)), 'winter');
  assert.equal(seasonOn(d(2026, 3, 30)), 'easter'); // the Sunday before Easter 5 April
  assert.equal(seasonOn(d(2026, 4, 6)), 'easter'); // Easter Monday
  assert.equal(seasonOn(d(2026, 4, 7)), 'spring');
  assert.equal(seasonOn(d(2026, 5, 17)), 'may17');
  assert.equal(seasonOn(d(2026, 6, 15)), 'summer');
  assert.equal(seasonOn(d(2026, 9, 1)), 'autumn');
  assert.equal(seasonOn(d(2026, 10, 24)), 'autumn');
  assert.equal(seasonOn(d(2026, 10, 31)), 'halloween');
  assert.equal(seasonOn(d(2026, 11, 2)), 'autumn');
  assert.equal(seasonOn(d(2026, 12, 1)), 'christmas');
  assert.equal(seasonOn(d(2026, 12, 26)), 'christmas');
  assert.equal(seasonOn(d(2026, 12, 28)), 'newyear');
});

test('every day of a year has a season, and every season is reachable by date', () => {
  const seen = new Set<string>();
  for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2027, 0, 1); t += 86400000) { const x = new Date(t); seen.add(seasonOn(new Date(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate(), 12))); }
  for (const [id] of SEASONS) assert.ok(seen.has(id), id);
});

test('off shows nothing, a chosen season is shown on any date', () => {
  assert.equal(activeSeason('off', d(2026, 10, 31)), null);
  assert.equal(activeSeason('winter', d(2026, 7, 1)), 'winter');
  assert.equal(activeSeason('auto', d(2026, 10, 31)), 'halloween');
});

test('pieces are few, deterministic and tidy', () => {
  for (const [id] of SEASONS) {
    const a = piecesFor(id, 8);
    assert.deepEqual(a, piecesFor(id, 8));
    assert.equal(a.length, 8);
    for (const p of a) { assert.ok(p.left >= 0 && p.left <= 100); assert.ok(p.size >= 14 && p.size <= 23); assert.ok(p.dur >= 14); assert.ok(p.opacity <= 0.75); assert.ok(LOOKS_BY_SEASON[id].glyphs.includes(p.glyph)); }
  }
});

test('seasonal settings default on, survive a round trip and ignore junk', () => {
  assert.deepEqual(DEFAULT_SETTINGS.seasonal, { mode: 'auto', motion: true, colours: true, badge: true });
  const s = loadSettings({ seasonal: { mode: 'halloween', motion: false, colours: true, badge: false } });
  assert.deepEqual(s.seasonal, { mode: 'halloween', motion: false, colours: true, badge: false });
  assert.deepEqual(loadSettings({ seasonal: { mode: 'tacky', motion: 'x' } }).seasonal, DEFAULT_SETTINGS.seasonal);
  assert.deepEqual(loadSettings(null).seasonal, DEFAULT_SETTINGS.seasonal);
});
