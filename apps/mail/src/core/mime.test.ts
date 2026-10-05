import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeWords, parseAddress, parseAddressList, parseHeaders } from './mime.ts';

test('parseHeaders unfolds continuation lines and lower-cases names', () => {
  const h = parseHeaders('Subject: one\r\n two\r\n\tthree\r\nFrom: a@b.no\r\n\r\n');
  assert.equal(h.subject, 'one two three');
  assert.equal(h.from, 'a@b.no');
});

test('decodeWords: Q and B encodings in UTF-8', () => {
  assert.equal(decodeWords('=?UTF-8?Q?Str=C3=B8mregning_for_september?='), 'Strømregning for september');
  assert.equal(decodeWords('=?UTF-8?B?TWFqYSBCZXJn?='), 'Maja Berg');
});

test('decodeWords: whitespace between adjacent encoded words disappears, other text stays', () => {
  assert.equal(decodeWords('=?UTF-8?Q?M=C3=B8te_torsdag?=\r\n =?UTF-8?Q?_kl._10=3F?='), 'Møte torsdag kl. 10?');
  assert.equal(decodeWords('Re: =?UTF-8?Q?p=C3=A5ska?= nå'), 'Re: påska nå');
});

test('decodeWords: legacy charsets', () => {
  assert.equal(decodeWords('=?iso-8859-1?Q?Bj=F8rn?='), 'Bjørn');
  assert.equal(decodeWords('=?windows-1252?Q?Pris_=80_100?='), 'Pris € 100');
  assert.equal(decodeWords('plain text'), 'plain text');
});

test('parseAddress handles quoted names with commas, encoded names and bare addresses', () => {
  assert.deepEqual(parseAddress('"Hansen, Ola" <ola@example.no>'), { name: 'Hansen, Ola', address: 'ola@example.no' });
  assert.deepEqual(parseAddress('=?UTF-8?B?TWFqYSBCZXJn?= <maja@example.no>'), { name: 'Maja Berg', address: 'maja@example.no' });
  assert.deepEqual(parseAddress('kari@example.no'), { name: '', address: 'kari@example.no' });
  assert.deepEqual(parseAddress('<x@y.no>'), { name: '', address: 'x@y.no' });
});

test('parseAddressList does not split on commas inside quotes', () => {
  const l = parseAddressList('"Hansen, Ola" <ola@example.no>, kari@example.no, Maja <maja@example.no>');
  assert.deepEqual(l.map((a) => a.address), ['ola@example.no', 'kari@example.no', 'maja@example.no']);
  assert.deepEqual(parseAddressList(undefined), []);
});
