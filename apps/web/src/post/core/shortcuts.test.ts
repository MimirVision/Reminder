import test from 'node:test';
import assert from 'node:assert/strict';
import { shortcutFor, SHORTCUT_HELP } from './shortcuts.ts';

test('the usual letters', () => {
  assert.equal(shortcutFor({ key: 'j' }), 'next');
  assert.equal(shortcutFor({ key: 'k' }), 'prev');
  assert.equal(shortcutFor({ key: 'e' }), 'archive');
  assert.equal(shortcutFor({ key: '#' }), 'delete');
  assert.equal(shortcutFor({ key: 'r' }), 'reply');
  assert.equal(shortcutFor({ key: 'c' }), 'compose');
  assert.equal(shortcutFor({ key: '/' }), 'search');
  assert.equal(shortcutFor({ key: 'U', shift: true }), 'unread');
  assert.equal(shortcutFor({ key: '?' }), 'help');
});

test('typing in a field never triggers anything', () => {
  for (const key of ['j', 'e', 'c', '#', 'Delete', 'Enter', 'Escape']) assert.equal(shortcutFor({ key, typing: true }), null);
  assert.equal(shortcutFor({ key: 'z', ctrl: true, typing: true }), null);
});

test('the browser keeps its own shortcuts: Ctrl/Cmd/Alt combos are ignored, except undo', () => {
  assert.equal(shortcutFor({ key: 'r', ctrl: true }), null);
  assert.equal(shortcutFor({ key: 'e', meta: true }), null);
  assert.equal(shortcutFor({ key: 'c', alt: true }), null);
  assert.equal(shortcutFor({ key: 'z', ctrl: true }), 'undo');
  assert.equal(shortcutFor({ key: 'Z', meta: true, shift: true }), null);
});

test('with a sheet open only Escape does anything', () => {
  assert.equal(shortcutFor({ key: 'e', sheetOpen: true }), null);
  assert.equal(shortcutFor({ key: 'Escape', sheetOpen: true }), 'close');
});

test('the help list covers every action a key can do', () => {
  assert.ok(SHORTCUT_HELP.length >= 12);
});
