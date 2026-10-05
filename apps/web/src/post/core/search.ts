import type { Mail } from './types.ts';

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
  kind: Mail['kind'] | null;
}

const KINDS: Record<string, Mail['kind']> = { people: 'person', person: 'person', newsletter: 'newsletter', newsletters: 'newsletter', receipt: 'receipt', receipts: 'receipt', alert: 'alert', alerts: 'alert' };

/** `from:anna is:unread has:attachment is:flagged in:people account:work meeting` */
export function parseQuery(input: string): Query {
  const q: Query = { words: [], from: [], unread: false, flagged: false, attachment: false, account: null, kind: null };
  for (const raw of input.trim().split(/\s+/).filter(Boolean)) {
    const t = raw.toLowerCase();
    if (t.startsWith('from:') && t.length > 5) q.from.push(fold(raw.slice(5)));
    else if (t === 'is:unread') q.unread = true;
    else if (t === 'is:flagged') q.flagged = true;
    else if (t === 'has:attachment') q.attachment = true;
    else if (t.startsWith('in:') && KINDS[t.slice(3)]) q.kind = KINDS[t.slice(3)];
    else if (t.startsWith('account:') && t.length > 8) q.account = raw.slice(8).toLowerCase();
    else q.words.push(fold(raw));
  }
  return q;
}

export const isEmptyQuery = (q: Query) => !q.words.length && !q.from.length && !q.unread && !q.flagged && !q.attachment && !q.account && !q.kind;

export function matches(m: Mail, q: Query, labels: Record<string, string> = {}): boolean {
  if (q.unread && m.isRead) return false;
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
