import type { OutFile } from './graph.ts';
import { safeBlobType } from './html.ts';

// Everything about files that needs no browser: what kind a file is (for the icon and for how it can be shown), a name that is safe to
// save under, choosing the files to send, and a small memory of what was already downloaded.

export type FileKind = 'pdf' | 'image' | 'text' | 'word' | 'sheet' | 'slides' | 'zip' | 'audio' | 'video' | 'mail' | 'calendar' | 'other';

const T: Record<string, [FileKind, string]> = {
  pdf: ['pdf', 'application/pdf'],
  png: ['image', 'image/png'], jpg: ['image', 'image/jpeg'], jpeg: ['image', 'image/jpeg'], gif: ['image', 'image/gif'], webp: ['image', 'image/webp'],
  bmp: ['image', 'image/bmp'], heic: ['image', 'image/heic'], heif: ['image', 'image/heif'], avif: ['image', 'image/avif'], svg: ['image', 'image/svg+xml'],
  txt: ['text', 'text/plain'], log: ['text', 'text/plain'], md: ['text', 'text/markdown'], csv: ['text', 'text/csv'], tsv: ['text', 'text/tab-separated-values'],
  json: ['text', 'application/json'], xml: ['text', 'application/xml'], yml: ['text', 'text/plain'], yaml: ['text', 'text/plain'], ini: ['text', 'text/plain'],
  doc: ['word', 'application/msword'], docx: ['word', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'], odt: ['word', 'application/vnd.oasis.opendocument.text'], rtf: ['word', 'application/rtf'], pages: ['word', 'application/vnd.apple.pages'],
  xls: ['sheet', 'application/vnd.ms-excel'], xlsx: ['sheet', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'], ods: ['sheet', 'application/vnd.oasis.opendocument.spreadsheet'], numbers: ['sheet', 'application/vnd.apple.numbers'],
  ppt: ['slides', 'application/vnd.ms-powerpoint'], pptx: ['slides', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'], odp: ['slides', 'application/vnd.oasis.opendocument.presentation'], key: ['slides', 'application/vnd.apple.keynote'],
  zip: ['zip', 'application/zip'], rar: ['zip', 'application/vnd.rar'], '7z': ['zip', 'application/x-7z-compressed'], gz: ['zip', 'application/gzip'], tar: ['zip', 'application/x-tar'],
  mp3: ['audio', 'audio/mpeg'], m4a: ['audio', 'audio/mp4'], wav: ['audio', 'audio/wav'], aac: ['audio', 'audio/aac'], ogg: ['audio', 'audio/ogg'],
  mp4: ['video', 'video/mp4'], mov: ['video', 'video/quicktime'], m4v: ['video', 'video/x-m4v'], webm: ['video', 'video/webm'], avi: ['video', 'video/x-msvideo'],
  eml: ['mail', 'message/rfc822'], msg: ['mail', 'application/vnd.ms-outlook'],
  ics: ['calendar', 'text/calendar'], vcf: ['other', 'text/vcard'],
};

const GENERIC = /^(|application\/octet-stream|binary\/octet-stream|application\/x-unknown.*|application\/unknown|unknown\/unknown)$/;

export function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 && i < name.length - 1 ? name.slice(i + 1).toLowerCase() : '';
}

const baseType = (type: string) => (type ?? '').toLowerCase().split(';')[0].trim();

/** What a file is, from its name first (Outlook's own type is often just "octet-stream") and its type otherwise. */
export function fileKind(name: string, type = ''): FileKind {
  const known = T[extOf(name)];
  if (known) return known[0];
  const t = baseType(type);
  if (t === 'application/pdf') return 'pdf';
  if (t.startsWith('image/')) return 'image';
  if (t.startsWith('audio/')) return 'audio';
  if (t.startsWith('video/')) return 'video';
  if (t === 'message/rfc822') return 'mail';
  if (t === 'text/calendar') return 'calendar';
  if (t.startsWith('text/') && t !== 'text/html') return 'text';
  return 'other';
}

const WORDS: Record<FileKind, string> = {
  pdf: 'PDF document', image: 'Picture', text: 'Text file', word: 'Word document', sheet: 'Spreadsheet', slides: 'Presentation', zip: 'Archive',
  audio: 'Audio', video: 'Video', mail: 'Attached message', calendar: 'Calendar invitation', other: 'File',
};
/** "PDF document", "Picture": what a file is, in words. */
export const kindWord = (kind: FileKind) => WORDS[kind];

/** The few letters on a file's tile: its ending (PDF, DOCX), or MAIL / LINK for the two attachments that are not files. */
export function tileLabel(name: string, kind?: 'file' | 'item' | 'link'): string {
  if (kind === 'item') return 'MAIL';
  if (kind === 'link') return 'LINK';
  const e = extOf(name).toUpperCase();
  return e && e.length <= 4 ? e : e ? e.slice(0, 4) : 'FILE';
}

/** The best type for a file: the one Outlook gave, unless that says nothing, then what the name says. */
export function mimeOf(name: string, type = ''): string {
  const t = baseType(type);
  if (!GENERIC.test(t)) return t;
  return T[extOf(name)]?.[1] ?? 'application/octet-stream';
}

/** How Post can show the file itself: pages, a picture, or text. Everything else is saved or shared. Pictures that could run code (svg) are not shown. */
export function viewable(name: string, type = ''): 'pdf' | 'image' | 'text' | null {
  const k = fileKind(name, type);
  if (k === 'pdf') return 'pdf';
  if (k === 'image') return /^image\//.test(safeBlobType(mimeOf(name, type), name)) ? 'image' : null;
  if (k === 'text') return 'text';
  return null;
}

/** A name that is safe to save under: no folders, no characters a file system refuses, not too long, and never empty. */
export function saveName(name: string, fallback = 'attachment'): string {
  // eslint-disable-next-line no-control-regex
  let n = String(name ?? '').replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, '_').replace(/^[.\s]+|[\s]+$/g, '');
  if (n.length > 120) { const e = extOf(n); n = n.slice(0, 120 - (e ? e.length + 1 : 0)).replace(/[.\s]+$/, '') + (e ? `.${e}` : ''); }
  return n || fallback;
}

/** An attached message has no file name: it is saved as an .eml. */
export function emlName(name: string): string {
  const n = saveName(name, 'message');
  return /\.eml$/i.test(n) ? n : `${n}.eml`;
}

// ---- choosing files to send -----------------------------------------------------------------------------------------------------------

/** The most one message may carry. The strictest of the usual mailboxes (Outlook.com) takes about 20 MB, so staying under it means a send never fails for size. */
export const MAX_OUT_TOTAL = 20 * 1024 * 1024;

export const totalBytes = (files: { bytes: Uint8Array }[]) => files.reduce((n, f) => n + f.bytes.byteLength, 0);

/** Something the browser's file picker, a drop or a paste gives (a `File`). */
export interface Picked { name: string; type: string; size: number; arrayBuffer(): Promise<ArrayBuffer> }

/** "report.pdf" taken twice becomes "report (2).pdf". */
export function uniqueName(name: string, taken: string[]): string {
  const have = new Set(taken.map((t) => t.toLowerCase()));
  if (!have.has(name.toLowerCase())) return name;
  const e = extOf(name);
  const stem = e ? name.slice(0, -(e.length + 1)) : name;
  for (let i = 2; ; i++) {
    const n = e ? `${stem} (${i}).${e}` : `${stem} (${i})`;
    if (!have.has(n.toLowerCase())) return n;
  }
}

/**
 * Reads what was picked and adds it to what is already attached. A file that cannot go (empty, unreadable, or one too many for the size
 * limit) is left out with a sentence saying so, and never stops the others.
 */
export async function addPicked(current: OutFile[], chosen: ArrayLike<Picked>, limit = MAX_OUT_TOTAL): Promise<{ files: OutFile[]; problems: string[] }> {
  // A browser empties its list of chosen files as soon as the handler that received it returns (the file picker is reset, a drop is over),
  // so the list is copied before the first wait.
  const picked = Array.from(chosen);
  const files = [...current];
  const problems: string[] = [];
  let total = totalBytes(files);
  for (const p of picked) {
    const label = p.name || 'A file';
    if (!p.size) { problems.push(`${label} is empty, so it was left out.`); continue; }
    if (total + p.size > limit) { problems.push(`${label} would make the message bigger than ${Math.round(limit / 1048576)} MB, so it was left out. Send it in another message.`); continue; }
    let bytes: Uint8Array;
    try { bytes = new Uint8Array(await p.arrayBuffer()); } catch { problems.push(`${label} could not be read. If it is in iCloud or OneDrive, open it once so it is on this device, then try again.`); continue; }
    if (!bytes.byteLength) { problems.push(`${label} is empty, so it was left out.`); continue; }
    if (total + bytes.byteLength > limit) { problems.push(`${label} would make the message bigger than ${Math.round(limit / 1048576)} MB, so it was left out. Send it in another message.`); continue; }
    const name = uniqueName(saveName(p.name, 'file'), files.map((f) => f.name));
    files.push({ name, type: mimeOf(name, p.type), bytes });
    total += bytes.byteLength;
  }
  return { files, problems };
}

// ---- remembering what was downloaded ---------------------------------------------------------------------------------------------------

/** A memory of downloaded files that forgets the longest-unused first once it holds more than `limit` bytes. A file bigger than the limit is not kept. */
export function createByteCache<T extends { bytes: Uint8Array }>(limit: number) {
  const map = new Map<string, T>();
  let size = 0;
  return {
    get(key: string): T | undefined {
      const v = map.get(key);
      if (v) { map.delete(key); map.set(key, v); }
      return v;
    },
    set(key: string, value: T) {
      const old = map.get(key);
      if (old) { size -= old.bytes.byteLength; map.delete(key); }
      if (value.bytes.byteLength > limit) return;
      map.set(key, value); size += value.bytes.byteLength;
      for (const [k, v] of map) { if (size <= limit) break; size -= v.bytes.byteLength; map.delete(k); }
    },
    get size() { return size; },
    get count() { return map.size; },
    clear() { map.clear(); size = 0; },
  };
}
