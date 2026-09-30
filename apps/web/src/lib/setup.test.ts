import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSteps as build, progress, type SetupStatus } from './setup.ts';
import { makeT } from '../i18n/core.ts';

const en = makeT('en');
const nb = makeT('nb');
const buildSteps = (s: SetupStatus) => build(s, en);

const none: SetupStatus = { places: false, todos: false, calendar: false, emergency: false, reminders: false, partner: false };

test('steps come in a sensible order and start undone', () => {
  const steps = buildSteps(none);
  assert.deepEqual(steps.map((s) => s.id), ['places', 'todos', 'calendar', 'emergency', 'reminders', 'partner']);
  assert.ok(steps.every((s) => !s.done && s.title && s.why && s.cta));
  assert.deepEqual(progress(steps), { done: 0, total: 6, complete: false });
});

test('progress follows the status', () => {
  const steps = buildSteps({ ...none, places: true, calendar: true, reminders: true });
  assert.deepEqual(steps.filter((s) => s.done).map((s) => s.id), ['places', 'calendar', 'reminders']);
  assert.deepEqual(progress(steps), { done: 3, total: 6, complete: false });
  assert.equal(progress(buildSteps({ places: true, todos: true, calendar: true, emergency: true, reminders: true, partner: true })).complete, true);
});

test('every step points at a screen that exists', () => {
  for (const s of buildSteps(none)) assert.ok(['todo', 'house', 'places', 'settings'].includes(s.go), s.id);
});

test('steps are translated', () => {
  const a = build(none, en), b = build(none, nb);
  assert.ok(a.every((s, i) => s.title !== b[i].title && s.why && b[i].why && b[i].cta));
});
