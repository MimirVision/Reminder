import { base64Bytes } from './imapParser.ts';
import { utf8Decode } from './bytes.ts';

// Header text handling: unfolding, RFC 2047 encoded words ("=?UTF-8?Q?Str=C3=B8m?="), and addresses.

export function parseHeaders(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = raw.split(/\r?\n/);
  let name = '';
  let value = '';
  const flush = () => {
    if (name && !(name in out)) out[name] = value.trim();
  };
  for (const line of lines) {
    if (/^[ \t]/.test(line)) value += ' ' + line.trim();
    else {
      flush();
      const i = line.indexOf(':');
      if (i < 0) {
        name = '';
        value = '';
        continue;
      }
      name = line.slice(0, i).trim().toLowerCase();
      value = line.slice(i + 1);
    }
  }
  flush();
  return out;
}

// Windows-1252 differs from Latin-1 only in 0x80-0x9F.
const CP1252 = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ';

function decodeCharset(bytes: number[], charset: string): string {
  const cs = charset.toLowerCase().split('*')[0];
  if (cs === 'utf-8' || cs === 'utf8') return utf8Decode(Uint8Array.from(bytes));
  let s = '';
  for (const b of bytes) s += b >= 0x80 && b <= 0x9f && cs.includes('1252') ? CP1252[b - 0x80] : String.fromCharCode(b);
  return s; // us-ascii, iso-8859-1, windows-1252 and anything unknown: byte-per-character
}

function qBytes(s: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '_') out.push(32);
    else if (c === '=' && /^[0-9a-fA-F]{2}$/.test(s.slice(i + 1, i + 3))) {
      out.push(parseInt(s.slice(i + 1, i + 3), 16));
      i += 2;
    } else out.push(c.charCodeAt(0) & 0xff);
  }
  return out;
}

export function decodeWords(s: string): string {
  // Whitespace between two encoded words is not part of the text (RFC 2047 6.2).
  const joined = s.replace(/(\?=)[ \t\r\n]+(?==\?)/g, '$1');
  return joined.replace(/=\?([^?\s]+)\?([bBqQ])\?([^?]*)\?=/g, (_m, cs: string, enc: string, text: string) =>
    decodeCharset(enc.toLowerCase() === 'b' ? base64Bytes(text) : qBytes(text), cs),
  );
}

export interface Address {
  name: string;
  address: string;
}

function splitList(s: string): string[] {
  const parts: string[] = [];
  let cur = '';
  let quoted = false;
  let angle = false;
  for (const c of s) {
    if (c === '"') quoted = !quoted;
    else if (!quoted && c === '<') angle = true;
    else if (!quoted && c === '>') angle = false;
    if (c === ',' && !quoted && !angle) {
      parts.push(cur);
      cur = '';
    } else cur += c;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

export function parseAddress(raw: string): Address {
  const s = decodeWords(raw).trim();
  const m = /^(.*?)<([^>]*)>\s*$/.exec(s);
  if (m) return { name: m[1].trim().replace(/^"(.*)"$/, '$1').replace(/\\(.)/g, '$1').trim(), address: m[2].trim() };
  return { name: '', address: s.replace(/^<|>$/g, '') };
}

export function parseAddressList(raw: string | undefined): Address[] {
  if (!raw) return [];
  return splitList(raw)
    .map((p) => parseAddress(p))
    .filter((a) => a.address.includes('@'));
}
