import { indexOfCrlf, latin1Decode, utf8Decode } from './bytes.ts';

// A parsed IMAP value: atoms and quoted strings are strings, NIL is null, {n} literals are bytes, (...) is a list.
export type Lit = { lit: Uint8Array };
export type Token = string | null | Lit | Token[];

export type Status = 'OK' | 'NO' | 'BAD';

export type Response =
  | { kind: 'continue'; text: string }
  | { kind: 'tagged'; tag: string; status: Status; code?: string; text: string }
  | {
      kind: 'untagged';
      status?: Status | 'BYE' | 'PREAUTH';
      code?: string;
      text: string;
      seq?: number;
      name?: string;
      tokens: Token[];
    };

type Seg = { text: string } | { lit: Uint8Array };

export function isLit(t: Token): t is Lit {
  return typeof t === 'object' && t !== null && !Array.isArray(t);
}

// The text of a string or literal token; null for NIL and lists.
export function tokenText(t: Token | undefined): string | null {
  if (typeof t === 'string') return t;
  if (t && isLit(t)) return utf8Decode(t.lit);
  return null;
}

export function tokenize(segs: Seg[]): Token[] {
  const root: Token[] = [];
  const stack: Token[][] = [root];
  const top = () => stack[stack.length - 1];
  for (const seg of segs) {
    if ('lit' in seg) {
      top().push({ lit: seg.lit });
      continue;
    }
    const s = seg.text;
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (c === ' ') {
        i++;
      } else if (c === '(') {
        const list: Token[] = [];
        top().push(list);
        stack.push(list);
        i++;
      } else if (c === ')') {
        if (stack.length > 1) stack.pop();
        i++;
      } else if (c === '"') {
        i++;
        let v = '';
        while (i < s.length && s[i] !== '"') {
          if (s[i] === '\\') i++;
          v += s[i] ?? '';
          i++;
        }
        i++;
        top().push(v);
      } else {
        let j = i;
        while (j < s.length && s[j] !== ' ' && s[j] !== '(' && s[j] !== ')') {
          // BODY[HEADER.FIELDS (FROM TO)] is one atom even though it holds spaces and parentheses.
          if (s[j] === '[') {
            const k = s.indexOf(']', j);
            j = k < 0 ? s.length : k + 1;
          } else j++;
        }
        const a = s.slice(i, j);
        top().push(a.toUpperCase() === 'NIL' ? null : a);
        i = j;
      }
    }
  }
  return root;
}

function statusParts(rest: string): { code?: string; text: string } {
  const m = /^\[([^\]]*)\] ?(.*)$/.exec(rest);
  return m ? { code: m[1], text: m[2] } : { text: rest };
}

export function parseResponse(segs: Seg[]): Response {
  const first = 'text' in segs[0] ? segs[0].text : '';
  if (first.startsWith('+')) return { kind: 'continue', text: first.slice(1).trim() };

  if (first.startsWith('* ')) {
    const rest = first.slice(2);
    const st = /^(OK|NO|BAD|BYE|PREAUTH)(?: (.*))?$/i.exec(rest);
    if (st) return { kind: 'untagged', status: st[1].toUpperCase() as Status, ...statusParts(st[2] ?? ''), tokens: [] };
    let seq: number | undefined;
    let name: string | undefined;
    let tail = rest;
    const num = /^(\d+) +([A-Za-z][A-Za-z0-9.\-]*)(.*)$/.exec(rest);
    if (num) {
      seq = Number(num[1]);
      name = num[2].toUpperCase();
      tail = num[3];
    } else {
      const word = /^([A-Za-z][A-Za-z0-9.\-]*)(.*)$/.exec(rest);
      if (word) {
        name = word[1].toUpperCase();
        tail = word[2];
      }
    }
    return { kind: 'untagged', seq, name, text: tail.trim(), tokens: tokenize([{ text: tail }, ...segs.slice(1)]) };
  }

  const tg = /^(\S+) (OK|NO|BAD)(?: (.*))?$/i.exec(first);
  if (tg) return { kind: 'tagged', tag: tg[1], status: tg[2].toUpperCase() as Status, ...statusParts(tg[3] ?? '') };
  // Not valid IMAP. Surface it as a harmless untagged line rather than crashing the connection.
  return { kind: 'untagged', text: first, tokens: [] };
}

// Turns a byte stream into complete responses. A response with literals ({123}\r\n...) can arrive split across many chunks.
function joinChunks(chunks: Uint8Array[], size: number): Uint8Array {
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

export class ResponseReader {
  // Incoming chunks are kept in a list and joined only when enough bytes have arrived to finish what we are waiting for.
  // (Joining on every chunk copies a multi-megabyte attachment hundreds of times.)
  private chunks: Uint8Array[] = [];
  private size = 0;
  private need = 0;

  push(chunk: Uint8Array): Response[] {
    this.chunks.push(chunk);
    this.size += chunk.length;
    if (this.size < this.need) return [];
    let buf = this.chunks.length === 1 ? this.chunks[0] : joinChunks(this.chunks, this.size);
    const out: Response[] = [];
    for (;;) {
      const r = this.take(buf);
      if (!r) break;
      out.push(r.response);
      buf = buf.subarray(r.used);
    }
    this.chunks = buf.length ? [buf] : [];
    this.size = buf.length;
    return out;
  }

  // Reads one complete response from the start of `buf`, or returns null (and remembers how many bytes to wait for).
  private take(buf: Uint8Array): { response: Response; used: number } | null {
    let pos = 0;
    const segs: Seg[] = [];
    this.need = 0;
    for (;;) {
      const eol = indexOfCrlf(buf, pos);
      if (eol < 0) return null;
      const line = latin1Decode(buf.subarray(pos, eol));
      const m = /\{(\d+)\+?\}$/.exec(line);
      if (!m) {
        segs.push({ text: line });
        pos = eol + 2;
        break;
      }
      const n = Number(m[1]);
      const start = eol + 2;
      if (buf.length < start + n) {
        this.need = start + n;
        return null;
      }
      segs.push({ text: line.slice(0, m.index) });
      segs.push({ lit: buf.slice(start, start + n) });
      pos = start + n;
    }
    return { response: parseResponse(segs), used: pos };
  }
}

// FETCH (UID 5 FLAGS (\Seen) BODY[...] {n}...) -> { UID: '5', FLAGS: [...], 'BODY[...]': {lit} }
export function fetchItems(list: Token | undefined): Map<string, Token> {
  const out = new Map<string, Token>();
  if (!Array.isArray(list)) return out;
  for (let i = 0; i + 1 < list.length; i += 2) {
    const key = list[i];
    if (typeof key === 'string') out.set(key.toUpperCase(), list[i + 1]);
  }
  return out;
}

// Modified UTF-7 mailbox names (RFC 3501 5.1.3): "Sendt &AOY-" style, used for non-ASCII folder names.
export function decodeMutf7(s: string): string {
  return s.replace(/&([^-]*)-/g, (_m, enc: string) => {
    if (enc === '') return '&';
    const b64 = enc.replace(/,/g, '/');
    const bin = base64Bytes(b64);
    let out = '';
    for (let i = 0; i + 1 < bin.length; i += 2) out += String.fromCharCode((bin[i] << 8) | bin[i + 1]);
    return out;
  });
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function base64Bytes(s: string): number[] {
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const ch of s) {
    const v = B64.indexOf(ch);
    if (v < 0) continue;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  return out;
}
