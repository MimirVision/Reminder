import test from 'node:test';
import assert from 'node:assert/strict';
import { dayGroup, shortTime, initials, displayName, fileSize } from './format.ts';

const now = new Date(2026, 9, 5, 14, 0); // Mon 5 Oct 2026, local

test('today shows the time, this week the weekday, older the date', () => {
  assert.equal(shortTime(new Date(2026, 9, 5, 8, 42).toISOString(), now), '08:42');
  assert.equal(shortTime(new Date(2026, 9, 2, 8, 0).toISOString(), now), 'Fri');
  assert.match(shortTime(new Date(2026, 8, 20, 8, 0).toISOString(), now), /^20 Sep/);
  assert.match(shortTime(new Date(2025, 8, 20, 8, 0).toISOString(), now), /2025/);
});

test('groups: Today, Yesterday, weekday, month', () => {
  assert.equal(dayGroup(new Date(2026, 9, 5, 1).toISOString(), now), 'Today');
  assert.equal(dayGroup(new Date(2026, 9, 4, 23).toISOString(), now), 'Yesterday');
  assert.equal(dayGroup(new Date(2026, 9, 2, 9).toISOString(), now), 'Friday');
  assert.equal(dayGroup(new Date(2026, 8, 12, 9).toISOString(), now), 'September');
});

test('initials handle one name, two names, dots and empty names', () => {
  assert.equal(initials('Maja Berg'), 'MB');
  assert.equal(initials('Maja'), 'MA');
  assert.equal(initials('', 'anna.larsen@x.no'), 'AL');
  assert.equal(initials('', ''), '?');
});

test('display name falls back to the address', () => {
  assert.equal(displayName(' ', 'a@b.no'), 'a@b.no');
  assert.equal(displayName('Anna', 'a@b.no'), 'Anna');
});

test('file sizes', () => {
  assert.equal(fileSize(900), '900 B');
  assert.equal(fileSize(2048), '2 KB');
  assert.equal(fileSize(5 * 1024 * 1024), '5.0 MB');
});
