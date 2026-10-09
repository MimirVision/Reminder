import { KIND_TAB, type FolderKind, type Kind, type Mail } from './types.ts';

// "Where did my mail go?": a short written record of every message that left the inbox list, or moved to another tab, and why. Post compares
// the list it showed with the list it shows now, and the part of the program that took a message away says why (Archive, Block, Mute, ...).
// A message that disappears with no reason given was moved or deleted at Outlook's end: by a rule, the junk filter, another app or device.
// Pure: no browser and no network.

export type LeftWhy = 'outlook' | 'archive' | 'delete' | 'move' | 'blocked' | 'muted' | 'clean' | 'tab' | 'tabYou' | 'bulk';

export interface LeftEntry {
  at: number;
  /** The message's key, or '*' for a summary of many. */
  key: string;
  subject: string;
  /** Who it was from: the name, or the address. */
  who: string;
  why: LeftWhy;
  /** For a tab change: the tab it left and the one it went to. */
  from?: Kind;
  to?: Kind;
  /** For a summary: how many messages. */
  count?: number;
  /** For a message Outlook took away: who sent it and when it arrived, so Post can ask Outlook where it went. */
  addr?: string;
  recv?: string;
  /** Where Outlook put it, once found (the name of the folder, and what kind it is). */
  where?: { name: string; kind: FolderKind; id: string };
}

/** How many entries are kept, newest first. */
export const LEFT_MAX = 80;
/** More than this many at once is not a story about single messages (a mailbox was removed, everything was read again, the phone's storage was reset). */
export const LEFT_BULK = 30;

export const WHY_TEXT: Record<LeftWhy, string> = {
  outlook: 'Moved or deleted at Outlook, not by Post',
  archive: 'Archived in Post',
  delete: 'Deleted in Post',
  move: 'Moved to a folder in Post',
  blocked: 'Blocked sender: moved to Junk',
  muted: 'Muted conversation: archived',
  clean: 'Archived by itself: old promotion',
  tab: 'Sorted into another tab',
  tabYou: 'Sorted into another tab by your choice',
  bulk: 'Many left the list at once',
};

const who = (m: Pick<Mail, 'fromName' | 'fromAddress'>) => m.fromName.trim() || m.fromAddress;

/** What changed between the list shown before and the list shown now. `why` says what took a message away (absent: Outlook did). */
export function diffInbox(prev: readonly Mail[], next: readonly Mail[], why: ReadonlyMap<string, LeftWhy>, now: number, tabWhy: 'tab' | 'tabYou' = 'tab'): LeftEntry[] {
  if (!prev.length) return [];
  const here = new Map(next.map((m) => [m.key, m]));
  const out: LeftEntry[] = [];
  const gone = prev.filter((m) => !here.has(m.key));
  if (gone.length >= LEFT_BULK) out.push({ at: now, key: '*', subject: `${gone.length} messages`, who: '', why: 'bulk', count: gone.length });
  else for (const m of gone) { const r = why.get(m.key) ?? 'outlook'; out.push({ at: now, key: m.key, subject: m.subject || '(no subject)', who: who(m), why: r, ...(r === 'outlook' ? { addr: m.fromAddress.toLowerCase(), recv: m.received } : {}) }); }
  const moved = prev.filter((m) => { const n = here.get(m.key); return !!n && n.kind !== m.kind; });
  for (const m of moved.slice(0, LEFT_BULK)) out.push({ at: now, key: m.key, subject: m.subject || '(no subject)', who: who(m), why: tabWhy, from: m.kind, to: here.get(m.key)!.kind });
  if (moved.length > LEFT_BULK) out.push({ at: now, key: '*', subject: `${moved.length - LEFT_BULK} more messages`, who: '', why: tabWhy, count: moved.length - LEFT_BULK });
  return out;
}

/** The sentence under a message in the list. */
export function leftLine(e: LeftEntry): string {
  if ((e.why === 'tab' || e.why === 'tabYou') && e.from && e.to) return `From ${KIND_TAB[e.from]} to ${KIND_TAB[e.to]}${e.why === 'tabYou' ? ' because of a choice you made' : ' once Post had read its hidden marks'}. Still in All.`;
  if (e.why === 'outlook' && e.where) return `Outlook moved it to ${e.where.name} (a rule, the junk filter or another app), not Post.`;
  return WHY_TEXT[e.why];
}

/** Adds new entries in front of the old ones and keeps the newest. */
export const addLeft = (old: readonly LeftEntry[], more: readonly LeftEntry[]): LeftEntry[] => [...more, ...old].slice(0, LEFT_MAX);

/** Counts per reason, for the problem report (no subjects, no names). */
export function leftCounts(list: readonly LeftEntry[]): string {
  const n = new Map<LeftWhy, number>();
  for (const e of list) n.set(e.why, (n.get(e.why) ?? 0) + (e.count ?? 1));
  return [...n].map(([w, c]) => `${w} ${c}`).join(', ') || 'nothing';
}

/** Reads what was saved; anything odd is dropped. */
export function loadLeft(saved: unknown): LeftEntry[] {
  if (!Array.isArray(saved)) return [];
  const ok = (e: unknown): e is LeftEntry => !!e && typeof (e as LeftEntry).at === 'number' && typeof (e as LeftEntry).subject === 'string' && typeof (e as LeftEntry).who === 'string' && typeof (e as LeftEntry).key === 'string' && (e as LeftEntry).why in WHY_TEXT && ((e as LeftEntry).where === undefined || typeof (e as LeftEntry).where?.name === 'string');
  return saved.filter(ok).slice(0, LEFT_MAX);
}
