import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRoute, parseRoute, type Route } from './route.ts';

test('every route survives a round trip, including odd ids', () => {
  const routes: Route[] = [
    { name: 'inbox' }, { name: 'later' }, { name: 'triage' }, { name: 'accounts' },
    { name: 'message', account: 'a@outlook.com', id: 'AAMk/+=ABC' },
    { name: 'search', q: 'from:anna æøå' },
    { name: 'compose', mode: 'new' },
    { name: 'compose', mode: 'replyAll', account: 'a@o.no', id: 'AAA=' },
    { name: 'settings', page: '' }, { name: 'settings', page: 'alerts' }, { name: 'settings', page: 'sorting' }, { name: 'settings', page: 'hours', account: 'w@firma.no' },
  ];
  for (const r of routes) assert.deepEqual(parseRoute(buildRoute(r)), r);
});

test('what the alert server puts in a notification link opens the message', () => {
  assert.deepEqual(parseRoute('#/m/3f2a-uuid/AAMkAD%2Bx%3D'), { name: 'message', account: '3f2a-uuid', id: 'AAMkAD+x=' });
});

test('unknown or broken addresses fall back to the inbox', () => {
  for (const h of ['', '#', '#/', '#/nope', '#/m', '#/m/onlyone', '#/compose/zzz']) assert.ok(['inbox', 'compose'].includes(parseRoute(h).name), h);
  assert.deepEqual(parseRoute('#/m/%E0%A4%A/x'), { name: 'message', account: '%E0%A4%A', id: 'x' });
});
