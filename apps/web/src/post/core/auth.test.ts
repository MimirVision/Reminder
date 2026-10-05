import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseCallback, startSignIn } from './auth.ts';

test('the sign-in link carries a PKCE challenge that matches the verifier', async () => {
  const s = await startSignIn({ clientId: 'CID', redirectUri: 'https://x.dev/post/', loginHint: 'a@b.no' });
  const u = new URL(s.url);
  assert.equal(u.origin + u.pathname, 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(u.searchParams.get('code_challenge'), createHash('sha256').update(s.verifier).digest('base64url'));
  assert.equal(u.searchParams.get('state'), s.state);
  assert.equal(u.searchParams.get('redirect_uri'), 'https://x.dev/post/');
  assert.equal(u.searchParams.get('login_hint'), 'a@b.no');
  assert.match(u.searchParams.get('scope')!, /Mail\.ReadWrite/);
  assert.match(u.searchParams.get('scope')!, /offline_access/);
  assert.ok(s.verifier.length >= 43);
});

test('each sign-in is unique', async () => {
  const a = await startSignIn({ clientId: 'c', redirectUri: 'https://x/' });
  const b = await startSignIn({ clientId: 'c', redirectUri: 'https://x/' });
  assert.notEqual(a.verifier, b.verifier);
  assert.notEqual(a.state, b.state);
});

test('callback: no params means nothing to do', () => assert.deepEqual(parseCallback('', 's'), { kind: 'none' }));
test('callback: code with the right state', () => assert.deepEqual(parseCallback('?code=abc&state=s', 's'), { kind: 'code', code: 'abc' }));
test('callback: wrong or missing state is refused', () => {
  assert.equal(parseCallback('?code=abc&state=other', 's').kind, 'error');
  assert.equal(parseCallback('?code=abc&state=s', null).kind, 'error');
});
test('callback: friendly messages for the usual Microsoft errors', () => {
  const msg = (q: string) => (parseCallback(q, 's') as { message: string }).message;
  assert.match(msg('?error=access_denied&state=s'), /cancelled/);
  assert.match(msg('?error=invalid_request&error_description=AADSTS65001%3A+consent&state=s'), /organisation needs to approve/);
  assert.match(msg('?error=invalid_request&error_description=AADSTS50011+redirect+uri&state=s'), /redirect/i);
});
