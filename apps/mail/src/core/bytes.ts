// Byte and text helpers that behave the same in Node (tests) and Hermes (the phone): no TextDecoder, no Buffer.

export function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

export function latin1Decode(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 4096) s += String.fromCharCode(...b.subarray(i, Math.min(i + 4096, b.length)));
  return s;
}

export function utf8Encode(s: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        i++;
      }
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return Uint8Array.from(out);
}

// Lenient: bad sequences become U+FFFD instead of throwing, because real mail is full of them.
export function utf8Decode(b: Uint8Array): string {
  let s = '';
  let i = 0;
  while (i < b.length) {
    const c = b[i];
    let cp = 0xfffd;
    let n = 1;
    if (c < 0x80) cp = c;
    else if (c >= 0xc2 && c < 0xe0 && i + 1 < b.length && (b[i + 1] & 0xc0) === 0x80) {
      cp = ((c & 31) << 6) | (b[i + 1] & 63);
      n = 2;
    } else if (c >= 0xe0 && c < 0xf0 && i + 2 < b.length && (b[i + 1] & 0xc0) === 0x80 && (b[i + 2] & 0xc0) === 0x80) {
      const v = ((c & 15) << 12) | ((b[i + 1] & 63) << 6) | (b[i + 2] & 63);
      if (v >= 0x800) {
        cp = v;
        n = 3;
      }
    } else if (c >= 0xf0 && c < 0xf5 && i + 3 < b.length && (b[i + 1] & 0xc0) === 0x80 && (b[i + 2] & 0xc0) === 0x80 && (b[i + 3] & 0xc0) === 0x80) {
      const v = ((c & 7) << 18) | ((b[i + 1] & 63) << 12) | ((b[i + 2] & 63) << 6) | (b[i + 3] & 63);
      if (v >= 0x10000 && v <= 0x10ffff) {
        cp = v;
        n = 4;
      }
    }
    s += cp > 0xffff ? String.fromCodePoint(cp) : String.fromCharCode(cp);
    i += n;
  }
  return s;
}

export function indexOfCrlf(b: Uint8Array, from: number): number {
  for (let i = from; i + 1 < b.length; i++) if (b[i] === 13 && b[i + 1] === 10) return i;
  return -1;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function base64Encode(b: Uint8Array): string {
  let out = '';
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < b.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < b.length ? B64[n & 63] : '=');
  }
  return out;
}
