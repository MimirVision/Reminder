import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLinks } from './reminderLinks.ts';

const KEY = 'hmr_' + 'b'.repeat(64);

test('links use the site origin and the key', () => {
  const l = buildLinks('https://home-memory.netlify.app/some/page?x=1', KEY, []);
  assert.equal(l.calendar, `webcal://home-memory.netlify.app/calendar.ics?key=${KEY}`);
  assert.equal(l.calendarHttps, `https://home-memory.netlify.app/calendar.ics?key=${KEY}`);
  assert.equal(l.digest, `https://home-memory.netlify.app/api/remind?key=${KEY}`);
});

test('category places use the shop kind, specific places use their name (encoded)', () => {
  const l = buildLinks('https://s.netlify.app', KEY, [
    { name: 'Any pharmacy (apotek)', kind: 'category', category: 'pharmacy' },
    { name: 'IKEA Furuset', kind: 'fixed', category: 'hardware' },
    { name: 'Byggmax Skøyen & Co', kind: 'fixed', category: null },
  ]);
  assert.equal(l.places[0].url, `https://s.netlify.app/api/remind?key=${KEY}&category=pharmacy`);
  assert.equal(l.places[1].url, `https://s.netlify.app/api/remind?key=${KEY}&place=IKEA+Furuset`);
  assert.match(l.places[2].url, /place=Byggmax\+Sk%C3%B8yen\+%26\+Co$/);
});

test('duplicate links are listed once', () => {
  const l = buildLinks('https://s.netlify.app', KEY, [
    { name: 'A', kind: 'category', category: 'pharmacy' },
    { name: 'B', kind: 'category', category: 'pharmacy' },
  ]);
  assert.equal(l.places.length, 1);
});
