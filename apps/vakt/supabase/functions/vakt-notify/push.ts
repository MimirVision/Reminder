// Web Push (RFC 8030) with payload encryption (RFC 8291, aes128gcm) and VAPID (RFC 8292), on WebCrypto, so it runs in
// Deno (the edge function), browsers and Node (the tests). Vakt's own copy of the code Ledger and Home Memory use,
// so the apps never depend on each other.

const enc = new TextEncoder();
/** Bytes backed by a plain ArrayBuffer, which is what WebCrypto and fetch take. */
type Bytes = Uint8Array<ArrayBuffer>;

export function b64uToBytes(s: string): Bytes {
  const b = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  return Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
}
export function bytesToB64u(bytes: Bytes): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const concat = (...parts: Bytes[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, bytes: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}

export type EncryptOptions = { salt?: Bytes; senderKeys?: CryptoKeyPair };

/** Encrypts `payload` for a push subscription. Returns the request body (header + one record). */
export async function encryptPayload(payload: Bytes, uaPublic: Bytes, authSecret: Bytes, opts: EncryptOptions = {}): Promise<Bytes> {
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error('bad subscription key');
  if (payload.length > 3993) throw new Error('payload too large'); // one 4096-byte record: 4096 - 16 tag - 1 delimiter - 86 header
  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const sender = opts.senderKeys ?? (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']));
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', sender.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, sender.privateKey, 256));
  const keyInfo = concat(enc.encode('WebPush: info\0'), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdh, keyInfo, 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, concat(payload, new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 0x10, 0]); // 4096, big endian
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

/** VAPID `Authorization` header value for a push endpoint. `privateD` is the 32-byte private scalar, `publicKey` the 65-byte point. */
export async function vapidAuthorization(endpoint: string, subject: string, publicKey: Bytes, privateD: Bytes, now = Date.now()): Promise<string> {
  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', x: bytesToB64u(publicKey.slice(1, 33)), y: bytesToB64u(publicKey.slice(33, 65)), d: bytesToB64u(privateD) },
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'],
  );
  const part = (o: unknown) => bytesToB64u(enc.encode(JSON.stringify(o)));
  const signingInput = `${part({ typ: 'JWT', alg: 'ES256' })}.${part({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })}`;
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(signingInput)));
  return `vapid t=${signingInput}.${bytesToB64u(sig)}, k=${bytesToB64u(publicKey)}`;
}

export type PushSub = { endpoint: string; p256dh: string; auth: string };

/** Builds and sends one push. Resolves with the push service's HTTP status. `ttl`: seconds the push service keeps trying a device that is off. */
export async function sendPush(sub: PushSub, payload: unknown, vapid: { subject: string; publicKey: string; privateKey: string }, ttl = 86400, fetchImpl: typeof fetch = fetch): Promise<number> {
  const body = await encryptPayload(enc.encode(JSON.stringify(payload)), b64uToBytes(sub.p256dh), b64uToBytes(sub.auth));
  const res = await fetchImpl(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidAuthorization(sub.endpoint, vapid.subject, b64uToBytes(vapid.publicKey), b64uToBytes(vapid.privateKey)),
      'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: String(ttl), Urgency: 'high',
    },
    body,
  });
  return res.status;
}

/** 404 and 410 mean the subscription is gone for good: forget it. */
export const isGone = (status: number) => status === 404 || status === 410;

/** Push services browsers use. The function only ever posts to these, whatever a device row says. */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^([a-z0-9-]+\.)*push\.services\.mozilla\.com$/, /^web\.push\.apple\.com$/, /^[a-z0-9-]+\.notify\.windows\.com$/];
export function isPushEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    return u.protocol === 'https:' && !u.port && PUSH_HOSTS.some((h) => h.test(u.hostname));
  } catch {
    return false;
  }
}
