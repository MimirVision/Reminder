import type { Thread } from './threads.ts';
import type { Mail } from './types.ts';

// One row per sender in the quiet tabs. Forty mails from one shop are not forty things to read, they are one thing to clear. Pure: no browser and
// no network. Nothing is hidden by it: tap the row and the conversations are there, and every action on the row reaches all of them.

/** The tabs that get it. Primary is people, and All shows everything one by one. */
export const DIGEST_VIEWS: readonly string[] = ['transaction', 'update', 'promo'];

/** Who a sender is for this purpose: the mailbox and the address (so the same shop writing to two of your mailboxes is two rows). */
const senderKey = (m: Pick<Mail, 'account' | 'fromAddress'>) => `${m.account}|${m.fromAddress.trim().toLowerCase()}`;

/**
 * Puts every sender's conversations together in one row, when a sender has two or more. The row stands where its newest conversation was, its
 * `items` are all the messages of all those conversations (newest first) so one swipe, one selection or one Undo reaches them all, and
 * `members` are the conversations. A conversation with a flagged message stays a row of its own: flagged mail is never swept up with a pile.
 */
export function digestThreads(threads: readonly Thread[], view: string): Thread[] {
  if (!DIGEST_VIEWS.includes(view)) return [...threads];
  const by = new Map<string, Thread[]>();
  for (const t of threads) {
    if (t.items.some((m) => m.flagged) || !t.latest.fromAddress.trim()) continue;
    const k = senderKey(t.latest);
    const g = by.get(k);
    if (g) g.push(t); else by.set(k, [t]);
  }
  const out: Thread[] = [];
  const placed = new Set<string>();
  for (const t of threads) {
    const g = !t.items.some((m) => m.flagged) && t.latest.fromAddress.trim() ? by.get(senderKey(t.latest)) : undefined;
    if (!g || g.length < 2) { out.push(t); continue; }
    const k = senderKey(t.latest);
    if (placed.has(k)) continue;
    placed.add(k);
    const items = g.flatMap((x) => x.items).sort((a, b) => b.received.localeCompare(a.received));
    out.push({ key: `d|${k}|${view}`, account: t.account, latest: items[0], items, unread: g.reduce((n, x) => n + x.unread, 0), kind: t.kind, members: g });
  }
  return out;
}
