import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSetupCode, parseSetupCode, validConfig } from './setup.ts';

const cfg = { url: 'https://abc.supabase.co/functions/v1/post-alerts', key: 'secret-key-1234', clientId: '11111111-2222-3333-4444-555555555555' };

test('round trip, also with letters outside ASCII', () => {
  assert.deepEqual(parseSetupCode(makeSetupCode(cfg)), cfg);
  const odd = { ...cfg, key: 'nøkkel-æøå-12345' };
  assert.deepEqual(parseSetupCode(makeSetupCode(odd)), odd);
});

test('finds the code inside a link or a pasted sentence', () => {
  const code = makeSetupCode(cfg);
  assert.deepEqual(parseSetupCode(`https://x.dev/post/#s=${code}`), cfg);
  assert.deepEqual(parseSetupCode(`  here: ${code}\n`), cfg);
});

test('refuses anything that is not a valid code', () => {
  assert.equal(parseSetupCode(''), null);
  assert.equal(parseSetupCode('post1.!!!'), null);
  assert.equal(parseSetupCode('post1.' + btoa(JSON.stringify(['http://insecure', 'k', 'x']))), null);
});

test('validation: https only, key present, a real GUID', () => {
  assert.equal(validConfig(cfg), true);
  assert.equal(validConfig({ ...cfg, url: 'http://x' }), false);
  assert.equal(validConfig({ ...cfg, clientId: 'not-a-guid' }), false);
  assert.equal(validConfig({ ...cfg, key: '' }), false);
});
