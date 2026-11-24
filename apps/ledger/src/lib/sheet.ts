// Reads the first sheet of an Excel workbook (.xlsx) or a CSV file into rows of cells, in the browser. Nothing is
// uploaded. An .xlsx file is a zip of XML files; only the parts needed for values are read: the shared strings, the
// first sheet, the date formats in the styles, and whether the workbook counts dates from 1904.
import { unzipSync, strFromU8 } from 'fflate';

/** A date (and time, if it had one) as written in the sheet. */
export interface SheetDate { date: string; time: string | null }
export type Cell = string | number | boolean | SheetDate | null;
export interface Sheet { name: string; rows: Cell[][] }

export const isSheetDate = (c: Cell): c is SheetDate => typeof c === 'object' && c !== null && 'date' in c;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) =>
  e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENTITIES[e] ?? m);
/** The text of every <t> in a fragment (rich text is split into runs); phonetic hints (<rPh>) are left out. */
const textOf = (xml: string) => [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decode(m[1])).join('');
const attr = (tag: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];

/** "AB12" → 27 (zero-based column). */
function colIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Excel's built-in number formats that are dates or times. */
const BUILTIN_DATES = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);
/** A custom format is a date if it has d, m or y outside quotes, brackets ([$-7c14], [Red]) and escapes. */
const isDateFormat = (code: string) => /[dmy]/i.test(code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, '')) && !/^[#0.,%\s]+$/.test(code);

function dateStyles(stylesXml: string | undefined): Set<number> {
  const out = new Set<number>();
  if (!stylesXml) return out;
  const custom = new Map<number, string>();
  for (const m of stylesXml.matchAll(/<numFmt\b[^>]*>/g)) custom.set(Number(attr(m[0], 'numFmtId')), decode(attr(m[0], 'formatCode') ?? ''));
  const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml)?.[1] ?? '';
  [...xfs.matchAll(/<xf\b[^>]*?(?:\/>|>)/g)].forEach((m, i) => {
    const id = Number(attr(m[0], 'numFmtId') ?? 0);
    if (BUILTIN_DATES.has(id) || (custom.has(id) && isDateFormat(custom.get(id)!))) out.add(i);
  });
  return out;
}

/** An Excel serial date (days since 1899-12-30, or since 1904-01-01) as a date and time. */
export function serialToDate(serial: number, date1904 = false): SheetDate {
  const ms = Math.round((serial + (date1904 ? 1462 : 0)) * 86_400_000) + Date.UTC(1899, 11, 30);
  const d = new Date(ms);
  const iso = d.toISOString();
  const time = iso.slice(11, 16);
  return { date: iso.slice(0, 10), time: serial % 1 === 0 ? null : time };
}

function readXlsx(data: Uint8Array): Cell[][] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data, { filter: (f) => /^xl\/(workbook\.xml|sharedStrings\.xml|styles\.xml|worksheets\/[^/]+\.xml|_rels\/workbook\.xml\.rels)$/.test(f.name) });
  } catch {
    throw new Error('This file could not be opened as an Excel workbook.');
  }
  const text = (n: string) => (files[n] ? strFromU8(files[n]) : undefined);
  const workbook = text('xl/workbook.xml') ?? '';
  const date1904 = /<workbookPr\b[^>]*\bdate1904="(1|true)"/.test(workbook);

  // The first sheet in the workbook's order, found through its relationship id.
  const firstSheet = /<sheet\b[^>]*>/.exec(workbook)?.[0];
  const rid = firstSheet && (attr(firstSheet, 'r:id') ?? attr(firstSheet, 'id'));
  const target = rid && new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*>`).exec(text('xl/_rels/workbook.xml.rels') ?? '')?.[0];
  const path = target ? `xl/${attr(target, 'Target')!.replace(/^\/?xl\//, '').replace(/^\//, '')}` : undefined;
  const sheetXml = (path && text(path)) ?? text(Object.keys(files).filter((f) => f.startsWith('xl/worksheets/')).sort()[0] ?? '');
  if (!sheetXml) throw new Error('The workbook has no sheet with data.');

  const shared = [...(text('xl/sharedStrings.xml') ?? '').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));
  const dates = dateStyles(text('xl/styles.xml'));

  const rows: Cell[][] = [];
  // An empty row can be written as <row r="1"/>; it must not swallow the next row.
  for (const r of sheetXml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rowNo = Number(attr(r[1], 'r') ?? rows.length + 1) - 1;
    const row: Cell[] = [];
    let next = 0;
    for (const c of (r[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const a = c[1], body = c[2] ?? '';
      const ref = attr(a, 'r');
      const col = ref ? colIndex(ref) : next;
      next = col + 1;
      const type = attr(a, 't');
      const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value: Cell = null;
      if (type === 's') value = v !== undefined ? shared[Number(v)] ?? '' : '';
      else if (type === 'inlineStr') value = textOf(body);
      else if (type === 'str') value = v !== undefined ? decode(v) : '';
      else if (type === 'b') value = v === '1';
      else if (type === 'e') value = null;
      else if (type === 'd') value = v ? { date: v.slice(0, 10), time: v.length > 10 ? v.slice(11, 16) : null } : null;
      else if (v !== undefined && v !== '') {
        const n = Number(v);
        value = dates.has(Number(attr(a, 's') ?? -1)) ? serialToDate(n, date1904) : n;
      }
      row[col] = value;
    }
    for (let i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = null;
    rows[rowNo] = row;
  }
  for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
  return rows;
}

/** CSV with commas, semicolons (Norwegian Excel) or tabs, and quoted fields. */
export function readCsv(text: string): Cell[][] {
  const t = text.replace(/^﻿/, '');
  // The separator used most on the first lines: a title line above the header ("Fristliste november") has none.
  const lines = t.split(/\r?\n/).filter((l) => l.trim()).slice(0, 10);
  const count = (ch: string) => Math.max(0, ...lines.map((l) => l.split(ch).length - 1));
  const sep = [';', '\t', ','].sort((a, b) => count(b) - count(a))[0];
  const rows: Cell[][] = [];
  let row: Cell[] = [], field = '', quoted = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (quoted) {
      if (ch === '"' && t[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === sep) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && t[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.map((r) => r.map((c) => (c === '' ? null : c)));
}

export async function readSheet(file: File): Promise<Sheet> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const zip = buf[0] === 0x50 && buf[1] === 0x4b; // "PK": an .xlsx
  if (zip) return { name: file.name, rows: readXlsx(buf) };
  if (/\.xls$/i.test(file.name) || (buf[0] === 0xd0 && buf[1] === 0xcf)) {
    throw new Error('This is an old Excel file (.xls). Open it in Excel and save it as .xlsx (or CSV), then try again.');
  }
  return { name: file.name, rows: readCsv(new TextDecoder().decode(buf)) };
}

export { readXlsx };
