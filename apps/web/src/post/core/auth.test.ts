import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCallback } from './auth.ts';

test('no params means nothing to do', () => assert.deepEqual(parseCallback(''), { kind: 'none' }));
test('a code with its sealed state', () => assert.deepEqual(parseCallback('?code=abc&state=v1.x.y'), { kind: 'code', code: 'abc', state: 'v1.x.y' }));
test('a code without state is refused', () => assert.equal(parseCallback('?code=abc').kind, 'error'));
test('friendly messages for the usual Microsoft errors', () => {
  const msg = (q: string) => (parseCallback(q) as { message: string }).message;
  assert.match(msg('?error=access_denied&state=s'), /cancelled/);
  assert.match(msg('?error=invalid_request&error_description=AADSTS65001%3A+consent&state=s'), /organisation needs to approve/);
  assert.match(msg('?error=invalid_request&error_description=AADSTS50011+redirect+uri&state=s'), /redirect/i);
});
