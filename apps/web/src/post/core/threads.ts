import { displayName } from './format.ts';
import type { Kind, Mail } from './types.ts';

// Messages of one conversation, shown as one row. Pure: no browser and no network, so it is tested in Node.
// A conversation is what Outlook calls the messages that answer each other (they share a conversation id). Nothing is ever hidden by it:
// every message is still there, in the row, and in the conversation when it is opened.

export interface Thread {
  /** Stable while the conversation lives: a new answer changes the row, not its key. */
  key: string;
  account: string;
  /** The newest message. It is what the row shows and what opens. */
  latest: Mail;
  /** Every message of the conversation that is in the inbox on this phone, newest first (the first one is `latest`). */
  items: Mail[];
  /** How many of them are unread. */
  unread: number;
  /** The tab it is in: the newest message's. */
  kind: Kind;
}

/** Which conversation a message belongs to. A message Outlook gave no conversation id is a conversation of its own. */
export function threadKey(m: Pick<Mail, 'key' | 'account' | 'conversationId'>): string {
  return m.conversationId ? `c|${m.account}|${m.conversationId}` : `m|${m.key}`;
}

const newestFirst = (a: Mail, b: Mail) => b.received.localeCompare(a.received);

function one(m: Mail): Thread {
  return { key: threadKey(m), account: m.account, latest: m, items: [m], unread: m.isRead ? 0 : 1, kind: m.kind };
}

/** Every message its own row (what the list shows when conversations are switched off). Newest first. */
export function singles(mail: Mail[]): Thread[] {
  return [...mail].sort(newestFirst).map(one);
}

/** Puts the messages of each conversation together. The rows come newest first, each placed by its newest message. */
export function groupThreads(mail: Mail[]): Thread[] {
  const byKey = new Map<string, Thread>();
  for (const m of [...mail].sort(newestFirst)) {
    const k = threadKey(m);
    const t = byKey.get(k);
    if (!t) { byKey.set(k, one(m)); continue; }
    t.items.push(m);
    if (!m.isRead) t.unread++;
  }
  return [...byKey.values()];
}

/**
 * The messages an action on this one should reach: the whole conversation (every message of it that is in the inbox on this phone, newest
 * first), or just this message when conversations are off. Empty when the message is not in the inbox.
 */
export function threadOf(mail: Mail[], m: Pick<Mail, 'key' | 'account' | 'conversationId'>, grouped: boolean): Mail[] {
  const inbox = mail.filter((x) => x.folder === 'inbox');
  if (!grouped || !m.conversationId) return inbox.filter((x) => x.key === m.key);
  const k = threadKey(m);
  return inbox.filter((x) => threadKey(x) === k).sort(newestFirst);
}

/** True when the message was sent from this mailbox (shown as "You"). */
export const isMine = (m: Pick<Mail, 'fromAddress' | 'account'>) => !!m.fromAddress && m.fromAddress.toLowerCase() === m.account.toLowerCase();

/**
 * The message a Reply should answer: the newest one that someone else wrote. When the only messages are yours, the newest of those (Outlook
 * then writes to the people you wrote to). `items` newest first.
 */
export function replyTarget<T extends Pick<Mail, 'fromAddress' | 'account'>>(items: T[]): T | undefined { return items.find((m) => !isMine(m)) ?? items[0]; }

/** True when the subject starts like an answer or a forward ("Re:", "Sv:", "VS:", "AW:", "Fwd:"). */
export const looksLikeReply = (subject: string) => /^\s*(re|sv|vs|aw|fw|fwd|vb)\s*:/i.test(subject);

const firstWord = (name: string) => (name.includes('@') ? name : name.split(/\s+/)[0] || name);

/** Who a row says it is from: the sender when it is one person, else the first names of up to three people, newest first ("Anna, Per +1"). */
export function threadWho(t: Pick<Thread, 'items'>): string {
  const seen = new Map<string, string>(); // address -> name
  for (const m of t.items) {
    const a = m.fromAddress.toLowerCase() || m.fromName.toLowerCase();
    if (!seen.has(a)) seen.set(a, displayName(m.fromName, m.fromAddress));
  }
  const names = [...seen.values()];
  if (names.length <= 1) return names[0] ?? '';
  const shown = names.slice(0, 3);
  const short = shown.map(firstWord);
  // Two people with the same first name must still be told apart.
  const labels = short.some((x, i) => short.indexOf(x) !== i) ? shown : short;
  return `${labels.join(', ')}${names.length > 3 ? ` +${names.length - 3}` : ''}`;
}
