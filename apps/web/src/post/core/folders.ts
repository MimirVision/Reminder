import type { ClassifyContext } from './classify.ts';
import { displayName } from './format.ts';
import type { FolderTree, RawFolder, RawMessage, WellKnownFolder } from './graph.ts';
import { toMail } from './sync.ts';
import type { FolderInfo, FolderKind, Mail } from './types.ts';

// Folders: what Outlook has besides the inbox, in Post's words. Pure: no browser and no network, so it is tested in Node.
// The standard folders are named by Post (Inbox, Drafts, Sent, Archive, Junk, Deleted), whatever language the mailbox is in; the folders you made
// keep the name you gave them. Nothing here is saved on the phone: a folder is read from Outlook when it is opened.

/** The standard folders, in the order they are listed. */
export const STANDARD_KINDS: readonly Exclude<FolderKind, 'other'>[] = ['inbox', 'drafts', 'sent', 'archive', 'junk', 'deleted'];

export const FOLDER_NAME: Record<FolderKind, string> = { inbox: 'Inbox', drafts: 'Drafts', sent: 'Sent', archive: 'Archive', junk: 'Junk', deleted: 'Deleted', other: 'Folder' };

/** What Outlook calls each standard folder when it is asked for by name. */
export const GRAPH_NAME: Record<Exclude<FolderKind, 'other'>, WellKnownFolder> = { inbox: 'inbox', drafts: 'drafts', sent: 'sentitems', archive: 'archive', junk: 'junkemail', deleted: 'deleteditems' };

export const FOLDER_ICON: Record<FolderKind, string> = { inbox: 'inbox', drafts: 'edit', sent: 'send', archive: 'archive', junk: 'ban', deleted: 'trash', other: 'folder' };

const KIND_OF_NAME = Object.fromEntries(STANDARD_KINDS.map((k) => [GRAPH_NAME[k], k])) as Record<string, Exclude<FolderKind, 'other'>>;

/** The name of a standard folder as Outlook gives it ("sentitems") as a kind, or null for anything else. */
export const kindOfGraphName = (name: string): FolderKind | null => KIND_OF_NAME[name] ?? null;

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });

/**
 * The folders of one mailbox as the Folders screen lists them: the standard ones first, in a fixed order, then the folders you made, each
 * folder followed by the folders inside it. A folder knows how deep it sits among your own folders (`depth`) and where it is (`where`).
 * Outlook's own plumbing (Outbox, Sync Issues ...) is not in the list.
 */
export function buildFolders(account: string, tree: FolderTree): FolderInfo[] {
  const hidden = new Set(tree.hidden);
  const raw = new Map<string, RawFolder>(tree.folders.filter((f) => f.id && !hidden.has(f.id)).map((f) => [f.id, f]));
  const kindOfId = new Map<string, Exclude<FolderKind, 'other'>>();
  for (const [name, id] of Object.entries(tree.standard)) { const k = kindOfGraphName(name); if (k && k !== 'other' && id) kindOfId.set(id, k); }

  const nameOf = (f: RawFolder) => kindOfId.has(f.id) ? FOLDER_NAME[kindOfId.get(f.id)!] : (f.displayName || '').trim() || '(no name)';
  /** Folders above this one, nearest last, as far as Outlook told us about them. */
  const above = (f: RawFolder): RawFolder[] => {
    const chain: RawFolder[] = [];
    const seen = new Set<string>([f.id]);
    for (let p = f.parentFolderId ? raw.get(f.parentFolderId) : undefined; p && !seen.has(p.id) && chain.length < 8; p = p.parentFolderId ? raw.get(p.parentFolderId) : undefined) { chain.unshift(p); seen.add(p.id); }
    return chain;
  };
  const info = (f: RawFolder): FolderInfo => {
    const kind: FolderKind = kindOfId.get(f.id) ?? 'other';
    const chain = kind === 'other' ? above(f) : [];
    return {
      account, id: f.id, name: nameOf(f), kind, unread: Math.max(0, Number(f.unreadItemCount ?? 0)), total: Math.max(0, Number(f.totalItemCount ?? 0)),
      depth: chain.filter((p) => !kindOfId.has(p.id)).length, where: chain.map(nameOf).join(' / '),
    };
  };

  const standard = STANDARD_KINDS.map((k) => [...raw.values()].find((f) => kindOfId.get(f.id) === k)).filter((f): f is RawFolder => !!f).map(info);
  const own = [...raw.values()].filter((f) => !kindOfId.has(f.id));
  const kids = new Map<string, RawFolder[]>();
  for (const f of own) { const p = f.parentFolderId && own.some((x) => x.id === f.parentFolderId) ? f.parentFolderId : ''; kids.set(p, [...(kids.get(p) ?? []), f]); }
  const out: FolderInfo[] = [];
  const walk = (parent: string, seen: Set<string>) => {
    const list = (kids.get(parent) ?? []).filter((f) => !seen.has(f.id));
    // Folders at the top come first; those inside a standard folder follow, grouped under it.
    const sorted = parent === '' ? list.sort((a, b) => byName(info(a).where, info(b).where) || byName(nameOf(a), nameOf(b))) : list.sort((a, b) => byName(nameOf(a), nameOf(b)));
    for (const f of sorted) { out.push(info(f)); walk(f.id, new Set([...seen, f.id])); }
  };
  walk('', new Set());
  // Folders that cannot be reached from the top (Outlook never says so, but a ring of parents must not make folders vanish) are listed flat at the end.
  const placed = new Set(out.map((x) => x.id));
  for (const x of own) if (!placed.has(x.id)) out.push(info(x));
  return [...standard, ...out];
}

/** The folder a message was seen in, when the folders are known. */
export const folderOfMail = (folders: readonly FolderInfo[], m: Pick<Mail, 'account' | 'fid'>): FolderInfo | undefined => (m.fid ? folders.find((f) => f.account === m.account && f.id === m.fid) : undefined);

const firstWord = (name: string) => (name.includes('@') ? name : name.split(/\s+/)[0] || name);

/** Who a message went to, for a row: the person when it is one, else first names ("Anna, Per +1"). `toAddress` is the first one (the avatar). */
export function recipientsOf(list: { emailAddress?: { name?: string; address?: string } }[] = []): { to: string; toAddress: string } {
  const people = new Map<string, string>(); // address -> name
  for (const r of list) {
    const address = (r.emailAddress?.address ?? '').trim().toLowerCase();
    const name = (r.emailAddress?.name ?? '').trim();
    if (address || name) { const k = address || name.toLowerCase(); if (!people.has(k)) people.set(k, displayName(name, address)); }
  }
  const names = [...people.values()];
  const first = [...people.keys()].find((k) => k.includes('@')) ?? '';
  if (names.length <= 1) return { to: names[0] ?? '', toAddress: first };
  const shown = names.slice(0, 3).map(firstWord);
  return { to: `${shown.join(', ')}${names.length > 3 ? ` +${names.length - 3}` : ''}`, toAddress: first };
}

/**
 * A message from a folder list as a Mail. It is not in the inbox on this phone (`folder` says so, as for every message only seen in Outlook), it
 * remembers which folder it is in, and in Sent and Drafts it carries who it went to. Drafts are in order by when they were last changed.
 * `kind` is null when nobody knows which folder it is (a search result, before the folders were listed): the message then says so by having no `fk`.
 */
export function folderMail(account: string, r: RawMessage, kind: FolderKind | null, ctx: ClassifyContext): Mail {
  const base = toMail(account, r, ctx);
  const draft = !!r.isDraft;
  const fk: FolderKind | null = draft ? 'drafts' : kind;
  const wrote = fk === 'sent' || fk === 'drafts';
  return {
    ...base, folder: 'archive', snoozedUntil: null,
    ...(fk ? { fk } : {}),
    ...(r.parentFolderId ? { fid: r.parentFolderId } : {}),
    ...(draft ? { draft: true } : {}),
    ...(wrote ? { ...recipientsOf(r.toRecipients), kind: 'person' as const } : {}),
    ...(draft && r.lastModifiedDateTime ? { received: r.lastModifiedDateTime } : {}),
  };
}

/** One move a person can make from where a message is: where it goes, what to call it, and its icon. */
export interface Way { to: FolderKind; label: string; icon: string }

/** What is offered for a message that is not in the inbox, by the folder it is in ('unknown': nobody knows which). */
export interface PlaceActions {
  /** The button for "done with this here": it sends the message on. */
  primary: Way | null;
  /** Whether Delete is offered (a message in Deleted is already deleted). */
  canDelete: boolean;
  /** Swipe right, and swipe left, in a list of this folder. */
  swipe: { right: Way; left: Way };
}

export const ARCHIVE_WAY: Way = { to: 'archive', label: 'Archive', icon: 'archive' };
export const DELETE_WAY: Way = { to: 'deleted', label: 'Delete', icon: 'trash' };
const inboxWay = (label: string): Way => ({ to: 'inbox', label, icon: 'inbox' });

export function placeActions(place: FolderKind | 'unknown'): PlaceActions {
  switch (place) {
    case 'archive': return { primary: inboxWay('Inbox'), canDelete: true, swipe: { right: inboxWay('Inbox'), left: DELETE_WAY } };
    case 'junk': return { primary: inboxWay('Not junk'), canDelete: true, swipe: { right: inboxWay('Not junk'), left: DELETE_WAY } };
    case 'deleted': return { primary: inboxWay('Restore'), canDelete: false, swipe: { right: inboxWay('Restore'), left: ARCHIVE_WAY } };
    case 'drafts': return { primary: null, canDelete: true, swipe: { right: DELETE_WAY, left: DELETE_WAY } };
    case 'sent': case 'other': return { primary: ARCHIVE_WAY, canDelete: true, swipe: { right: ARCHIVE_WAY, left: DELETE_WAY } };
    case 'inbox': return { primary: ARCHIVE_WAY, canDelete: true, swipe: { right: ARCHIVE_WAY, left: DELETE_WAY } };
    default: return { primary: null, canDelete: true, swipe: { right: ARCHIVE_WAY, left: DELETE_WAY } };
  }
}

/** Where a message can be moved to (the Move to list): Inbox, Archive, Junk, Deleted and every folder of your own in its mailbox, except the one it is in. */
export function moveTargets(folders: readonly FolderInfo[], account: string, from?: { fid?: string; inbox?: boolean }): FolderInfo[] {
  return folders.filter((f) => f.account === account && f.kind !== 'drafts' && f.kind !== 'sent' && !(from?.fid && f.id === from.fid) && !(from?.inbox && f.kind === 'inbox'));
}

/** The address Outlook wants for a folder when a message is moved there: the name of a standard folder, the id of any other. */
export const destinationOf = (f: Pick<FolderInfo, 'kind' | 'id'>): string => (f.kind === 'other' ? f.id : GRAPH_NAME[f.kind]);
