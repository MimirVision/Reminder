// Pure logic for the `notify-partner` edge function: Web Push (RFC 8030) with payload encryption (RFC 8291, aes128gcm)
// and VAPID (RFC 8292), written on WebCrypto so it runs in Deno, browsers and Node. Unit tested (tests/notify-partner.test.ts).

const enc = new TextEncoder();

export function b64uToBytes(s: string): Uint8Array {
  const b = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  return Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
}
export function bytesToB64u(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}

export type EncryptOptions = { salt?: Uint8Array; senderKeys?: CryptoKeyPair };

/** Encrypts `payload` for a push subscription. Returns the request body (header + one record). */
export async function encryptPayload(payload: Uint8Array, uaPublic: Uint8Array, authSecret: Uint8Array, opts: EncryptOptions = {}): Promise<Uint8Array> {
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
export async function vapidAuthorization(endpoint: string, subject: string, publicKey: Uint8Array, privateD: Uint8Array, now = Date.now()): Promise<string> {
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

/** Builds and sends one push. Resolves with the push service's HTTP status. */
export async function sendPush(sub: PushSub, payload: unknown, vapid: { subject: string; publicKey: string; privateKey: string }, fetchImpl: typeof fetch = fetch): Promise<number> {
  const body = await encryptPayload(enc.encode(JSON.stringify(payload)), b64uToBytes(sub.p256dh), b64uToBytes(sub.auth));
  const res = await fetchImpl(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidAuthorization(sub.endpoint, vapid.subject, b64uToBytes(vapid.publicKey), b64uToBytes(vapid.privateKey)),
      'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'normal',
    },
    body,
  });
  return res.status;
}

/** 404 and 410 mean the subscription is gone for good: forget it. */
export const isGone = (status: number) => status === 404 || status === 410;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const firstLine = (s: string) => s.split('\n')[0].trim();

/** The notification a partner sees, in their language. */
export function buildMessage(lang: 'en' | 'nb', who: string, bodies: string[], forYou = false): { title: string; body: string; url: string } {
  const name = clip(who.trim() || (lang === 'nb' ? 'Partneren din' : 'Your partner'), 30);
  const texts = bodies.map(firstLine).filter(Boolean);
  const verb = lang === 'nb' ? (forYou ? 'ga deg' : 'la til') : forYou ? 'gave you' : 'added';
  let body: string;
  if (bodies.length === 1) body = texts[0] ? `${name} ${verb}: ${clip(texts[0], 120)}` : (lang === 'nb' ? `${name} la til et bilde` : `${name} added a photo`);
  else body = lang === 'nb' ? `${name} ${verb} ${bodies.length} oppgaver` : `${name} ${verb} ${bodies.length} to-dos`;
  return { title: 'Home Memory', body, url: '/' };
}

// ---- reminders at the due time (called every few minutes by a schedule, see docs/NOTIFICATIONS.md) ----

export type DueMemory = { id: string; household_id: string; body: string; due_on: string | null; due_time: string | null; assignee_id: string | null };

/** The date (YYYY-MM-DD) and minutes since midnight at `now` in a time zone, e.g. "Europe/Oslo". */
export function localNow(now: Date, tz: string): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

/** To-dos whose time has come: due today, the time has passed, but by less than `windowMin` (so a missed run still catches up). */
export function dueNow(list: DueMemory[], now: Date, tz: string, windowMin = 30): DueMemory[] {
  const { date, minutes } = localNow(now, tz);
  return list.filter((m) => {
    if (m.due_on !== date || !m.due_time || !/^\d\d:\d\d/.test(m.due_time)) return false;
    const at = Number(m.due_time.slice(0, 2)) * 60 + Number(m.due_time.slice(3, 5));
    return minutes >= at && minutes < at + windowMin;
  });
}

/** Who hears about a due to-do: the person it is for, or everyone in the household when it is for anyone. */
export const recipientsFor = (m: Pick<DueMemory, 'assignee_id'>, memberIds: string[]): string[] =>
  m.assignee_id && memberIds.includes(m.assignee_id) ? [m.assignee_id] : memberIds;

export function buildDueMessage(lang: 'en' | 'nb', bodies: string[]): { title: string; body: string; url: string } {
  const texts = bodies.map(firstLine).filter(Boolean);
  const body = bodies.length === 1 && texts[0]
    ? `${lang === 'nb' ? 'N\u00e5' : 'Now'}: ${clip(texts[0], 120)}`
    : lang === 'nb' ? `${bodies.length} oppgaver skal gj\u00f8res n\u00e5` : `${bodies.length} to-dos are due now`;
  return { title: 'Home Memory', body, url: '/' };
}
