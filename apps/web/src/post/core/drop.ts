import { folderOfMail, FOLDER_NAME } from './folders.ts';
import type { FolderInfo, FolderKind, Mail } from './types.ts';

// Dragging mail onto a folder (a mouse on a computer; a long press and a drag on a phone): where a message may go, and where it can be dropped.
// Pure: no browser and no network.

type Placed = Pick<Mail, 'account' | 'fid' | 'fk'>;

/** One place to drop: a standard folder (`id` empty) or a folder of your own. */
export interface Dest { kind: FolderKind; id: string; name: string; where: string; account?: string }

/** Where a message is now. A message of the inbox on the phone carries no folder; one that was only seen in Outlook says which (or `null` when nobody knows). */
export function placeOf(m: Placed, folders: readonly FolderInfo[]): FolderKind | null {
  if (m.fk) return m.fk;
  if (m.fid) return folderOfMail(folders, m)?.kind ?? null;
  return 'inbox';
}

/** Whether the messages can be dropped there: never into Drafts or Sent (Outlook keeps those for what you write), never where they already are, and a folder of your own only from its own mailbox. */
export function canMoveInto(items: readonly Placed[], d: Pick<Dest, 'kind' | 'id' | 'account'>, folders: readonly FolderInfo[]): boolean {
  if (!items.length || d.kind === 'drafts' || d.kind === 'sent') return false;
  if (d.kind === 'other') return items.every((m) => m.account === d.account && m.fid !== d.id);
  return items.every((m) => placeOf(m, folders) !== d.kind);
}

/** The places offered while a message is carried: Inbox (when it is not there), Archive, Junk, then your own folders of its mailbox (when it is one mailbox). */
export function dropChoices(folders: readonly FolderInfo[], items: readonly Placed[]): { standard: Dest[]; own: FolderInfo[]; account: string | null } {
  const accounts = [...new Set(items.map((m) => m.account))];
  const account = accounts.length === 1 ? accounts[0] : null;
  const standard = (['inbox', 'archive', 'junk'] as const).map((kind): Dest => ({ kind, id: '', name: FOLDER_NAME[kind], where: '' })).filter((d) => canMoveInto(items, d, folders));
  const own = account ? folders.filter((f) => f.account === account && f.kind === 'other' && canMoveInto(items, f, folders)) : [];
  return { standard, own, account };
}
