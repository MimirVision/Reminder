import { isFreemail, orgDomain } from './classify.ts';
import { groupThreads } from './threads.ts';
import type { Mail } from './types.ts';

// "Sweep" a sender: clear what one sender (or one company) has piled up in your inbox, in one move, with one Undo. Pure: which mail each choice
// reaches. Only the inbox on the phone is looked at, and mail you flagged is never swept.

export type SweepScope = 'sender' | 'company';
export type SweepWay = 'archive' | 'delete' | 'keepNewest' | 'older';

/** "Older than" in days. */
export const SWEEP_OLDER_DAYS = 10;

/** The company of an address when it makes sense to sweep a whole company (not for a shared provider such as gmail.com). */
export function sweepCompany(address: string): string | null {
  const d = orgDomain(address);
  return d && !isFreemail(d) ? d : null;
}

const fromScope = (m: Pick<Mail, 'fromAddress'>, address: string, scope: SweepScope) => {
  const a = m.fromAddress.trim().toLowerCase();
  if (scope === 'sender') return a === address.trim().toLowerCase();
  const d = sweepCompany(address);
  return !!d && orgDomain(a) === d;
};

/** The messages in the inbox from this sender or company, newest first, not counting flagged mail. */
export function sweepable(mail: readonly Mail[], address: string, scope: SweepScope): Mail[] {
  return mail.filter((m) => m.folder === 'inbox' && !m.flagged && fromScope(m, address, scope)).sort((a, b) => b.received.localeCompare(a.received));
}

/** The messages a choice reaches, and how many rows of the list that is (a conversation is one row when conversations are on). */
export function sweepPlan(mail: readonly Mail[], address: string, scope: SweepScope, way: SweepWay, nowMs: number, grouped: boolean): { items: Mail[]; rows: number } {
  const all = sweepable(mail, address, scope);
  const items = way === 'keepNewest' ? all.slice(1) : way === 'older' ? all.filter((m) => nowMs - Date.parse(m.received) > SWEEP_OLDER_DAYS * 86400000) : all;
  return { items, rows: grouped ? groupThreads(items).length : items.length };
}
