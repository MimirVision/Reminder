import test from 'node:test';
import assert from 'node:assert/strict';
import { inviteFromSearch, inviteLink } from './invite.ts';

test('reads a plausible code from the query string', () => {
  assert.equal(inviteFromSearch('?join=abc12345'), 'abc12345');
  assert.equal(inviteFromSearch('?x=1&join=ABC12345DEF67890'), 'abc12345def67890', 'lower-cased');
  assert.equal(inviteFromSearch('?join=%20abc12345%20'), 'abc12345', 'trimmed');
});

test('ignores missing or implausible codes', () => {
  for (const s of ['', '?', '?join=', '?join=short', '?join=not-hex-zzzzzzzz', '?join=' + 'a'.repeat(40), '?join=abc12345<script>']) {
    assert.equal(inviteFromSearch(s), null, s);
  }
});

test('invite link is the site root with the code', () => {
  assert.equal(inviteLink('https://home.netlify.app/some/page?x=1', 'abc12345'), 'https://home.netlify.app/?join=abc12345');
});
