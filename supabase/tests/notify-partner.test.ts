import test from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, createCipheriv, createDecipheriv, hkdfSync, createHmac, createPublicKey, verify } from 'node:crypto';
import { b64uToBytes, buildMessage, bytesToB64u, encryptPayload, isGone, sendPush, vapidAuthorization } from '../functions/notify-partner/logic.ts';

// RFC 8291 appendix A example keys.
const AS_PRIVATE = 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw';
const AS_PUBLIC = 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8';
const UA_PRIVATE = 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94';
const UA_PUBLIC = 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4';
const AUTH = 'BTBZMqHH6r4Tts7J_aSIgg';
const SALT = 'DGv6ra1nlYgDCS1FRnbzlw';

async function senderKeys() {
  const pub = b64uToBytes(AS_PUBLIC);
  const jwk = { kty: 'EC', crv: 'P-256', x: bytesToB64u(pub.slice(1, 33)), y: bytesToB64u(pub.slice(33)), d: AS_PRIVATE };
  return {
    privateKey: await crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']),
    publicKey: await crypto.subtle.importKey('jwk', { ...jwk, d: undefined }, { name: 'ECDH', namedCurve: 'P-256' }, true, []),
  } as CryptoKeyPair;
}

// Independent reference decryption with node:crypto (receiver side, RFC 8291 section 3.4).
function decrypt(body: Uint8Array, uaPrivate: string, uaPublic: string, auth: string): string {
  const salt = body.slice(0, 16);
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  const cipher = body.slice(21 + idlen);
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(Buffer.from(uaPrivate, 'base64url'));
  const secret = ecdh.computeSecret(Buffer.from(asPublic));
  const prk = createHmac('sha256', Buffer.from(auth, 'base64url')).update(secret).digest();
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), Buffer.from(uaPublic, 'base64url'), Buffer.from(asPublic)]);
  const ikm = Buffer.from(hkdfSync('sha256', secret, Buffer.from(auth, 'base64url'), keyInfo, 32));
  void prk;
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(Buffer.from(cipher.slice(-16)));
  const plain = Buffer.concat([d.update(Buffer.from(cipher.slice(0, -16))), d.final()]);
  assert.equal(plain[plain.length - 1], 2, 'record delimiter');
  return plain.subarray(0, -1).toString('utf8');
}

test('RFC 8291 example: header layout and the receiver can decrypt it', async () => {
  const text = 'When I grow up, I want to be a watermelon';
  const body = await encryptPayload(new TextEncoder().encode(text), b64uToBytes(UA_PUBLIC), b64uToBytes(AUTH), { salt: b64uToBytes(SALT), senderKeys: await senderKeys() });
  assert.equal(bytesToB64u(body.slice(0, 16)), SALT);
  assert.deepEqual([...body.slice(16, 20)], [0, 0, 16, 0], 'record size 4096');
  assert.equal(body[20], 65);
  assert.equal(bytesToB64u(body.slice(21, 86)), AS_PUBLIC);
  assert.equal(body.length, 86 + text.length + 1 + 16);
  assert.equal(decrypt(body, UA_PRIVATE, UA_PUBLIC, AUTH), text);
  // The RFC's published body for this example starts with these bytes (salt, rs, idlen, sender key).
  assert.equal(bytesToB64u(body.slice(0, 86)), 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8');
});

test('random salt and sender key per message; oversized and malformed input is refused', async () => {
  const a = await encryptPayload(new TextEncoder().encode('hi'), b64uToBytes(UA_PUBLIC), b64uToBytes(AUTH));
  const b = await encryptPayload(new TextEncoder().encode('hi'), b64uToBytes(UA_PUBLIC), b64uToBytes(AUTH));
  assert.notEqual(bytesToB64u(a), bytesToB64u(b));
  assert.equal(decrypt(a, UA_PRIVATE, UA_PUBLIC, AUTH), 'hi');
  await assert.rejects(() => encryptPayload(new Uint8Array(4000), b64uToBytes(UA_PUBLIC), b64uToBytes(AUTH)), /too large/);
  await assert.rejects(() => encryptPayload(new Uint8Array(3), new Uint8Array(65), b64uToBytes(AUTH)), /bad subscription key/);
});

test('VAPID header carries a valid ES256 JWT for the push service origin', async () => {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const pub = new Uint8Array(ecdh.getPublicKey());
  const header = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', 'mailto:me@example.com', pub, new Uint8Array(ecdh.getPrivateKey()), Date.UTC(2026, 8, 30));
  const m = header.match(/^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/);
  assert.ok(m, header);
  assert.equal(m[4], bytesToB64u(pub));
  const claims = JSON.parse(Buffer.from(m[2], 'base64url').toString());
  assert.deepEqual(claims, { aud: 'https://fcm.googleapis.com', exp: Math.floor(Date.UTC(2026, 8, 30) / 1000) + 43200, sub: 'mailto:me@example.com' });
  const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: bytesToB64u(pub.slice(1, 33)), y: bytesToB64u(pub.slice(33)) }, format: 'jwk' });
  assert.equal(verify('sha256', Buffer.from(`${m[1]}.${m[2]}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(m[3], 'base64url')), true);
});

test('sendPush posts an encrypted body with the right headers and returns the status', async () => {
  const vk = createECDH('prime256v1'); vk.generateKeys();
  let seen: { url: string; init: RequestInit } | undefined;
  const status = await sendPush(
    { endpoint: 'https://push.example/x', p256dh: UA_PUBLIC, auth: AUTH }, { title: 'T', body: 'B' },
    { subject: 'mailto:a@b.c', publicKey: bytesToB64u(new Uint8Array(vk.getPublicKey())), privateKey: bytesToB64u(new Uint8Array(vk.getPrivateKey())) },
    (async (url: string, init: RequestInit) => { seen = { url, init }; return new Response(null, { status: 201 }); }) as never,
  );
  assert.equal(status, 201);
  const h = seen!.init.headers as Record<string, string>;
  assert.equal(h['Content-Encoding'], 'aes128gcm');
  assert.equal(h.TTL, '86400');
  assert.match(h.Authorization, /^vapid t=/);
  assert.deepEqual(JSON.parse(decrypt(seen!.init.body as Uint8Array, UA_PRIVATE, UA_PUBLIC, AUTH)), { title: 'T', body: 'B' });
  assert.equal(isGone(410), true); assert.equal(isGone(404), true); assert.equal(isGone(500), false);
});

test('messages are worded in the recipient language', () => {
  assert.equal(buildMessage('en', 'Anna', ['Milk\nsecond line']).body, 'Anna added: Milk');
  assert.equal(buildMessage('nb', 'Anna', ['Melk']).body, 'Anna la til: Melk');
  assert.equal(buildMessage('nb', 'Anna', ['a', 'b', 'c']).body, 'Anna la til 3 oppgaver');
  assert.equal(buildMessage('en', 'Anna', ['a', 'b']).body, 'Anna added 2 to-dos');
  assert.equal(buildMessage('en', '', ['']).body, 'Your partner added a photo');
  assert.equal(buildMessage('en', 'Anna', ['Milk'], true).body, 'Anna gave you: Milk');
  assert.equal(buildMessage('nb', 'Anna', ['a', 'b'], true).body, 'Anna ga deg 2 oppgaver');
  assert.ok(buildMessage('en', 'A'.repeat(100), ['x'.repeat(500)]).body.length < 170);
});

test('the key generator in docs/ makes keys that the sender accepts', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../../docs/generate-vapid-keys.js', import.meta.url), 'utf8');
  const lines: string[] = [];
  const code = src.split('\n').filter((l) => !l.startsWith('//')).join('\n').trim().replace(/;$/, '');
  await new Function('console', 'crypto', 'atob', 'btoa', `return ${code}`)({ log: (s: string) => lines.push(s) }, crypto, atob, btoa);
  const pub = lines.find((l) => l.startsWith('VAPID_PUBLIC_KEY='))!.split('=')[1];
  const priv = lines.find((l) => l.startsWith('VAPID_PRIVATE_KEY='))!.split('=')[1];
  assert.equal(b64uToBytes(pub).length, 65);
  assert.equal(b64uToBytes(pub)[0], 4);
  assert.equal(b64uToBytes(priv).length, 32);
  const header = await vapidAuthorization('https://web.push.apple.com/abc', 'mailto:me@example.com', b64uToBytes(pub), b64uToBytes(priv));
  assert.match(header, /^vapid t=.+, k=/);
});
