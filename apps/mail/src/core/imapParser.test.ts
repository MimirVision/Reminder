import test from 'node:test';
import assert from 'node:assert/strict';
import { latin1Decode, utf8Decode, utf8Encode } from './bytes.ts';
import { decodeMutf7, fetchItems, parseResponse, ResponseReader, tokenText, tokenize } from './imapParser.ts';

const enc = (s: string) => Uint8Array.from(Buffer.from(s, 'latin1'));

test('tokenize: atoms, quoted strings, NIL, nested lists', () => {
  assert.deepEqual(tokenize([{ text: '(\\HasNoChildren \\Sent) "/" "Sent \\"Mail\\"" NIL' }]), [['\\HasNoChildren', '\\Sent'], '/', 'Sent "Mail"', null]);
});

test('tokenize: a BODY[...] section stays one atom even with spaces and parentheses inside', () => {
  const t = tokenize([{ text: '(UID 7 BODY[HEADER.FIELDS (FROM SUBJECT)] ' }, { lit: enc('x') }, { text: ')' }]);
  const items = fetchItems(t[0]);
  assert.equal(tokenText(items.get('UID')), '7');
  assert.equal(tokenText(items.get('BODY[HEADER.FIELDS (FROM SUBJECT)]')), 'x');
});

test('parseResponse: tagged, untagged status with code, counts, lists, continuation', () => {
  assert.deepEqual(parseResponse([{ text: 'A0002 NO [AUTHENTICATIONFAILED] Invalid credentials (Failure)' }]), {
    kind: 'tagged',
    tag: 'A0002',
    status: 'NO',
    code: 'AUTHENTICATIONFAILED',
    text: 'Invalid credentials (Failure)',
  });
  const ok = parseResponse([{ text: '* OK [UIDVALIDITY 3857529045] UIDs valid' }]);
  assert.equal(ok.kind === 'untagged' && ok.code, 'UIDVALIDITY 3857529045');
  const ex = parseResponse([{ text: '* 18 EXISTS' }]);
  assert.ok(ex.kind === 'untagged' && ex.seq === 18 && ex.name === 'EXISTS');
  const ls = parseResponse([{ text: '* LIST (\\Sent) "/" "Sendt"' }]);
  assert.ok(ls.kind === 'untagged' && ls.name === 'LIST' && ls.tokens.length === 3);
  assert.deepEqual(parseResponse([{ text: '+ go ahead' }]), { kind: 'continue', text: 'go ahead' });
});

test('ResponseReader: a literal split across many chunks gives the same result as one chunk', () => {
  const wire = '* 1 FETCH (UID 5 BODY[HEADER.FIELDS (SUBJECT)] {15}\r\nSubject: Hi\r\n\r\n)\r\nA0001 OK done\r\n';
  const whole = new ResponseReader().push(enc(wire));
  const r = new ResponseReader();
  const pieces: ReturnType<ResponseReader['push']> = [];
  for (const b of enc(wire)) pieces.push(...r.push(Uint8Array.of(b)));
  assert.equal(whole.length, 2);
  assert.deepEqual(pieces, whole);
  const f = whole[0];
  assert.ok(f.kind === 'untagged' && f.name === 'FETCH');
  const items = fetchItems(f.kind === 'untagged' ? f.tokens[0] : undefined);
  assert.equal(tokenText(items.get('BODY[HEADER.FIELDS (SUBJECT)]')), 'Subject: Hi\r\n\r\n');
});

test('ResponseReader: waits for the rest of a literal instead of guessing', () => {
  const r = new ResponseReader();
  assert.deepEqual(r.push(enc('* 1 FETCH (BODY[TEXT] {10}\r\nabc')), []);
  const out = r.push(enc('defghij)\r\n'));
  assert.equal(out.length, 1);
});

test('decodeMutf7 handles Norwegian folder names and a literal ampersand', () => {
  assert.equal(decodeMutf7('S&APg-ppelkasse'), 'Søppelkasse');
  assert.equal(decodeMutf7('Tom &- Jerry'), 'Tom & Jerry');
  assert.equal(decodeMutf7('INBOX'), 'INBOX');
});

test('utf8 helpers round-trip text with emoji and survive broken bytes', () => {
  const s = 'Strøm å æ 🎉';
  assert.equal(utf8Decode(utf8Encode(s)), s);
  assert.equal(utf8Decode(Uint8Array.of(0x61, 0xff, 0x62)), 'a�b');
  assert.equal(latin1Decode(Uint8Array.of(0xe5)), 'å');
});

test('base64Encode matches the standard encoding for every padding length', async () => {
  const { base64Encode } = await import('./bytes.ts');
  for (const s of ['', 'f', 'fo', 'foo', 'foob', 'fooba', 'foobar', 'user=a\x01auth=Bearer t\x01\x01']) assert.equal(base64Encode(Uint8Array.from(Buffer.from(s, 'latin1'))), Buffer.from(s, 'latin1').toString('base64'));
});

test('ResponseReader handles a multi-megabyte literal arriving in small chunks without re-copying it every time', () => {
  const size = 4 * 1024 * 1024;
  const body = new Uint8Array(size).fill(65);
  const head = enc(`* 1 FETCH (BODY[TEXT] {${size}}\r\n`);
  const tail = enc(')\r\nA0001 OK done\r\n');
  const wire = new Uint8Array(head.length + size + tail.length);
  wire.set(head, 0);
  wire.set(body, head.length);
  wire.set(tail, head.length + size);
  const r = new ResponseReader();
  const t0 = Date.now();
  let out: ReturnType<ResponseReader['push']> = [];
  for (let i = 0; i < wire.length; i += 1024) out = out.concat(r.push(wire.subarray(i, i + 1024)));
  const ms = Date.now() - t0;
  assert.equal(out.length, 2);
  const f = out[0];
  const lit = f.kind === 'untagged' ? (f.tokens[0] as Array<{ lit: Uint8Array }>)[1].lit : null;
  assert.equal(lit?.length, size);
  assert.ok(ms < 400, `took ${ms} ms`);
});
