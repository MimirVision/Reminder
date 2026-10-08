import { isBlocked } from './tidy.ts';
import type { Mail } from './types.ts';

// "Who mails me the most": the senders of bulk mail in the inbox on the phone, busiest first. Pure: no browser and no network.
// A sender counts as a subscription when any of its mail carries the marks of a mailing list (an unsubscribe link, a list id, a bulk
// precedence) or was sorted as a promotion. Mail from people is never listed.

export interface Subscription {
  /** Mailbox and address: the same shop writing to two mailboxes is two rows. */
  key: string;
  account: string;
  address: string;
  name: string;
  /** Messages in the inbox now, and how many of them are unread. */
  count: number;
  unread: number;
  /** The newest one (it opens, and it is where the unsubscribe link is). */
  newest: Mail;
  /** About how many a week, over the time the mail on the phone spans (at least a week). */
  perWeek: number;
  /** The newest message that carries an unsubscribe link (where the link is read from), or null when none does. */
  unsubMail: Mail | null;
  canUnsubscribe: boolean;
  blocked: boolean;
}

const BULK_MARKS = ['unsub', 'list', 'bulk'];
const isBulk = (m: Mail) => m.kind === 'promo' || (m.sig ?? []).some((t) => BULK_MARKS.includes(t));

export function subscriptions(mail: readonly Mail[], blocked: readonly string[], nowMs: number): Subscription[] {
  const by = new Map<string, Mail[]>();
  for (const m of mail) {
    if (m.folder !== 'inbox' || !m.fromAddress.trim()) continue;
    const k = `${m.account}|${m.fromAddress.trim().toLowerCase()}`;
    const g = by.get(k);
    if (g) g.push(m); else by.set(k, [m]);
  }
  const out: Subscription[] = [];
  for (const [key, g] of by) {
    if (!g.some(isBulk)) continue;
    g.sort((a, b) => b.received.localeCompare(a.received));
    const oldest = Date.parse(g[g.length - 1].received);
    const weeks = Math.max(1, (nowMs - oldest) / (7 * 86400000));
    const newest = g[0];
    const unsubMail = g.find((m) => (m.sig ?? []).includes('unsub')) ?? null;
    out.push({
      key, account: newest.account, address: newest.fromAddress.trim().toLowerCase(), name: newest.fromName.trim() || newest.fromAddress,
      count: g.length, unread: g.filter((m) => !m.isRead).length, newest, perWeek: Math.round((g.length / weeks) * 10) / 10,
      unsubMail, canUnsubscribe: !!unsubMail, blocked: isBlocked(blocked, newest.fromAddress),
    });
  }
  return out.sort((a, b) => b.count - a.count || b.newest.received.localeCompare(a.newest.received));
}

/** Senders whose mail you have never opened (at least two, all unread). */
export const neverOpened = (subs: readonly Subscription[]): Subscription[] => subs.filter((x) => x.count >= 2 && x.unread === x.count);

/** "about 3 a week", "about 1 a week", "less than one a week". */
export const rate = (perWeek: number): string => (perWeek < 1 ? 'less than one a week' : `about ${Math.round(perWeek)} a week`);
