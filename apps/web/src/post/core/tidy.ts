import { ruleFor } from './classify.ts';
import { threadKey } from './threads.ts';
import type { Kind, Mail } from './types.ts';

// What Post does with mail by itself: mail from senders you blocked goes to Junk, and (when you turned it on) old promotions are archived.
// Both only ever MOVE mail (nothing is deleted), both are announced with an Undo, and both leave alone what you flagged and what you
// brought back on purpose. This file is the pure part: which mail that is.

/** How old a promotion must be before Post archives it by itself, in days (0: never). */
export const AUTO_CLEAN_CHOICES = [0, 3, 7, 14, 30] as const;

/** How many "brought back on purpose" marks are kept. */
export const KEPT_MAX = 400;

/**
 * What marks a message as one you brought back (moved to the inbox from another folder, or undid a tidy-up of): who, which mailbox and when it was
 * received. A message that is moved gets a new id, so the id would not do.
 */
export const keptKey = (m: Pick<Mail, 'account' | 'fromAddress' | 'received'>): string => `${m.account}|${m.fromAddress.trim().toLowerCase()}|${m.received}`;

const asRules = (blocked: readonly string[]): Record<string, Kind> => Object.fromEntries(blocked.map((k) => [k.trim().toLowerCase(), 'promo' as Kind]));

/** Whether mail from this address is blocked: the address itself, or its company (`@acme.com`, which also covers `news.acme.com`). */
export const isBlocked = (blocked: readonly string[], address: string): boolean => blocked.length > 0 && ruleFor(asRules(blocked), address) !== null;

/** The mail in the inbox that has to go to Junk: from a blocked sender, not flagged, not brought back by you. */
export function blockedMail(mail: readonly Mail[], blocked: readonly string[], kept: ReadonlySet<string>): Mail[] {
  if (!blocked.length) return [];
  const rules = asRules(blocked);
  return mail.filter((m) => m.folder === 'inbox' && !m.flagged && !kept.has(keptKey(m)) && ruleFor(rules, m.fromAddress) !== null);
}

/** Adds marks to the list of kept ones, newest last, and forgets the oldest beyond the limit. */
export const keepMore = (kept: readonly string[], more: readonly string[]): string[] => [...new Set([...kept.filter((k) => !more.includes(k)), ...more])].slice(-KEPT_MAX);

/** A conversation you muted: its key (see `threadKey`) and a short name for the list in Settings. */
export interface Muted { key: string; subject: string }

/** How many muted conversations are kept (the oldest are forgotten first). */
export const MUTED_MAX = 200;

/** The name of a muted conversation: its subject without "Re:" and "Fwd:" in front, kept short. */
export const muteName = (subject: string): string => {
  const s = subject.replace(/^\s*((re|sv|vs|aw|fw|fwd|vb)\s*:\s*)+/i, '').trim();
  return (s || 'No subject').slice(0, 80);
};

/** Whether this message can be muted: only a message that belongs to a conversation Outlook knows (later replies carry the same conversation). */
export const canMute = (m: Pick<Mail, 'conversationId'>): boolean => !!m.conversationId;

/** The mail in the inbox that belongs to a muted conversation: not flagged, not brought back by you. */
export function mutedMail(mail: readonly Mail[], muted: readonly Muted[], kept: ReadonlySet<string>): Mail[] {
  if (!muted.length) return [];
  const keys = new Set(muted.map((x) => x.key));
  return mail.filter((m) => m.folder === 'inbox' && !m.flagged && !!m.conversationId && !kept.has(keptKey(m)) && keys.has(threadKey(m)));
}
