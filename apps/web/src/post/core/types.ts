// Shapes shared by the Post web app's core. No browser or React code in src/post/core: everything here is unit tested in Node.

/**
 * What a message is, and so which tab shows it. Sorting only labels a message and picks its tab; nothing is ever hidden (the All tab
 * shows everything), and every verdict comes with plain-language reasons.
 *   person = Primary, transaction = Transactions, update = Updates, promo = Promotions.
 */
export type Kind = 'person' | 'transaction' | 'update' | 'promo';

export const KINDS: readonly Kind[] = ['person', 'transaction', 'update', 'promo'];

/** The tab each kind lives in, as people read it. */
export const KIND_TAB: Record<Kind, string> = { person: 'Primary', transaction: 'Transactions', update: 'Updates', promo: 'Promotions' };

/** One word for a single message ("Sorted as an update"). */
export const KIND_ONE: Record<Kind, string> = { person: 'a message from a person', transaction: 'a transaction', update: 'an update', promo: 'a promotion' };

const LEGACY: Record<string, Kind> = {
  person: 'person', people: 'person', primary: 'person',
  transaction: 'transaction', transactions: 'transaction', receipt: 'transaction', receipts: 'transaction',
  update: 'update', updates: 'update', alert: 'update', alerts: 'update', newsletter: 'update', newsletters: 'update',
  promo: 'promo', promos: 'promo', promotion: 'promo', promotions: 'promo',
};

/** Reads a saved or typed kind. Older versions of Post saved other names (newsletter, receipt, alert): they map to the nearest new one. */
export function asKind(v: unknown): Kind | null {
  return typeof v === 'string' ? LEGACY[v.trim().toLowerCase()] ?? null : null;
}

export interface Account {
  email: string;
  label: string; // "Personal", "Work", or whatever the user called it
  mode?: 'people' | 'all' | 'vips' | 'off';
  subscriptionExpiresAt?: string | null;
  lastAlertAt?: string | null;
}

/** One message as the list shows it. */
export interface Mail {
  key: string; // `${account}|${id}` : unique across accounts
  account: string;
  id: string;
  conversationId: string;
  received: string; // ISO
  subject: string;
  fromName: string;
  fromAddress: string;
  preview: string;
  isRead: boolean;
  flagged: boolean;
  hasAttachments: boolean;
  folder: 'inbox' | 'archive' | 'deleted';
  kind: Kind;
  why: string[]; // plain-language reasons for `kind`, shown by "why is this here?"
  /** What the message headers said (see classify.signalsFromHeaders); absent until they have been read. Kept so the sorting can be redone at any time without asking Outlook again. */
  sig?: string[];
  /** Outlook's own Focused/Other guess. Not used for sorting yet; kept for the sorting report. */
  inf?: 'focused' | 'other';
  /** Hidden until this time (ISO). Snooze lives on this device. */
  snoozedUntil?: string | null;
}

export interface MailBody {
  key: string;
  contentType: 'html' | 'text';
  content: string;
  to: { name: string; address: string }[];
  cc: { name: string; address: string }[];
  attachments: { id: string; name: string; size: number; contentType: string; inline: boolean; cid?: string }[];
}

export const mailKey = (account: string, id: string) => `${account}|${id}`;
