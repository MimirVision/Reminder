// Ledger's Web Push sender: what it encrypts can be decrypted by the browser the way RFC 8291 says, the VAPID header verifies,
// and it only ever posts to real push services.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bundleNotify } from '../build-function.mjs';
import { b64uToBytes, bytesToB64u, encryptPayload, isPushEndpoint, sendPush, vapidAuthorization } from '../functions/ledger-notify/push';

const enc = new TextEncoder();
const hkdf = async (salt: Uint8Array<ArrayBuffer>, ikm: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, n: number) => {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, n * 8));
};
const cat = (...p: Uint8Array[]) => { const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of p) { o.set(x, i); i += x.length; } return o; };

/** What the browser does with a push body: RFC 8291 decryption with its own key pair and auth secret. */
async function decrypt(body: Uint8Array, ua: CryptoKeyPair, auth: Uint8Array<ArrayBuffer>) {
  const salt = body.slice(0, 16), idlen = body[20], asPublic = body.slice(21, 21 + idlen), cipher = body.slice(21 + idlen);
  const uaPublic = new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey));
  const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, ua.privateKey, 256));
  const ikm = await hkdf(auth, ecdh, cat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, cipher));
  expect(plain[plain.length - 1]).toBe(2); // the last-record delimiter
  return new TextDecoder().decode(plain.slice(0, -1));
}

async function browser() {
  const ua = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return { ua, auth, sub: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', p256dh: bytesToB64u(new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey))), auth: bytesToB64u(auth) } };
}
async function vapidKeys() {
  const k = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', k.privateKey);
  return { pair: k, publicKey: bytesToB64u(new Uint8Array(await crypto.subtle.exportKey('raw', k.publicKey))), privateKey: jwk.d! };
}

describe('Web Push', () => {
  it('encrypts so only the subscribed browser can read it', async () => {
    const b = await browser();
    const text = JSON.stringify({ title: 'Due today: Deliver VAT', body: 'Fjordlys AS' });
    const body = await encryptPayload(enc.encode(text), b64uToBytes(b.sub.p256dh), b.auth);
    expect(await decrypt(body, b.ua, b.auth)).toBe(text);
    expect(new TextDecoder().decode(body)).not.toContain('Fjordlys');
  });

  it('signs a VAPID header the push service can verify', async () => {
    const v = await vapidKeys();
    const header = await vapidAuthorization('https://web.push.apple.com/abc', 'mailto:admin@example.com', b64uToBytes(v.publicKey), b64uToBytes(v.privateKey), Date.UTC(2026, 9, 21));
    const [, h, p, s, k] = header.match(/^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/)!;
    expect(k).toBe(v.publicKey);
    expect(JSON.parse(atob(p.replace(/-/g, '+').replace(/_/g, '/')))).toMatchObject({ aud: 'https://web.push.apple.com', sub: 'mailto:admin@example.com' });
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, v.pair.publicKey, b64uToBytes(s), enc.encode(`${h}.${p}`))).toBe(true);
  });

  it('posts the encrypted body with a time to live', async () => {
    const b = await browser(), v = await vapidKeys();
    let seen: { url: string; init: RequestInit } | null = null;
    const status = await sendPush(b.sub, { title: 'Hi' }, { ...v, subject: 'mailto:a@example.com' }, 900,
      (async (url: string, init: RequestInit) => { seen = { url, init }; return new Response(null, { status: 201 }); }) as unknown as typeof fetch);
    expect(status).toBe(201);
    const h = seen!.init.headers as Record<string, string>;
    expect(h).toMatchObject({ TTL: '900', 'Content-Encoding': 'aes128gcm' });
    expect(await decrypt(seen!.init.body as Uint8Array, b.ua, b.auth)).toBe('{"title":"Hi"}');
  });

  it('only posts to push services', () => {
    for (const ok of ['https://fcm.googleapis.com/fcm/send/x', 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://web.push.apple.com/x', 'https://wns2-db5p.notify.windows.com/w/?token=x']) {
      expect(isPushEndpoint(ok), ok).toBe(true);
    }
    for (const bad of ['http://fcm.googleapis.com/x', 'https://fcm.googleapis.com:444/x', 'https://evil.example/fcm.googleapis.com', 'https://fcm.googleapis.com.evil.example/x', 'https://localhost/x', 'nonsense']) {
      expect(isPushEndpoint(bad), bad).toBe(false);
    }
  });

  it('has an up-to-date dashboard copy (npm run build:function)', () => {
    expect(readFileSync(new URL('../dashboard/ledger-notify.ts', import.meta.url), 'utf8')).toBe(bundleNotify());
  });
});
