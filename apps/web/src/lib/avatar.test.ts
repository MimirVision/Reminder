import test from 'node:test';
import assert from 'node:assert/strict';
import { avatarHue, initials } from './avatar.ts';

test('initials from one or more names, unicode aware', () => {
  assert.equal(initials('Anna'), 'A');
  assert.equal(initials('anna lise berg'), 'AB');
  assert.equal(initials('  Åse  '), 'Å');
  assert.equal(initials(''), '?');
  assert.equal(initials(null), '?');
});

test('a person always gets the same colour, and two people usually differ', () => {
  assert.equal(avatarHue('user-1'), avatarHue('user-1'));
  const hues = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(avatarHue));
  assert.ok(hues.size > 1);
});
