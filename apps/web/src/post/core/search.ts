import { asKind, type Kind, type Mail } from './types.ts';

// Search on the phone: instant, works offline, and understands Norwegian letters (a search for "ostlandet" finds "Østlandet").
// Server search ($search in Graph) is the fallback for mail older than what is stored here.

/** Lower case, accents stripped, and the Nordic letters folded: æ→ae, ø→o, å→a. */
export function fold(s: string): string {
  return s.toLowerCase().replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/å/g, 'a').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export interface Query {
  words: string[];
  from: string[];
  unread: boolean;
  flagged: boolean;
  attachment: boolean;
  account: string | null;
  kind: Kind | null;
  subject: string[];
  read: boolean;
  /** ISO time: only mail received at or after / before it. */
  after: string | null;
  before: string | null;
}

/** `2026-10`, `2026-10-05`, or `7d` / `2w` / `3m` / `1y` ago (from `now`) as an ISO start-of-day time; null when it is none of these. */
export function parseWhen(v: string, now = new Date()): string | null {
  const ago = /^(\d{1,3})([dwmy])$/.exec(v);
  if (ago) {
    const d = new Date(now); const n = Number(ago[1]);
    if (ago[2] === 'd') d.setUTCDate(d.getUTCDate() - n); else if (ago[2] === 'w') d.setUTCDate(d.getUTCDate() - 7 * n); else if (ago[2] === 'm') d.setUTCMonth(d.getUTCMonth() - n); else d.setUTCFullYear(d.getUTCFullYear() - n);
    d.setUTCHours(0, 0, 0, 0); return d.toISOString();
  }
  const abs = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(v);
  if (abs) { const d = new Date(Date.UTC(Number(abs[1]), Number(abs[2]) - 1, Number(abs[3] ?? 1))); return Number.isNaN(d.getTime()) ? null : d.toISOString(); }
  return null;
}

/** `from:anna subject:invoice after:2026-10 before:7d is:read is:unread has:attachment is:flagged in:primary account:work meeting` (in: takes primary, transactions, updates or promotions; older names work too) */
export function parseQuery(input: string): Query {
  const q: Query = { words: [], from: [], unread: false, flagged: false, attachment: false, account: null, kind: null, subject: [], read: false, after: null, before: null };
  for (const raw of input.trim().split(/\s+/).filter(Boolean)) {
    const t = raw.toLowerCase();
    if (t.startsWith('from:') && t.length > 5) q.from.push(fold(raw.slice(5)));
    else if (t.startsWith('subject:') && t.length > 8) q.subject.push(fold(raw.slice(8)));
    else if (t === 'is:read') q.read = true;
    else if ((t.startsWith('after:') || t.startsWith('newer:')) && parseWhen(t.split(':')[1])) q.after = parseWhen(t.split(':')[1]);
    else if ((t.startsWith('before:') || t.startsWith('older:')) && parseWhen(t.split(':')[1])) q.before = parseWhen(t.split(':')[1]);
    else if (t === 'is:unread') q.unread = true;
    else if (t === 'is:flagged') q.flagged = true;
    else if (t === 'has:attachment') q.attachment = true;
    else if (t.startsWith('in:') && asKind(t.slice(3))) q.kind = asKind(t.slice(3));
    else if (t.startsWith('account:') && t.length > 8) q.account = raw.slice(8).toLowerCase();
    else q.words.push(fold(raw));
  }
  return q;
}

export const isEmptyQuery = (q: Query) => !q.words.length && !q.from.length && !q.unread && !q.flagged && !q.attachment && !q.account && !q.kind && !q.subject.length && !q.read && !q.after && !q.before;

export function matches(m: Mail, q: Query, labels: Record<string, string> = {}): boolean {
  if (q.unread && m.isRead) return false;
  if (q.read && !m.isRead) return false;
  if (q.after && m.received < q.after) return false;
  if (q.before && m.received >= q.before) return false;
  if (q.subject.some((w) => !fold(m.subject).includes(w))) return false;
  if (q.flagged && !m.flagged) return false;
  if (q.attachment && !m.hasAttachments) return false;
  if (q.kind && m.kind !== q.kind) return false;
  if (q.account && m.account.toLowerCase() !== q.account && fold(labels[m.account] ?? '') !== fold(q.account)) return false;
  const sender = fold(`${m.fromName} ${m.fromAddress}`);
  if (q.from.some((f) => !sender.includes(f))) return false;
  const hay = `${sender} ${fold(m.subject)} ${fold(m.preview)}`;
  return q.words.every((w) => hay.includes(w));
}

/** Newest first. Exact subject/sender hits rank above preview-only hits, but never hide them. */
export function search(all: Mail[], input: string, labels: Record<string, string> = {}, limit = 100): Mail[] {
  const q = parseQuery(input);
  if (isEmptyQuery(q)) return [];
  const hits = all.filter((m) => matches(m, q, labels));
  const score = (m: Mail) => {
    const head = fold(`${m.fromName} ${m.subject}`);
    return q.words.reduce((n, w) => n + (head.includes(w) ? 1 : 0), 0);
  };
  return hits.sort((a, b) => score(b) - score(a) || b.received.localeCompare(a.received)).slice(0, limit);
}
