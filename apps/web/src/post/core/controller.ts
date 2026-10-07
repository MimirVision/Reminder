import { isFreemail, orgDomain, rulesDigest, sendableRules, type ClassifyContext } from './classify.ts';
import { createDiag, worth } from './diag.ts';
import { createByteCache, emlName, mimeOf, saveName } from './files.ts';
import { buildFolders, folderMail, folderOfMail, GRAPH_NAME, recipientsOf } from './folders.ts';
import { createGraph, GraphError, type AttachmentInfo, type DraftContent, type DraftField, type DraftProgress, type Graph, type Outgoing, type OutFile, type RawMessage } from './graph.ts';
import { UNDO_WINDOW_MS, createQueue, isMove, type OpType } from './queue.ts';
import { createServer, createTokens, ServerError, type AccountStatus, type AlertExtra, type DeviceApi, type Server, type SignedIn } from './server.ts';
import { DEFAULT_SETTINGS, loadSettings, type Settings } from './settings.ts';
import { enrichHeaders, loadKnown, reclassifyAll, refreshKnown, rememberKnown, syncAccount } from './sync.ts';
import { search as searchLocal } from './search.ts';
import type { PendingOp, Store, StoreStatus } from './store.ts';
import { groupThreads, singles, threadKey, threadOf, type Thread } from './threads.ts';
import { asKind, KIND_TAB, KINDS, mailKey, type AttachmentRef, type FolderInfo, type FolderKind, type Kind, type Mail, type MailBody } from './types.ts';

// The brain of the app, with no browser or React in it so it is tested in Node. The screens only read `state` and call these methods.
// Rule everywhere: the screen changes first, the network follows, and nothing the user did is ever lost or silently undone.

/** Which tab of the inbox is open: one of the four kinds (Primary is 'person'), or everything. */
export type View = 'all' | Kind;
export interface Toast { id: number; text: string; undo?: () => void }

/** Which folder to open: a standard one (of one mailbox, or of every mailbox), or one of your own (always of one mailbox, by its id). */
export interface FolderTarget { kind: FolderKind; account?: string; id?: string }
/** The list of messages in a folder: read from Outlook when the folder is opened, kept only while Post is open. */
export interface FolderView {
  key: string;
  target: FolderTarget;
  /** Newest first. */
  items: Mail[];
  /** There is more to read below (the next page of at least one mailbox). */
  more: boolean;
  /** 'loading': being read (the items may be the ones from last time); 'failed': nothing could be read and there is nothing to show. */
  state: 'loading' | 'ready' | 'failed';
  /** The next page is being read. */
  paging: boolean;
  /** What went wrong with the last read, when it did. The items shown are then the ones from before. */
  error: string | null;
  /** The labels of mailboxes that could not be read when others could. */
  partial: string[];
  /** When it was last read (0: not yet). */
  at: number;
}
export const folderKey = (t: FolderTarget) => `${t.kind}|${t.account ?? ''}|${t.id ?? ''}`;
/** A file waiting to be sent: what the outbox list knows about it. The file itself is kept apart, under the account's own name, so removing the account removes it. */
export interface OutFileRef { name: string; type: string; size: number }
export interface OutboxItem { id: string; account: string; sendAt: number; kind: 'new' | 'reply' | 'replyAll' | 'forward' | 'draft'; to: string[]; cc: string[]; subject: string; body: string; replyTo?: string; files?: OutFileRef[]; /** failed tries so far (only counted for messages with files) */ attempts?: number;
  /** How far the message got at Outlook (its draft, and whether "send" was asked for): kept so that a try that was cut short is carried on, never repeated. */ draft?: DraftProgress;
  /** For a draft that lives at Outlook: which parts of it were changed here. The rest is left as Outlook has it. Everything, when it is not said. */ edited?: DraftField[];
  /** For a draft that lives at Outlook: when Outlook last changed it as of the time its text was read here. It goes back with the text if Undo is used or Outlook refuses the send. */ modified?: string }
/** Half-written text. `modified`: for a draft that lives at Outlook, when Outlook last changed it as of the time this text was read, so that a change made over there since is noticed. */
export interface Draft { account: string; to: string; cc: string; subject: string; body: string; replyTo?: string; mode: OutboxItem['kind']; modified?: string }
/** A draft that lives at Outlook. What was changed in it here is kept apart from the message being written (see `saveDraft`). */
export interface DraftOf { account: string; id: string }

export interface AppAccount extends AccountStatus { needsSignIn: boolean }

export interface State {
  ready: boolean;
  /** True when this site knows where its Post server is. Without it nothing can be signed in. */
  serverReady: boolean;
  /** A sign-in started on this device and not finished yet. */
  signingIn: boolean;
  accounts: AppAccount[];
  mail: Mail[];
  settings: Settings;
  /** What you moved by hand: "anna@x.no" for one sender, "@x.no" for a whole company. */
  overrides: Record<string, Kind>;
  view: View;
  unreadOnly: boolean;
  accountFilter: string | null;
  /** True while Post reads the hidden header marks of mail it has not sorted properly yet (the count comes from mailCounts). */
  sorting: boolean;
  sync: { running: boolean; at: number | null; error: string | null };
  online: boolean;
  waiting: number; // actions and mails not yet confirmed by the server
  outbox: OutboxItem[];
  toast: Toast | null;
  alertsOn: boolean; // this phone is paired for the icon number
  /** Whether the alert server follows the Primary tab (its code is new enough): null until it has been asked, false when it still has the older code. */
  serverSmart: boolean | null;
  /** How many messages have left the outbox since Post was opened (a conversation on screen asks again, to show your answer in it). */
  sent: number;
  /** Where Post's copy of the mail is kept: on the phone, or (when the phone would not let it) only in memory until Post is closed. */
  storage: 'device' | 'memory';
  /** The folders of every signed-in mailbox, as Outlook last listed them (empty until something asked for them). */
  folders: FolderInfo[];
  foldersLoading: boolean;
  /** Set when the folders could not be updated; `folders` is then the list from last time (or empty). */
  foldersError: string | null;
  /** The folder that is open, or was open last. */
  folder: FolderView | null;
}

export interface Deps {
  store: Store;
  kv: { get(k: string): string | null; set(k: string, v: string): void; del(k: string): void };
  fetch: typeof fetch;
  now?: () => number;
  /** The address of your Post server (the Supabase function). */
  serverUrl: string | null;
  /** The full address of this site's own route for passing big attachments on to Outlook (see worker/upload-relay.js). */
  uploadRelay?: string;
  /** Clears the icon number on this phone and tells the server it was seen. */
  seen?: (device: DeviceApi | null) => Promise<void>;
  pushState?: () => Promise<boolean>;
  setTimer?: (fn: () => void, ms: number) => unknown;
  sleep?: (ms: number) => Promise<void>;
}

/** A file opened for reading or saving. `link`: this attachment is only a link to a cloud file (there are no bytes). */
export interface Opened { name: string; type: string; bytes: Uint8Array; link?: string }

const MAX_TRIES = 3;          // a message with files is tried this many times (time offline does not count) and is then handed back as a draft
const DRAFT_FILES = 'draft-files';
/** What was changed in drafts that live at Outlook and was not saved or sent (kv: one entry per draft), and how long such a change is kept when the draft is never opened again. */
const EDITS = 'post.draftedits';
const EDITS_KEPT_MS = 30 * 24 * 3600 * 1000;
type Edits = Record<string, Draft & { at: number }>;
const editsKey = (of: DraftOf) => `${of.account}|${of.id}`;
const editFilesKey = (of: DraftOf) => `${of.account}|draftfiles|${of.id}`;
const outFileKey = (account: string, itemId: string, i: number) => `${account}|outfile|${itemId}|${i}`;
const SENDING_TOAST_MS = 180_000;
/** The rest of a conversation, as Outlook gave it, is trusted this long before it is asked for again. */
const CONVERSATION_FRESH_MS = 90_000;
/** The list of folders is trusted this long before it is asked for again. */
const FOLDERS_FRESH_MS = 45_000;
/** The messages of a folder just read are trusted this long when the folder is opened again (a pull to refresh always asks). */
const FOLDER_FRESH_MS = 20_000;
/** Folders whose messages are not part of a conversation you read: what you deleted, junk, and drafts that are not sent. */
const HIDDEN_FOLDERS = ['deleteditems', 'junkemail', 'drafts'] as const;

const NEEDS_SIGN_IN = /AADSTS(70000|700082|700084|50173|50076|50079|65001|70008|500011)|invalid_grant|interaction_required|unknown account|signed out/i;
type Session = { email: string; id: string; label: string; session: string };
const PENDING_MS = 15 * 60_000;
/** A sync that has done nothing at all (no call to Outlook or to the server, no step on the phone) for this long is stuck, and a new one may start. */
const SYNC_STUCK_MS = 150_000;
/** How many "this message moved, and is now called that" notes are kept for each mailbox. */
const MOVED_KEEP = 300;
/** An error nobody caught is said on screen at most this often. */
const CRASH_TOAST_EVERY_MS = 5 * 60_000;

export function createController(deps: Deps) {
  const now = deps.now ?? (() => Date.now());
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const { store, kv } = deps;
  const diag = createDiag({ now });
  const note = diag.note;
  let toldAboutCrash = 0; // when an error nobody caught was last said on screen

  // When Outlook or the server last answered, or Post last did something on the phone. A sync that has gone quiet for long is stuck.
  let lastActivity = now();
  const alive = () => { lastActivity = now(); };
  const watched: typeof fetch = async (...a) => { alive(); try { return await deps.fetch(...a); } finally { alive(); } };

  // Outlook gives a message a new id when it is moved (archive, delete). A reply that waits to be sent still points at the old one, so each
  // move is written down (old id to new id) and a waiting reply follows it.
  async function noteMoved(account: string, oldId: string, newId: string) {
    const key = `${account}|moved`;
    const notes = (await store.getMeta<Record<string, string>>(key)) ?? {};
    delete notes[oldId]; notes[oldId] = newId;
    const all = Object.keys(notes);
    for (const k of all.slice(0, Math.max(0, all.length - MOVED_KEEP))) delete notes[k];
    await store.setMeta(key, notes);
  }
  async function currentId(account: string, id: string): Promise<string> {
    const notes = (await store.getMeta<Record<string, string>>(`${account}|moved`)) ?? {};
    let cur = id;
    for (let hops = 0; hops < 4 && notes[cur] && notes[cur] !== cur; hops++) cur = notes[cur];
    return cur;
  }

  let refusedNow: PendingOp[] = [];
  const queue = createQueue(store, { now, onMoved: noteMoved, onRefused: (op) => { refusedNow.push(op); note('action', `Outlook refused to ${op.type} a message`); } });

  let state: State = {
    ready: false, serverReady: !!deps.serverUrl, signingIn: false, accounts: [], mail: [], settings: DEFAULT_SETTINGS, overrides: {}, view: 'person', unreadOnly: false, accountFilter: null, sorting: false,
    sync: { running: false, at: null, error: null }, online: true, waiting: 0, outbox: [], toast: null, alertsOn: false, serverSmart: null, sent: 0, storage: 'device',
    folders: [], foldersLoading: false, foldersError: null, folder: null,
  };
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  const set = (patch: Partial<State>) => { state = { ...state, ...patch }; emit(); };

  const server: Server | null = deps.serverUrl ? createServer(deps.serverUrl, watched) : null;
  let sessions: Session[] = [];
  const sessionOf = (email: string) => sessions.find((x) => x.email === email)?.session;
  const tokens = server ? createTokens(server, sessionOf, now) : null;
  const saveSessions = () => kv.set('post.sessions', JSON.stringify(sessions));
  const graphs = new Map<string, Graph>();
  let toastSeq = 0;
  let known: ReadonlySet<string> = new Set(); // addresses any signed-in mailbox has written to
  let sortingRun: Promise<void> | null = null;
  let syncRun: Promise<void> | null = null;
  let syncSeq = 0;
  const downloads = createByteCache<Opened>(48 * 1024 * 1024); // files already fetched for reading, so opening one again is instant
  const fetching = new Map<string, Promise<Opened>>();
  // Messages seen in Outlook that are not in the inbox on this phone (the rest of a conversation, results of "search all of Outlook"). Kept only
  // while Post is open: they are never saved, so nothing piles up on the phone and nothing old can come back to the list.
  const remote = new Map<string, Mail>();
  const remoteBodies = new Map<string, MailBody>();
  // Every message of a conversation as Outlook last said (all folders except Drafts, Deleted Items and Junk), and when. What is in the inbox on
  // this phone, or has just left it, is taken out each time a conversation is asked for, so this stays right while mail moves.
  const conversations = new Map<string, { at: number; items: Mail[] }>();
  const keepLatest = <T,>(map: Map<string, T>, key: string, value: T, max: number) => { map.delete(key); map.set(key, value); while (map.size > max) map.delete(map.keys().next().value!); };
  const remember = (list: Mail[]) => { for (const m of list) keepLatest(remote, m.key, m, 600); };
  /** Deleted messages are no longer part of any conversation, even in what was remembered a moment ago. */
  const forgetInConversations = (gone: Mail[]) => {
    const keys = new Set(gone.map((m) => m.key));
    for (const [k, v] of conversations) if (v.items.some((x) => keys.has(x.key))) conversations.set(k, { at: v.at, items: v.items.filter((x) => !keys.has(x.key)) });
  };
  // Changes that read a message from the phone and write it back (read, flag, snooze) go one after the other, so two of them started together
  // can never overwrite each other: the second one always sees what the first one saved.
  let editing: Promise<unknown> = Promise.resolve();
  const exclusive = <T,>(fn: () => Promise<T>): Promise<T> => { const run = editing.then(fn, fn); editing = run.catch(() => {}); return run; };

  /** Everything the sorting knows besides the message itself: what you moved by hand, who you have written to, your VIPs. */
  const sortCtx = (): ClassifyContext => ({ overrides: state.overrides, known, vips: new Set(state.accounts.flatMap((a) => a.vips ?? []).map((v) => v.toLowerCase())) });

  // ---- folders: what Outlook has besides the inbox ------------------------------------------------------------------------------------------
  // A folder is read from Outlook when it is opened and kept only while Post is open (like search results): the inbox is the only mail that lives
  // on the phone. What is read is `remember`ed, so the reader can open it, and acting on it (move, read, flag) works like acting on inbox mail:
  // the screen changes first, the queue carries it out after the undo time.
  const folderCursors = new Map<string, Record<string, string | null>>(); // folder key -> mailbox -> where its next page starts (null: nothing more there)
  let folderSeq = 0;                                                      // which opening of a folder is the current one: an answer for an older one is dropped
  let foldersAt = 0;
  let foldersRun: Promise<void> | null = null;
  const labelFor = (account: string) => state.accounts.find((a) => a.email === account)?.label ?? account;
  const describe = (e: unknown, fallback = 'Could not read this folder.') => ((e instanceof GraphError || e instanceof ServerError) && e.status === 0 ? 'No connection.' : e instanceof Error && e.message ? e.message : fallback);

  /** Messages that are waiting to be moved: no list shows them, even while Outlook still says they are where they were. */
  const leavingKeys = async () => new Set((await queue.pending()).filter((o) => isMove(o.type)).map((o) => mailKey(o.account, o.messageId)));

  /** A message seen in Outlook rather than in the inbox on this phone: in the folder that is open, or among what was seen this time. */
  const copyOf = (key: string): Mail | undefined => state.folder?.items.find((m) => m.key === key) ?? remote.get(key);

  /** What kind of folder a message is in, by the id Outlook gave the folder; null when the folders are not listed (yet) or Outlook did not say. */
  const kindOfFolder = (account: string, fid?: string): FolderKind | null => (fid ? state.folders.find((f) => f.account === account && f.id === fid)?.kind ?? null : null);

  const setView = (fn: (v: FolderView) => FolderView) => { if (state.folder) set({ folder: fn(state.folder) }); };

  /** Changes a message seen in Outlook, wherever it is kept: in the folder that is open and among what was seen this time. */
  function editCopy(key: string, patch: Partial<Mail>): Mail | undefined {
    const cur = copyOf(key);
    if (!cur) return undefined;
    const next = { ...cur, ...patch };
    if (remote.has(key)) keepLatest(remote, key, next, 600);
    // A new state either way: the reader of a message that is only among what was seen (a search result) must show the change too.
    const v = state.folder;
    set(v?.items.some((m) => m.key === key) ? { folder: { ...v, items: v.items.map((m) => (m.key === key ? next : m)) } } : {});
    return next;
  }

  /** Keeps the unread number of a folder right while mail in it is read or moved (Outlook is asked again when the folders are next opened). */
  const bumpUnread = (m: Pick<Mail, 'account' | 'fid'>, by: number) => {
    if (!m.fid || !state.folders.some((f) => f.account === m.account && f.id === m.fid)) return;
    set({ folders: state.folders.map((f) => (f.account === m.account && f.id === m.fid ? { ...f, unread: Math.max(0, f.unread + by) } : f)) });
  };

  /** Whether a message belongs in the folder list that is open (so that Undo can put it back there). */
  const belongsInView = (v: FolderView, m: Mail) => (v.target.kind === 'other' ? !!m.fid && m.fid === v.target.id && m.account === v.target.account : m.fk === v.target.kind && (!v.target.account || v.target.account === m.account));

  /**
   * Reads the first page of a folder (the next one, with `more`) from Outlook into the open list. A mailbox that cannot be read is named while the
   * others still show; when none can be read, what was shown stays and the problem is said.
   */
  async function fillFolder(mine: number, key: string, t: FolderTarget, more: boolean) {
    const accounts = t.account ? [t.account] : state.accounts.filter((a) => !a.needsSignIn).map((a) => a.email);
    const cursors: Record<string, string | null> = more ? { ...(folderCursors.get(key) ?? {}) } : {};
    const folder = t.kind === 'other' ? t.id ?? '' : GRAPH_NAME[t.kind];
    const results = await Promise.allSettled(accounts.map(async (account) => {
      if (more && cursors[account] === null) return { account, items: [] as Mail[], next: null as string | null };
      const g = graphFor(account);
      if (!g) throw new Error('Sign in again');
      const page = await g.folderPage(folder, { link: more ? cursors[account] ?? undefined : undefined, byChange: t.kind === 'drafts' });
      return { account, items: page.value.map((r) => folderMail(account, r, t.kind, sortCtx())), next: page.next ?? null };
    }));
    // Asked after the answers came: what was moved while Outlook was thinking is still on its way out, and a draft that is waiting to be sent is not a draft to open.
    const leaving = await leavingKeys();
    for (const o of await readOutbox()) if (o.kind === 'draft' && o.replyTo) leaving.add(mailKey(o.account, o.replyTo));
    const current = state.folder;
    if (mine !== folderSeq || !current || current.key !== key) return; // another folder was opened meanwhile
    const ok = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    const failed = accounts.filter((_, i) => results[i].status === 'rejected');
    const firstError = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')?.reason;
    if (firstError) note('folder', firstError);
    const byKey = new Map<string, Mail>();
    for (const m of [...(more ? current.items : []), ...ok.flatMap((r) => r.items)]) if (!leaving.has(m.key)) byKey.set(m.key, m);
    const items = [...byKey.values()].sort((a, b) => b.received.localeCompare(a.received));
    if (!ok.length) { // nothing could be read: what was shown stays
      set({ folder: { ...current, state: current.items.length ? 'ready' : 'failed', paging: false, error: describe(firstError) } });
      return;
    }
    for (const r of ok) cursors[r.account] = r.next;
    folderCursors.set(key, cursors);
    remember(ok.flatMap((r) => r.items));
    set({ folder: { ...current, items, more: Object.values(cursors).some((c) => typeof c === 'string'), state: 'ready', paging: false, error: null, partial: failed.map(labelFor), at: now() } });
  }

  /** Puts a message seen in Outlook back where it was (Undo of a move): into the folder list when that is the one open. */
  const putBack = (m: Mail) => {
    keepLatest(remote, m.key, m, 600);
    setView((v) => (belongsInView(v, m) && !v.items.some((x) => x.key === m.key) ? { ...v, items: [...v.items, m].sort((a, b) => b.received.localeCompare(a.received)) } : v));
    if (!m.isRead) bumpUnread(m, 1);
  };

  /** A message seen in Outlook that is gone (a draft that was sent): no list shows it any more. */
  const dropCopy = (key: string) => {
    remote.delete(key); remoteBodies.delete(key);
    setView((v) => (v.items.some((m) => m.key === key) ? { ...v, items: v.items.filter((m) => m.key !== key) } : v));
  };

  /** The open folder is read again the next time it is opened, however recently it was read. */
  const staleView = () => { if (state.folder && state.folder.at) setView((v) => ({ ...v, at: 0 })); };

  /** Drafts that are on their way out (outbox id -> the draft as the list had it): Undo, or a send that failed, lists the draft again at once. */
  const draftsOnTheirWay = new Map<string, Mail>();
  const relistDraft = (it: OutboxItem, again = true) => {
    const copy = draftsOnTheirWay.get(it.id);
    draftsOnTheirWay.delete(it.id);
    if (copy && again) putBack(copy);
    staleView();
  };

  /**
   * Takes messages out of the folder they are in and sends them somewhere else once the undo time has passed: archive, delete, or a move to any
   * folder. The messages are the ones in the inbox on this phone or ones seen in Outlook (a folder, a search result); both leave the screen at once.
   * It goes in line with the changes that read a message from the phone and write it back (read, flag, snooze): none of them may put back a
   * message that was just taken away. Undo gets the copies as they were at this moment.
   */
  async function relocate(items: Mail[], op: { type: 'archive' | 'delete' | 'move'; to?: string }, label: string) {
    if (!items.length) return;
    const moved = await exclusive(async () => {
      const taken: { mail: Mail; inbox: boolean }[] = [];
      const ops: PendingOp[] = [];
      for (const m of items) {
        const mine = await store.getMail(m.key);
        const cur = mine ?? copyOf(m.key);
        if (!cur) continue; // no longer in the inbox on this phone (moved somewhere else a moment ago) and not seen in Outlook either: nothing to take away
        ops.push(await queue.enqueue(op.type, cur.account, cur.id, undefined, op.to, !mine));
        taken.push({ mail: cur, inbox: !!mine });
      }
      if (!taken.length) return null;
      const inInbox = taken.filter((t) => t.inbox).map((t) => t.mail.key);
      if (inInbox.length) await store.deleteMail(inInbox);
      const away = new Set(taken.map((t) => t.mail.key));
      setView((v) => (v.items.some((m) => away.has(m.key)) ? { ...v, items: v.items.filter((m) => !away.has(m.key)) } : v));
      for (const t of taken) if (!t.mail.isRead) bumpUnread(t.mail, -1);
      if (op.type === 'delete' || op.to === GRAPH_NAME.deleted || op.to === GRAPH_NAME.junk) forgetInConversations(taken.map((t) => t.mail));
      await reload();
      return { taken, ops };
    });
    if (!moved) return;
    toast(label, () => { void api.undo(moved.ops.map((o) => o.id), moved.taken.map((t) => t.mail), moved.taken.map((t) => t.inbox)); });
    setTimer(() => {
      void runQueue()
        .then(() => (op.to === GRAPH_NAME.inbox ? api.sync() : undefined)) // mail moved to the inbox shows up there with its new name
        // and the folders' numbers follow: at once when mail moved to or from a folder of its own (those numbers are not kept up to date here), otherwise
        // when the list of folders is next due (plain archiving and deleting from the inbox must not read the whole list of folders every time)
        .then(() => (state.folders.length ? api.loadFolders(op.type === 'move' || moved.taken.some((t) => !t.inbox) ? { force: true } : undefined) : undefined))
        .then(reload);
    }, UNDO_WINDOW_MS + 200);
  }

  /**
   * Carries out what is due at Outlook (everything, when the app is leaving). Never fails. What Outlook would not do (a refusal that will not
   * change) is put right at once: that mailbox is read again from Outlook's side, so nothing on the phone goes on showing what did not happen.
   */
  async function runQueue(everything = false): Promise<void> {
    try { await queue.flush(graphFor, everything); } catch (e) { note('queue', e); return; }
    const refused = refusedNow; refusedNow = [];
    if (!refused.length) return;
    try { for (const account of new Set(refused.map((o) => o.account))) await store.setMeta(`${account}|delta`, undefined); } catch (e) { note('queue', e); }
    const lost = refused.filter((o) => isMove(o.type));
    if (lost.length) {
      const verb = lost.every((o) => o.type === 'archive') ? 'archive' : lost.every((o) => o.type === 'delete') ? 'delete' : 'move';
      const some = lost.length === 1 ? 'a message' : `${lost.length} messages`;
      const one = lost.length === 1;
      // Mail that was in the inbox comes back to it; mail that was moved out of a folder is simply where it was (its folder is read again).
      const stays = (o: PendingOp) => o.type === 'move' || !!o.fromFolder;
      const where = lost.every(stays) ? `${one ? 'it stays' : 'they stay'} where ${one ? 'it was' : 'they were'}` : lost.some(stays) ? `${one ? 'it is' : 'they are'} back where ${one ? 'it was' : 'they were'}` : `${one ? 'it comes' : 'they come'} back to your inbox`;
      toast(`Outlook would not ${verb} ${some}, so ${where}.`, undefined, 6000);
      if (state.folder) void api.openFolder(state.folder.target, { force: true });
    }
    setTimer(() => { void api.sync(); }, 300);
  }

  const graphFor = (email: string): Graph | null => {
    if (!tokens || !state.accounts.find((a) => a.email === email && !a.needsSignIn)) return null;
    let g = graphs.get(email);
    if (!g) {
      g = createGraph({
        fetch: watched, token: tokens.source(email), sleep: deps.sleep,
        uploadRelay: deps.uploadRelay, uploadViaRelay: kv.get('post.upload') === 'relay', onUploadRoute: () => kv.set('post.upload', 'relay'),
      });
      graphs.set(email, g);
    }
    return g;
  };

  function toast(text: string, undo?: () => void, ms?: number) {
    const id = ++toastSeq;
    set({ toast: { id, text, undo } });
    setTimer(() => { if (state.toast?.id === id) set({ toast: null }); }, ms ?? (undo ? UNDO_WINDOW_MS : 3500));
  }

  async function reload() {
    const [stored, ops, outbox] = await Promise.all([store.allMail(), queue.pending(), store.getMeta<OutboxItem[]>('outbox')]);
    // Archived or deleted here and Outlook not told yet: it stays out of the list, even if something that was busy with an older copy of it
    // (sorting the mail, for one) wrote it back to the phone a moment later. Undo, or Outlook's answer, settles it.
    const leaving = new Set(ops.filter((o) => isMove(o.type)).map((o) => mailKey(o.account, o.messageId)));
    const mail = leaving.size ? stored.filter((m) => !leaving.has(m.key)) : stored;
    mail.sort((a, b) => b.received.localeCompare(a.received));
    // "Waiting" means held up, not just inside the undo window: only actions that are already due and still not confirmed count.
    const waiting = ops.filter((o) => o.runAfter <= now()).length + (outbox ?? []).filter((o) => o.sendAt <= now()).length;
    set({ mail, waiting, outbox: outbox ?? [], storage: store.status?.().kind === 'memory' ? 'memory' : 'device' });
  }

  function saveSettings(s: Settings) { kv.set('post.settings', JSON.stringify(s)); set({ settings: s }); }

  /** Saves what you moved by hand and re-sorts everything at once. */
  async function applyOverrides(overrides: Record<string, Kind>) {
    await store.setMeta('overrides', overrides);
    set({ overrides });
    await reclassifyAll(store, sortCtx());
    await reload();
    void pushTaught(); // the icon number follows the same choices
  }

  /**
   * Tells the alert server which senders and companies were moved to another tab, so that the icon number follows the Primary tab. Only for a
   * mailbox whose server holds something else (it says so in its status), one after the other so the latest list is always the last to arrive.
   * Never fails anything: what does not get through now is sent the next time the server's status is read.
   */
  let taughtRun: Promise<void> = Promise.resolve();
  function pushTaught(): Promise<void> {
    const run = async () => {
      if (!server || state.serverSmart !== true) return;
      for (const x of sessions) {
        const rules = sendableRules(state.overrides); // a choice of a shape no server can hold stays on the phone
        if (state.accounts.find((a) => a.email === x.email)?.rules_digest === rulesDigest(rules)) continue;
        try {
          const r = await server.taught(x.session, { rules });
          set({ accounts: state.accounts.map((a) => (a.email === x.email ? { ...a, extra: r.extra, rules_digest: r.rules_digest } : a)) });
        } catch (e) { note('alerts', e); }
      }
    };
    taughtRun = taughtRun.then(run, run);
    return taughtRun;
  }

  /** Looks at Sent Items now and then, so mail from people you have written to is always Primary. Never fails a sync. */
  async function learnKnown(email: string, g: Graph) {
    try {
      if (!(await refreshKnown({ graph: g, store, account: email, now }))) return;
      known = await loadKnown(store, state.accounts.map((a) => a.email));
      await reclassifyAll(store, sortCtx());
      await reload();
    } catch { /* a nicety: the next sync tries again */ }
  }

  /**
   * The ids of the folders whose messages are left out of a conversation. Asked of Outlook once and kept on the phone, but only when Outlook
   * named all of them: an answer with one missing (a busy moment) is used this time and asked for again the next.
   */
  async function hiddenFolders(account: string, g: Graph): Promise<Set<string>> {
    const key = `${account}|folders`;
    const complete = (x?: Record<string, string>) => !!x && HIDDEN_FOLDERS.every((n) => !!x[n]);
    let ids = await store.getMeta<Record<string, string>>(key);
    if (!complete(ids)) {
      try { ids = await g.folderIds([...HIDDEN_FOLDERS]); } catch { ids = undefined; } // not worth failing the conversation for: it is shown with deleted mail in it rather than not at all
      if (complete(ids)) await store.setMeta(key, ids);
    }
    return new Set(Object.values(ids ?? {}));
  }

  /** Asks the server about each signed-in mailbox. A mailbox the server no longer recognises is marked "sign in again", never dropped. */
  async function refreshAccounts(): Promise<void> {
    if (!server) return;
    const prev = new Map(state.accounts.map((a) => [a.email, a]));
    const out: AppAccount[] = [];
    let offline = false;
    let smart: boolean | null = null;
    for (const x of sessions) {
      const old = prev.get(x.email);
      try {
        const r = await server.status(x.session);
        smart = (r.smart ?? 0) >= 1;
        const a = r.accounts.find((y) => y.email === x.email) ?? r.accounts[0];
        out.push({ ...(a as AccountStatus), needsSignIn: old?.needsSignIn && !a ? true : false });
      } catch (e) {
        if (e instanceof ServerError && e.status === 0) offline = true;
        const signedOut = e instanceof ServerError && e.status === 401;
        out.push({ ...(old ?? { id: x.id, email: x.email, label: x.label, mode: 'people', quiet: null, vips: [], subscription_expires_at: null, last_alert_at: null }), needsSignIn: signedOut || (old?.needsSignIn ?? false) });
      }
    }
    await store.setMeta('accounts', out);
    set({ accounts: out, serverSmart: smart ?? state.serverSmart, ...(offline ? { online: false } : { online: true }) });
    void pushTaught(); // a mailbox whose server holds other choices than this phone (just signed in, or a change that did not get through) is brought up to date
  }

  /** Any signed-in session, for things that belong to the device rather than to one mailbox (alerts, the icon number). */
  function device(): DeviceApi | null {
    const x = sessions.find((y) => !state.accounts.find((a) => a.email === y.email)?.needsSignIn) ?? sessions[0];
    if (!server || !x) return null;
    return {
      vapid: () => server.vapid(),
      pair: (p) => server.pair(x.session, p),
      seen: (endpoint) => server.seen(x.session, endpoint),
      test: () => server.test(x.session),
      ping: async () => { const t0 = Date.now(); await server.status(x.session); return Date.now() - t0; },
    };
  }

  function readPending(): { handle: string; at: number } | null {
    try { const p = JSON.parse(kv.get('post.pending') ?? 'null'); return p && typeof p.handle === 'string' && Date.now() - p.at < PENDING_MS ? p : null; } catch { return null; }
  }

  // ---- messages waiting to be sent ---------------------------------------------------------------------------------------------------------
  let flushing: Promise<void> | null = null;
  let flushAgain = false;
  let flushAgainEarly = false;

  // The outbox is changed by sending, Undo, a run that has just sent something, a run noting how far a message got, and removing a mailbox.
  // Each reads the list, changes it and writes it back, so they go one after the other (the slow part of a run, talking to Outlook, is never
  // inside this): none of them can write an older list back over another's change.
  let outboxEditing: Promise<unknown> = Promise.resolve();
  const outboxExclusive = <T,>(fn: () => Promise<T>): Promise<T> => { const run = outboxEditing.then(fn, fn); outboxEditing = run.catch(() => {}); return run; };
  const readOutbox = async () => (await store.getMeta<OutboxItem[]>('outbox')) ?? [];
  /** Changes one waiting message in place and leaves every other change made meanwhile alone. */
  const patchOutbox = (id: string, patch: Partial<OutboxItem>) => outboxExclusive(async () => {
    const list = await readOutbox();
    if (list.some((x) => x.id === id)) await store.setMeta('outbox', list.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  });

  // A message is not in the outbox until its files are saved, and big files take a while. `leaving()` waits for what is still being put in,
  // so that a message sent a moment before the person left goes with the rest.
  const beingPutIn = new Set<Promise<unknown>>();
  const putIn = <T,>(p: Promise<T>): Promise<T> => { beingPutIn.add(p); const done = () => { beingPutIn.delete(p); }; p.then(done, done); return p; };

  /** The files of an outbox item, read back from the phone. Any that are gone are named in `lost`. */
  async function loadOutFiles(it: OutboxItem): Promise<{ files: OutFile[]; lost: string[] }> {
    const files: OutFile[] = [], lost: string[] = [];
    for (let i = 0; i < (it.files?.length ?? 0); i++) {
      const ref = it.files![i];
      let bytes: Uint8Array | undefined;
      try { bytes = await store.getMeta<Uint8Array>(outFileKey(it.account, it.id, i)); } catch { /* counted as lost */ }
      if (bytes instanceof Uint8Array && bytes.byteLength === ref.size) files.push({ name: ref.name, type: ref.type, bytes }); else lost.push(ref.name);
    }
    return { files, lost };
  }
  async function dropOutFiles(it: OutboxItem) {
    for (let i = 0; i < (it.files?.length ?? 0); i++) { try { await store.setMeta(outFileKey(it.account, it.id, i), undefined); } catch { /* nothing more to do */ } }
  }

  // What was changed in drafts that live at Outlook and not saved or sent yet: one entry per draft, apart from the message being written (see `saveDraft`).
  const readEdits = (): Edits => { try { const x = JSON.parse(kv.get(EDITS) ?? '{}'); return x && typeof x === 'object' && !Array.isArray(x) ? x : {}; } catch { return {}; } };
  const writeEdits = (all: Edits) => { if (Object.keys(all).length) kv.set(EDITS, JSON.stringify(all)); else kv.del(EDITS); };
  /**
   * Lets go of kept changes that nobody will come back for: those of one mailbox that was removed (`account`), or, with none given, those of
   * drafts that were not opened for a month (a draft sent from another app leaves its changes behind on this phone).
   */
  function sweepEdits(account?: string) {
    const all = readEdits();
    let changed = false;
    for (const [k, d] of Object.entries(all)) {
      const bar = k.indexOf('|');
      if (account ? k.slice(0, bar) !== account : now() - (d?.at ?? 0) < EDITS_KEPT_MS) continue;
      delete all[k]; changed = true;
      if (!account && bar > 0) void store.setMeta(editFilesKey({ account: k.slice(0, bar), id: k.slice(bar + 1) }), undefined).catch(() => {}); // a removed mailbox's files go with it
    }
    if (changed) writeEdits(all);
  }

  /** Where the text of a message that comes back from the outbox is kept: a draft that lives at Outlook has a place of its own, everything else is the message being written. */
  const placeOf = (it: OutboxItem): DraftOf | undefined => (it.kind === 'draft' && it.replyTo ? { account: it.account, id: it.replyTo } : undefined);
  const textOf = (it: OutboxItem): Draft => ({ account: it.account, to: it.to.join(', '), cc: it.cc.join(', '), subject: it.subject, body: it.body, replyTo: it.replyTo, mode: it.kind, ...(it.kind === 'draft' && it.modified ? { modified: it.modified } : {}) });

  /**
   * The message goes back to the editor, with its files, and the person is told why. Its half-made copy at Outlook is thrown away.
   * `vanished`: it was a draft at Outlook and that draft is not there any more: it has nowhere to be edited, so it comes back as a message of its own.
   */
  async function handBack(it: OutboxItem, given: OutFile[], why: string, g: Graph, vanished = false) {
    const progress = (await readOutbox()).find((x) => x.id === it.id)?.draft ?? it.draft;
    // Once "send" was asked for the files were not needed from the phone any more, so they were not read: the person gets them back all the same.
    const files = given.length || !it.files?.length ? given : (await loadOutFiles(it)).files;
    const place = vanished ? undefined : placeOf(it);
    api.saveDraft(vanished ? { ...textOf(it), mode: 'new', replyTo: undefined, modified: undefined } : textOf(it), place); // a message of its own has no draft at Outlook to be compared with
    if (files.length) await api.saveDraftFiles(files, place);
    await dropOutFiles(it);
    if (it.kind === 'draft') relistDraft(it, !vanished); // the draft is still at Outlook (unless it vanished): the Drafts list lists it again
    toast(`Could not send: ${why}. Your message${files.length ? ' and its files are' : ' is'} saved as a draft.`, undefined, files.length ? 8000 : undefined);
    if (progress && it.kind !== 'draft') await g.discard(progress.id); // a draft that was already at Outlook is the person's own: it stays
  }

  /** Whether a message that is about to be given up on had in fact gone out: it is only handed back when Outlook still holds it as a draft, so it can never go twice. */
  async function wentAlready(it: OutboxItem, g: Graph): Promise<'went' | 'not' | 'unknown'> {
    const progress = (await readOutbox()).find((x) => x.id === it.id)?.draft;
    if (progress?.phase !== 'sending') return 'not';
    try { return (await g.draftState(progress.id)) === 'draft' ? 'not' : 'went'; } catch { return 'unknown'; }
  }

  /** The message a waiting reply answers is being moved away (an archive waiting or just done): "not found" is then only "not yet", and its new name is known soon. */
  async function followingMove(account: string, id: string, used: string): Promise<boolean> {
    if ((await currentId(account, id)) !== used) return true;
    return (await queue.pending()).some((o) => o.account === account && o.messageId === id && isMove(o.type));
  }

  const outgoing = (it: OutboxItem, replyTo: string | undefined): Outgoing =>
    it.kind === 'draft' && replyTo ? { kind: 'draft', draftId: replyTo, subject: it.subject, body: it.body, to: it.to, cc: it.cc, ...(it.edited ? { edited: it.edited } : {}) }
    : it.kind === 'new' || it.kind === 'draft' || !replyTo ? { kind: 'new', subject: it.subject, body: it.body, to: it.to, cc: it.cc }
    : it.kind === 'forward' ? { kind: 'forward', replyTo, to: it.to, body: it.body }
    : { kind: it.kind, replyTo, body: it.body };

  async function putInOutbox(item: Omit<OutboxItem, 'id' | 'sendAt' | 'files' | 'attempts'>, files: OutFile[]): Promise<boolean> {
    const delay = state.settings.undoSend * 1000;
    const it: OutboxItem = {
      ...item, id: `o${now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, sendAt: now() + delay,
      ...(files.length ? { files: files.map((f) => ({ name: f.name, type: f.type, size: f.bytes.byteLength })) } : {}),
    };
    if (files.length) {
      try { for (let i = 0; i < files.length; i++) await store.setMeta(outFileKey(it.account, it.id, i), files[i].bytes); } catch {
        await dropOutFiles(it);
        toast('The files could not be kept on this phone (is the storage full?), so nothing was sent. Your message is still here.', undefined, 6000);
        return false;
      }
    }
    await outboxExclusive(async () => { await store.setMeta('outbox', [...(await readOutbox()), it]); });
    if (it.kind === 'draft' && it.replyTo) { // a draft that is on its way is not a draft to open (it is listed again if Undo is used)
      const key = mailKey(it.account, it.replyTo);
      const copy = copyOf(key);
      if (copy) draftsOnTheirWay.set(it.id, copy);
      dropCopy(key);
    }
    // The text kept for this message goes with it: a draft at Outlook has a place of its own, and sending it never touches the message that is being written.
    // (A reply sent while another message is half written must not throw that one away either.)
    const place = placeOf(it);
    if (place) api.saveDraft(null, place);
    else { const saved = api.loadDraft(); if (!saved || (saved.mode === item.kind && saved.replyTo === item.replyTo)) api.saveDraft(null); }
    await reload();
    toast(delay ? 'Sending…' : 'Sent', delay ? () => { void api.cancelSend(it.id); } : undefined, delay || undefined);
    setTimer(() => { void api.flushOutbox().then(reload); }, delay + 100);
    return true;
  }

  async function flushOutboxOnce(early = false) {
    const list = await readOutbox();
    const finished = new Set<string>();                    // sent, or handed back to the editor
    const kept = new Map<string, Partial<OutboxItem>>();   // failed, will be tried again: what changes about them
    let sent = 0;
    let learned = false;
    let sendingToast = 0;
    const gone = async (it: OutboxItem) => {
      sent++;
      conversations.clear(); // your message is in Sent Items now: the next time a conversation is opened it is asked for again
      draftsOnTheirWay.delete(it.id);
      if (it.kind === 'draft' && it.replyTo) dropCopy(mailKey(it.account, it.replyTo)); // it is not among the drafts any more
      staleView();                                                                        // and Sent has one more
      finished.add(it.id);
      await dropOutFiles(it);
      if (await rememberKnown(store, it.account, [...it.to, ...it.cc])) learned = true;
    };
    for (const it of list) {
      if (!early && it.sendAt > now()) continue;
      const g = graphFor(it.account);
      if (!g) continue;
      if (it.sendAt > now()) await patchOutbox(it.id, { sendAt: now() }); // on its way now: there is no Undo any more
      let files: OutFile[] = [];
      let answered = it.replyTo;
      try {
        // Once "send" has been asked for, every file is on the draft already: none is needed from the phone (and one lost from it does not matter).
        if (it.draft?.phase !== 'sending') {
          const loaded = await loadOutFiles(it);
          files = loaded.files;
          if (loaded.lost.length) { await handBack(it, files, `${loaded.lost.join(', ')} ${loaded.lost.length > 1 ? 'are' : 'is'} no longer stored on this phone`, g); finished.add(it.id); continue; }
        }
        if (files.length) { toast(files.length === 1 ? 'Sending your file… keep Post open until it says Sent' : `Sending ${files.length} files… keep Post open until it says Sent`, undefined, SENDING_TOAST_MS); sendingToast = toastSeq; }
        answered = it.replyTo ? await currentId(it.account, it.replyTo) : undefined;
        await g.deliver(outgoing(it, answered), files, it.draft, (p) => patchOutbox(it.id, { draft: p }));
        await gone(it);
      } catch (e) {
        if (e instanceof GraphError && e.status === 404 && it.replyTo && await followingMove(it.account, it.replyTo, answered ?? it.replyTo)) continue;
        // Rejected for good (bad address, too big etc.): hand it back as a draft instead of retrying forever or losing it.
        const refused = e instanceof GraphError && e.status >= 400 && e.status < 500 && e.status !== 401 && e.status !== 429;
        // A message with files is not tried for ever either: a big upload that keeps failing while the connection is fine is handed back.
        const tries = (it.attempts ?? 0) + (e instanceof GraphError && e.status === 0 && !state.online ? 0 : 1);
        // A draft that is not at Outlook any more (sent or deleted somewhere else) is not a message that was sent: its text is kept, as a message of its own.
        const vanished = it.kind === 'draft' && e instanceof GraphError && e.status === 404;
        if (refused) { await handBack(it, files, e instanceof Error ? e.message : 'Outlook said no', g, vanished); finished.add(it.id); }
        else if (it.files?.length && tries >= MAX_TRIES) {
          const went = await wentAlready(it, g);
          if (went === 'went') await gone(it);
          else if (went === 'unknown') kept.set(it.id, { attempts: tries - 1 });
          else { await handBack(it, files, e instanceof Error ? e.message : 'Outlook said no', g); finished.add(it.id); }
        } else if (it.files?.length) kept.set(it.id, { attempts: tries });
        note('send', e);
      }
    }
    // Written from the list as it is now, changing only what this run learned: a message put in (or taken back with Undo) while this ran must stay as it is.
    const left = (finished.size || kept.size)
      ? await outboxExclusive(async () => {
        const next = (await readOutbox()).filter((x) => !finished.has(x.id)).map((x) => (kept.has(x.id) ? { ...x, ...kept.get(x.id) } : x));
        await store.setMeta('outbox', next);
        return next;
      })
      : await readOutbox();
    if (learned) { known = await loadKnown(store, state.accounts.map((a) => a.email)); await reclassifyAll(store, sortCtx()); }
    if (sent) set({ sent: state.sent + sent });
    if (sent && !left.length) toast(sent === 1 ? 'Sent' : `Sent ${sent}`);
    else if (kept.size) toast('Not sent yet. Post will try again.', undefined, 6000);
    else if (sendingToast && state.toast?.id === sendingToast) set({ toast: null });
  }

  const api = {
    getState: () => state,
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },

    async init() {
      // Whatever goes wrong while reading what is saved on the phone, Post still opens (with what it could read) and reads the mail again:
      // a start that waits for ever on a splash screen is the worst thing it could do.
      try {
        // Older versions saved other names (newsletter, receipt, alert): they become the nearest of the four kinds.
        const savedRules = (await store.getMeta<Record<string, unknown>>('overrides')) ?? {};
        const overrides: Record<string, Kind> = {};
        for (const [who, v] of Object.entries(savedRules)) { const kind = asKind(v); if (kind) overrides[who] = kind; }
        if (JSON.stringify(savedRules) !== JSON.stringify(overrides)) await store.setMeta('overrides', overrides);
        try { const x = JSON.parse(kv.get('post.sessions') ?? '[]'); sessions = Array.isArray(x) ? x.filter((y: Session) => y && typeof y.email === 'string' && typeof y.session === 'string') : []; } catch { sessions = []; }
        const cachedAccounts = ((await store.getMeta<AppAccount[]>('accounts')) ?? []).filter((a) => sessions.some((x) => x.email === a.email));
        let settings = DEFAULT_SETTINGS;
        try { settings = loadSettings(JSON.parse(kv.get('post.settings') ?? 'null')); } catch { /* defaults */ }
        set({ settings, accounts: cachedAccounts, overrides, signingIn: !!readPending() });
        try { sweepEdits(); } catch { /* only tidying */ }
        known = await loadKnown(store, cachedAccounts.map((a) => a.email));
        await reclassifyAll(store, sortCtx()); // every start: a better rule applies to mail already on the phone, and older saved kinds are renamed
        await reload();
      } catch (e) {
        note('start', e);
        try { sessions = (JSON.parse(kv.get('post.sessions') ?? '[]') as Session[]).filter((y) => y && typeof y.email === 'string' && typeof y.session === 'string'); } catch { sessions = []; }
        // Still signed in: the mailboxes are listed as they were signed in until the server has been asked, so the sign-in screen does not flash up.
        set({
          accounts: sessions.map((x) => ({ id: x.id, email: x.email, label: x.label, mode: 'people', quiet: null, vips: [], subscription_expires_at: null, last_alert_at: null, needsSignIn: false })),
          sync: { ...state.sync, error: 'Post could not read everything that is saved on this phone. It is reading your mail again.' },
        });
      }
      set({ ready: true });
      await api.opened();
    },

    /** Called when the app opens or comes back to the front: this is "I have looked". */
    async opened() {
      try { await api.collectSignIn(); } catch (e) { note('sign-in', e); }
      if (!sessions.length) return;
      try { await deps.seen?.(device()); } catch { /* the number is a nicety; never block reading on it */ }
      try { set({ alertsOn: (await deps.pushState?.()) ?? false }); } catch { /* ignore */ }
      await api.sync();
    },

    /**
     * The app is going away: closed, or sent to the background where the phone may stop it for hours. Whatever still waits for its undo time
     * goes now, because nothing can be relied on to run later. (Undo is only for as long as Post is in front.)
     */
    async leaving() {
      // What was tapped a moment ago may still be on its way into the phone's storage (an archive; a message with big files): it is waited
      // for, so that it goes with the rest and not the next time Post is opened.
      await Promise.allSettled([...beingPutIn]);
      await exclusive(async () => {});
      // In this order: a reply that waits to be sent may answer a message that was just archived, and then it goes to the message's new name,
      // which is only known once the archive has gone through. (Neither of the two ever fails.)
      await runQueue(true);
      await api.flushOutbox(true);
    },

    // ---- signing in -------------------------------------------------------------------------------------------------------
    /** One button: returns the Microsoft address to send this window to. */
    async startSignIn(redirectUri: string, hint?: string): Promise<string> {
      if (!server) throw new Error('This site does not know where your Post server is yet.');
      const r = await server.signinStart(redirectUri, hint);
      kv.set('post.pending', JSON.stringify({ handle: r.handle, at: Date.now() }));
      set({ signingIn: true });
      return r.url;
    },

    /** The window Microsoft sent us back to: finish the sign-in. */
    async finishSignIn(code: string, state: string): Promise<{ email: string; fromThisApp: boolean }> {
      if (!server) throw new Error('This site does not know where your Post server is yet.');
      const pending = readPending();
      const r = await server.signinFinish({ code, state });
      // Whether this window is the one that started the sign-in: if not, the server keeps the result for the app that did.
      if (pending) { kv.del('post.pending'); void server.signinForget(pending.handle).catch(() => {}); }
      if (pending) await api.signedIn(r);
      return { email: r.email, fromThisApp: !!pending };
    },

    /** The sign-in finished in another window (iOS can open it separately): collect it now. */
    async collectSignIn() {
      const p = readPending();
      if (!p) { if (state.signingIn) set({ signingIn: false }); return; }
      if (!server) return;
      try {
        const r = await server.signinPoll(p.handle);
        if (r.status === 'done') { kv.del('post.pending'); await api.signedIn(r); }
      } catch { /* try again next time the app is looked at */ }
    },

    cancelSignIn() { kv.del('post.pending'); set({ signingIn: false }); },

    async signedIn(r: SignedIn) {
      sessions = [...sessions.filter((x) => x.email !== r.email), { email: r.email, id: r.id, label: r.label, session: r.session }];
      saveSessions();
      kv.del('post.pending');
      graphs.delete(r.email); tokens?.forget(r.email);
      set({ signingIn: false });
      await refreshAccounts();
      void api.sync();
    },

    forgetEverything() {
      kv.del('post.sessions'); kv.del('post.settings'); kv.del('post.pending');
      for (const k of Object.keys(readEdits())) { const bar = k.indexOf('|'); if (bar > 0) void store.setMeta(editFilesKey({ account: k.slice(0, bar), id: k.slice(bar + 1) }), undefined).catch(() => {}); } // what was changed in drafts and not saved goes too, files with it
      kv.del(EDITS);
      sessions = [];
      graphs.clear();
      remote.clear(); remoteBodies.clear(); folderCursors.clear(); foldersAt = 0;
      set({ accounts: [], mail: [], settings: DEFAULT_SETTINGS, signingIn: false, folders: [], foldersLoading: false, foldersError: null, folder: null });
    },

    // ---- sync -----------------------------------------------------------------------------------------------------------
    async sync() {
      if (!server) return;
      // A sync that has done nothing at all for a long time is stuck (the phone stopped it half way): it is left behind and a new one starts.
      if (state.sync.running) {
        if (now() - lastActivity < SYNC_STUCK_MS) return;
        note('sync', 'The last sync went quiet, so a new one was started');
      }
      const mine = ++syncSeq;
      alive();
      set({ sync: { ...state.sync, running: true } });
      let done!: () => void;
      const finished = new Promise<void>((r) => { done = r; });
      syncRun = finished;
      let error: string | null = null;
      try {
        await refreshAccounts();
        for (const a of state.accounts) {
          const g = graphFor(a.email);
          if (!g) continue;
          try {
            await syncAccount({ graph: g, store, account: a.email, ctx: sortCtx(), now: () => new Date(now()) });
            alive();
            await reload();
            await learnKnown(a.email, g);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            if (e instanceof ServerError && NEEDS_SIGN_IN.test(msg)) {
              set({ accounts: state.accounts.map((x) => (x.email === a.email ? { ...x, needsSignIn: true } : x)) });
            } else if (e instanceof ServerError && e.status === 0 || e instanceof GraphError && e.status === 0) {
              set({ online: false }); error = 'No connection. Showing what is on this phone.';
            } else { error = `${a.label}: ${msg}`; note('sync', e); }
          }
        }
        await runQueue();
        await api.flushOutbox();
        await reload();
        if (!error) set({ online: true });
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
        note('sync', e);
      } finally {
        if (mine === syncSeq) { set({ sync: { running: false, at: now(), error } }); syncRun = null; }
        done();
      }
      void api.sortInBackground();
    },

    /**
     * Reads every mailbox again from Outlook's side, as on the first day. What is waiting to be sent is kept. The cure for a phone that shows
     * something different from Outlook, whatever the reason.
     */
    async readAgain() {
      if (syncRun) await syncRun.catch(() => {}); // a read that is going would write its own place back over the one forgotten here
      for (const a of state.accounts) await store.setMeta(`${a.email}|delta`, undefined);
      toast('Reading your mail again from Outlook…', undefined, 4000);
      await api.sync();
    },

    /** Where Post's copy of the mail is kept, for the Health page. */
    storageStatus(): StoreStatus { return store.status?.() ?? { kind: 'device', reopened: 0, lastError: null }; },

    /**
     * Reads the hidden header marks of mail that has only had a first guess, a group at a time, and moves each message to its tab as soon as
     * it knows. Runs alongside everything else: reading, archiving and the next sync do not wait for it. Returns when it is finished.
     */
    sortInBackground(): Promise<void> {
      if (sortingRun) return sortingRun;
      const run = async () => {
        set({ sorting: true });
        let painted = 0;
        try {
          for (const a of state.accounts) {
            const g = graphFor(a.email);
            if (!g) continue;
            try {
              await enrichHeaders({
                graph: g, store, account: a.email, ctx: sortCtx, sleep: deps.sleep, stop: () => !graphFor(a.email),
                onProgress: async () => { if (now() - painted >= 1500) { painted = now(); await reload(); } },
              });
            } catch { /* offline or refused: the next sync picks it up again */ }
          }
        } finally {
          set({ sorting: false });
          await reload();
        }
      };
      const p: Promise<void> = run().finally(() => { sortingRun = null; });
      sortingRun = p;
      return p;
    },

    // ---- accounts ---------------------------------------------------------------------------------------------------------
    async removeAccount(email: string) {
      const x = sessions.find((y) => y.email === email);
      if (!server || !x) return;
      try { await server.unregister(x.session); } catch (e) { if (!(e instanceof ServerError && e.status === 401)) throw e; }
      sessions = sessions.filter((y) => y.email !== email);
      saveSessions();
      graphs.delete(email); tokens?.forget(email);
      // Work going on for this mailbox stops at its next step, and what is already under way finishes before anything is cleared:
      // a message saved a moment after the clearing would bring the mailbox back onto the phone.
      set({
        accounts: state.accounts.filter((a) => a.email !== email),
        folders: state.folders.filter((f) => f.account !== email),
        folder: !state.folder || state.folder.target.account === email ? null : { ...state.folder, items: state.folder.items.filter((m) => m.account !== email) },
      });
      for (const [k, m] of remote) if (m.account === email) { remote.delete(k); remoteBodies.delete(k); }
      await Promise.allSettled([syncRun, sortingRun, foldersRun]);
      await store.clearAccount(email);
      try { sweepEdits(email); } catch { /* only tidying: what is left of the kept changes is let go of when it is a month old */ }
      await outboxExclusive(async () => {
        const waiting = await readOutbox();
        if (waiting.some((x) => x.account === email)) await store.setMeta('outbox', waiting.filter((x) => x.account !== email)); // their files went with clearAccount
      });
      await refreshAccounts();
      await reload();
    },

    async setAlerts(email: string, patch: { mode?: AccountStatus['mode']; quiet?: AccountStatus['quiet']; vips?: string[]; label?: string }) {
      if (!server) return;
      const before = state.accounts;
      set({ accounts: before.map((a) => (a.email === email ? { ...a, ...patch, vips: patch.vips ?? a.vips } : a)) });
      const x = sessions.find((y) => y.email === email);
      try { if (!x) throw new Error('Sign in again first'); await server.update(x.session, patch); } catch (e) {
        set({ accounts: before });
        toast(e instanceof Error ? e.message : 'Could not save');
      }
      if (patch.vips) { await reclassifyAll(store, sortCtx()); await reload(); } // a VIP's mail is always Primary
    },

    /** What counts for the icon number besides Primary mail (this mailbox): nothing, one-time codes and sign-in alerts, or all of Transactions. */
    async setExtra(email: string, extra: AlertExtra) {
      if (!server) return;
      const before = state.accounts;
      set({ accounts: before.map((a) => (a.email === email ? { ...a, extra } : a)) });
      const x = sessions.find((y) => y.email === email);
      try {
        if (!x) throw new Error('Sign in again first');
        const r = await server.taught(x.session, { extra });
        set({ accounts: state.accounts.map((a) => (a.email === email ? { ...a, extra: r.extra, rules_digest: r.rules_digest } : a)) });
      } catch (e) {
        set({ accounts: state.accounts.map((a) => (a.email === email ? { ...a, extra: before.find((b) => b.email === email)?.extra } : a)) });
        toast(e instanceof ServerError && e.status === 400 ? 'This needs the newer alert server code. See Settings, Alerts.' : e instanceof Error ? e.message : 'Could not save');
      }
    },

    /** Sends the moved senders to the alert server now (it also happens by itself whenever they change or the server's status shows it holds others). */
    syncTaught() { return pushTaught(); },

    // ---- triage -------------------------------------------------------------------------------------------------------------
    /** `rows`: how many rows of the list this was (a conversation is one row, however many messages it holds); the toast counts rows. */
    async archive(items: Mail[], rows: number = items.length) { return await api.moveAway(items, 'archive', 'Archived', rows); },
    async trash(items: Mail[], rows: number = items.length) { return await api.moveAway(items, 'delete', 'Deleted', rows); },

    async moveAway(items: Mail[], type: Extract<OpType, 'archive' | 'delete'>, word: string, rows: number = items.length) {
      await relocate(items, { type }, rows <= 1 ? word : `${word} ${rows}`);
    },

    /** Moves messages (from the inbox, or seen in a folder) to another folder, with one Undo. `rows`: how many rows of the list this was, for the toast. */
    async moveTo(items: Mail[], to: { to: string; name: string }, rows: number = items.length) {
      await relocate(items, { type: 'move', to: to.to }, rows <= 1 ? `Moved to ${to.name}` : `Moved ${rows} to ${to.name}`);
    },

    /** `inbox`: for each message, whether it came from the inbox on this phone (it goes back there) or was only seen in Outlook (it goes back into its folder list). Not given: all from the inbox. */
    async undo(opIds: string[], items: Mail[], inbox?: boolean[]) {
      const late = await exclusive(async () => {
        let n = 0;
        for (let i = 0; i < opIds.length; i++) {
          if (!(await queue.cancel(opIds[i]))) { n++; continue; }
          if (inbox?.[i] === false) putBack(items[i]); else await store.putMail([items[i]]);
        }
        await reload();
        return n;
      });
      toast(late ? 'Too late: it already went through' : 'Undone');
    },

    setRead(m: Mail, isRead: boolean) {
      return exclusive(async () => {
        const cur = await store.getMail(m.key);
        if (!cur) { // not in the inbox on this phone: one seen in a folder is changed there and at Outlook; anything else (archived meanwhile) is left alone
          const far = copyOf(m.key);
          if (!far || far.isRead === isRead) return;
          editCopy(far.key, { isRead });
          bumpUnread(far, isRead ? -1 : 1);
          await queue.enqueue(isRead ? 'read' : 'unread', far.account, far.id, 0);
          void runQueue().then(reload);
          return;
        }
        if (cur.isRead === isRead) return;
        await store.putMail([{ ...cur, isRead }]);
        await queue.enqueue(isRead ? 'read' : 'unread', m.account, m.id, 0);
        await reload();
        void runQueue().then(reload);
      });
    },

    setFlag(m: Mail, flagged: boolean) { return api.setFlags([m], flagged); },

    setFlags(items: Mail[], flagged: boolean) {
      return exclusive(async () => {
        const todo: Mail[] = [];
        const far: Mail[] = []; // seen in a folder, not in the inbox on this phone
        for (const m of items) {
          const cur = await store.getMail(m.key);
          if (cur) { if (cur.flagged !== flagged) todo.push(cur); continue; }
          const seen = copyOf(m.key);
          if (seen && seen.flagged !== flagged) far.push(seen);
        }
        if (!todo.length && !far.length) return;
        if (todo.length) await store.putMail(todo.map((m) => ({ ...m, flagged })));
        for (const m of far) editCopy(m.key, { flagged });
        for (const m of [...todo, ...far]) await queue.enqueue(flagged ? 'flag' : 'unflag', m.account, m.id, 0);
        await reload();
        void runQueue().then(reload);
      });
    },

    /** Flags a conversation (its newest message), or, when something in it is already flagged, takes the flag off every message that has one. */
    async toggleFlag(items: Mail[]) {
      const flagged = items.filter((m) => m.flagged);
      if (flagged.length) await api.setFlags(flagged, false); else if (items[0]) await api.setFlags([items[0]], true);
    },

    /** "Answer this later": flags the conversation's newest message and marks the conversation read, so it leaves Unread but stays in Later. */
    async replyLater(items: Mail[]) {
      if (items[0]) await api.setFlags([items[0]], true);
      await api.markRead(items, { quiet: true });
    },

    /** Snoozes a message or a whole conversation (its messages that are in the inbox), with one Undo. */
    snooze(m: Mail | Mail[], until: Date, label: string) {
      return exclusive(async () => {
        const items = Array.isArray(m) ? m : [m];
        const fresh: Mail[] = [];
        const before = new Map<string, string | null>(); // what each one was snoozed until before, for Undo
        for (const x of items) { const cur = await store.getMail(x.key); if (cur) { before.set(cur.key, cur.snoozedUntil ?? null); fresh.push({ ...cur, snoozedUntil: until.toISOString() }); } } // one archived meanwhile must not come back
        if (!fresh.length) return;
        await store.putMail(fresh);
        await reload();
        toast(`Snoozed until ${label}`, () => { void api.setSnoozes(before); });
      });
    },
    unsnooze(m: Mail | Mail[]) { return api.setSnoozes(new Map((Array.isArray(m) ? m : [m]).map((x) => [x.key, null]))); },
    /** Puts each message's snooze back to what is given (null: not snoozed). A message that is no longer in the inbox on this phone is left alone. */
    setSnoozes(until: ReadonlyMap<string, string | null>) {
      return exclusive(async () => {
        for (const [key, at] of until) {
          const cur = await store.getMail(key);
          if (cur) await store.putMail([{ ...cur, snoozedUntil: at }]);
        }
        await reload();
      });
    },

    /**
     * "Put this sender (or everything from their company) in this tab", or null to go back to automatic. Re-sorts everything at once, and is
     * the fix for every wrong guess. Shared mail providers (gmail.com ...) are never made a company rule.
     */
    async moveSender(address: string, kind: Kind | null, scope: 'sender' | 'company' = 'sender') {
      const addr = address.trim().toLowerCase();
      const company = scope === 'company' && !isFreemail(addr);
      const key = company ? `@${orgDomain(addr)}` : addr;
      const before = state.overrides;
      const overrides = { ...before };
      if (kind) overrides[key] = kind; else delete overrides[key];
      await applyOverrides(overrides);
      toast(kind ? `Moved to ${KIND_TAB[kind]}. ${company ? `Everything from ${key.slice(1)}` : 'Mail from this sender'} goes there from now on.` : 'Back to automatic sorting', () => { void applyOverrides(before); });
    },

    /** Forgets one saved choice (from Settings, Sorting). */
    async removeRule(key: string) {
      const before = state.overrides;
      if (!(key in before)) return;
      const overrides = { ...before };
      delete overrides[key];
      await applyOverrides(overrides);
      toast('Rule removed', () => { void applyOverrides(before); });
    },

    /** Marks these as read in one go, with one toast (or none, when `quiet`: opening a conversation marks it read without a word). */
    markRead(items: Mail[], opts: { quiet?: boolean } = {}) {
      return exclusive(async () => {
        // The copy on the phone as it is now: one archived or changed meanwhile must not be brought back or overwritten with an older copy.
        const todo: Mail[] = [];
        const far: Mail[] = []; // seen in a folder, not in the inbox on this phone
        for (const m of items) {
          const cur = await store.getMail(m.key);
          if (cur) { if (!cur.isRead) todo.push(cur); continue; }
          const seen = copyOf(m.key);
          if (seen && !seen.isRead) far.push(seen);
        }
        if (!todo.length && !far.length) return;
        if (todo.length) await store.putMail(todo.map((m) => ({ ...m, isRead: true })));
        for (const m of far) { editCopy(m.key, { isRead: true }); bumpUnread(m, -1); }
        for (const m of [...todo, ...far]) await queue.enqueue('read', m.account, m.id, 0);
        await reload();
        // The toast counts rows of the list: a conversation is one, however many messages in it were unread.
        const rows = (state.settings.threads ? new Set(todo.map(threadKey)).size : todo.length) + far.length;
        if (!opts.quiet) toast(rows === 1 ? 'Marked as read' : `Marked ${rows} as read`);
        void runQueue().then(reload);
      });
    },

    /** Read and unread for a conversation (newest message first): anything unread in it is marked read; when it is all read, its newest message becomes unread. */
    async toggleRead(items: Mail[]) {
      if (items.some((m) => !m.isRead)) await api.markRead(items, { quiet: true });
      else if (items[0]) await api.setRead(items[0], false);
    },

    /** Archives the Promotions older than `days` days (never a flagged one), a conversation at a time, with one Undo. Returns how many rows that was. */
    async cleanUp(days: number, nowMs: number = now()) {
      const rows = cleanUpThreads(state, nowMs, days);
      if (rows.length) await api.archive(rows.flatMap((t) => t.items), rows.length);
      return rows.length;
    },

    // ---- reading -------------------------------------------------------------------------------------------------------------
    /**
     * The message text, who it went to and what is attached. The list of attachments is always asked for, side by side with the text, because
     * Outlook's "has attachments" leaves out files that Apple Mail marks as part of the text. When the list cannot be read the text still
     * shows, and the list is asked for again the next time the message is opened, so a file is never silently missing.
     */
    async openBody(m: Mail): Promise<MailBody> {
      // A message that is on this phone keeps its text there; one that is only seen in Outlook (an older message of a conversation, a search
      // result) is kept in memory while Post is open, so reading it never fills the phone.
      const onPhone = !!(await store.getMail(m.key));
      let body = onPhone ? await store.getBody(m.key) : remoteBodies.get(m.key);
      if (body?.listed && !body.attachmentsFailed) return body;
      const g = graphFor(m.account);
      if (!g) { if (body) return body; throw new Error('Sign in again to read this message'); }
      const listing = g.attachments(m.id).then(
        (attachments) => ({ attachments, listed: true, attachmentsFailed: false }),
        () => ({ attachmentsFailed: true }),
      );
      if (body) body = { ...body, ...(await listing) };
      else {
        const [j, l] = await Promise.all([g.getBody(m.id), listing]);
        const addr = (r: any) => ({ name: String(r?.emailAddress?.name ?? ''), address: String(r?.emailAddress?.address ?? '') });
        body = {
          key: m.key, contentType: String(j?.body?.contentType).toLowerCase() === 'html' ? 'html' : 'text', content: String(j?.body?.content ?? ''),
          to: (j?.toRecipients ?? []).map(addr), cc: (j?.ccRecipients ?? []).map(addr), attachments: [], ...l,
        };
      }
      // Kept on the phone for next time, unless it was archived while its text was coming. The phone refusing (storage full) must never keep the
      // message from being read: it is then kept in memory while Post is open instead.
      let kept = false;
      if (onPhone && (await store.getMail(m.key))) { try { await store.putBody(body); kept = true; } catch (e) { note('storage', e); } }
      if (!kept) keepLatest(remoteBodies, m.key, body, 40);
      return body;
    },

    async headersOf(m: Mail) { const g = graphFor(m.account); return g ? await g.getHeaders(m.id) : []; },

    /** One attachment through the JSON route: with its content id (for pictures inside the mail) and, for a cloud file, where it lives. */
    async attachment(m: Mail, attachmentId: string) { const g = graphFor(m.account); if (!g) throw new Error('Sign in again'); return await g.attachmentBlob(m.id, attachmentId); },

    /**
     * An attachment's file, for reading or saving. Fetched as the raw file first (no base64 detour, so big files stay light), the older JSON
     * route second. Remembered while Post is open, and asked for only once when it is tapped twice.
     */
    openAttachment(m: Mail, a: AttachmentRef): Promise<Opened> {
      const key = `${m.key}|${a.id}`;
      const hit = downloads.get(key);
      if (hit) return Promise.resolve(hit);
      const running = fetching.get(key);
      if (running) return running;
      const run = (async (): Promise<Opened> => {
        const g = graphFor(m.account);
        if (!g) throw new Error('Sign in again to open this file');
        if (a.kind === 'link') {
          const j = await g.attachmentBlob(m.id, a.id);
          if (!j.link) throw new Error(`${a.name} is a link to a file in the cloud, and Outlook did not say where. Open the message in Outlook to get it.`);
          return { name: a.name, type: 'text/html', bytes: new Uint8Array(0), link: j.link };
        }
        let got: Opened;
        try {
          const r = await g.attachmentValue(m.id, a.id);
          got = { name: a.kind === 'item' ? emlName(a.name) : saveName(a.name), type: a.kind === 'item' ? 'message/rfc822' : mimeOf(a.name, r.type && !/^(text\/html|application\/json)/i.test(r.type) ? r.type : a.contentType), bytes: r.bytes };
        } catch (first) {
          if (a.kind === 'item') throw first;
          try {
            const j = await g.attachmentBlob(m.id, a.id);
            got = { name: saveName(j.name || a.name), type: mimeOf(a.name, j.contentType || a.contentType), bytes: j.bytes };
          } catch (second) {
            // The first answer is the better one to report, unless it was only that the connection failed (a second try at the other route is then the news).
            throw first instanceof GraphError && first.status === 0 ? second : first;
          }
        }
        downloads.set(key, got);
        return got;
      })();
      fetching.set(key, run);
      const done = () => { fetching.delete(key); };
      run.then(done, done);
      return run;
    },

    // ---- search ------------------------------------------------------------------------------------------------------------------
    searchLocal(q: string): Mail[] {
      const labels: Record<string, string> = Object.fromEntries(state.accounts.map((a) => [a.email, a.label]));
      return searchLocal(state.mail, q, labels);
    },
    /** Asks Outlook itself, for mail older than what is stored on the phone. Each result knows which folder it is in, once the folders are listed. */
    async searchRemote(q: string): Promise<Mail[]> {
      const out: Mail[] = [];
      const seen = new Set(state.mail.map((m) => m.key));
      const listing = state.folders.length ? undefined : api.loadFolders().catch(() => {}); // asked side by side with the search; a failure only means the results do not say their folder
      const found: { account: string; rows: RawMessage[] }[] = [];
      for (const a of state.accounts) {
        const g = graphFor(a.email);
        if (!g) continue;
        try { found.push({ account: a.email, rows: await g.search(q.replace(/\b(from|is|has|in|account):\S*/gi, '').trim() || q) }); } catch { /* one account failing must not hide the others' results */ }
      }
      await listing;
      for (const { account, rows } of found) {
        for (const r of rows) { const m = folderMail(account, r, kindOfFolder(account, r.parentFolderId), sortCtx()); if (!seen.has(m.key)) out.push(m); }
      }
      out.sort((x, y) => y.received.localeCompare(x.received));
      remember(out);
      return out;
    },

    // ---- conversations -----------------------------------------------------------------------------------------------------------
    /** The messages that go with this one: the whole conversation when conversations are on (just this message when they are off), newest first, inbox only. */
    threadOf(m: Mail): Mail[] { return threadOf(state.mail, m, state.settings.threads); },

    /** A message Post has seen in Outlook this time it was open (the rest of a conversation, a search result), though it is not in the inbox on this phone. */
    remoteMail(account: string, id: string): Mail | undefined { return remote.get(mailKey(account, id)); },

    /**
     * The rest of this message's conversation from Outlook itself: your own replies (Sent Items), messages archived or moved to other folders,
     * and older mail the phone does not hold. Not what is in the inbox on this phone (that is already here), and never drafts, deleted or junk.
     * Newest first. Kept only while Post is open; nothing is saved, so the inbox on this phone stays what it was.
     */
    async loadConversation(m: Mail, opts: { force?: boolean } = {}): Promise<Mail[]> {
      if (!m.conversationId) return [];
      const g = graphFor(m.account);
      if (!g) throw new Error('Sign in again to see the rest of this conversation');
      const ck = threadKey(m);
      const hit = conversations.get(ck);
      let found: Mail[];
      if (hit && !opts.force && now() - hit.at < CONVERSATION_FRESH_MS) found = hit.items;
      else {
        const [raw, hidden] = await Promise.all([g.conversation(m.conversationId), hiddenFolders(m.account, g)]);
        found = raw.filter((r) => !r.isDraft && !(r.parentFolderId && hidden.has(r.parentFolderId))).map((r) => folderMail(m.account, r, kindOfFolder(m.account, r.parentFolderId), sortCtx()));
        keepLatest(conversations, ck, { at: now(), items: found }, 60);
      }
      // Not what is in the inbox on this phone (that is already here), and not what was archived or deleted here a moment ago and Outlook has
      // not been told yet. Worked out now, not when Outlook was asked, because mail moves in between.
      const here = new Set(state.mail.map((x) => x.key));
      const leaving = await leavingKeys();
      const items = found.filter((x) => !here.has(x.key) && !leaving.has(x.key)).map((x): Mail => ({ ...x, folder: 'archive', snoozedUntil: null }));
      items.sort((x, y) => y.received.localeCompare(x.received));
      remember(items);
      return items;
    },

    // ---- folders -----------------------------------------------------------------------------------------------------------------
    /**
     * The folders of every signed-in mailbox, from Outlook. What Outlook said last time is kept on the phone and used at once (so the screen is
     * not empty while Outlook is asked, and a phone with no connection still has the list); a list that is only a moment old is not asked for
     * again unless `force`. A mailbox that cannot be read keeps the list it had, and the problem is said in `foldersError`.
     */
    async loadFolders(opts: { force?: boolean } = {}): Promise<void> {
      if (!state.folders.length) {
        try {
          const saved = (await Promise.all(state.accounts.filter((a) => !a.needsSignIn).map(async (a) => (await store.getMeta<FolderInfo[]>(`${a.email}|foldertree`)) ?? []))).flat();
          if (saved.length && !state.folders.length) set({ folders: saved });
        } catch (e) { note('folders', e); }
      }
      if (foldersRun) {
        if (!opts.force) return foldersRun;
        await foldersRun.catch(() => {});  // one that began before what the caller has just done (a move) may have missed it: ask again
        if (foldersRun) return foldersRun; // another began meanwhile, and it is as new as this one would be
      } else if (!opts.force && foldersAt && now() - foldersAt < FOLDERS_FRESH_MS) return;
      const accounts = state.accounts.filter((a) => !a.needsSignIn).map((a) => a.email);
      if (!accounts.length) return;
      const run: Promise<void> = (async () => {
        set({ foldersLoading: true });
        try {
          const results = await Promise.allSettled(accounts.map(async (account) => {
            const g = graphFor(account);
            if (!g) throw new Error('Sign in again');
            return { account, list: buildFolders(account, await g.folderTree()) };
          }));
          const here = (account: string) => state.accounts.some((a) => a.email === account && !a.needsSignIn); // a mailbox removed meanwhile is not brought back
          const ok = results.flatMap((r) => (r.status === 'fulfilled' && here(r.value.account) ? [r.value] : []));
          const failed = accounts.filter((a, i) => results[i].status === 'rejected' && here(a));
          const firstError = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')?.reason;
          if (firstError) note('folders', firstError);
          for (const o of ok) { try { await store.setMeta(`${o.account}|foldertree`, o.list); } catch (e) { note('storage', e); } }
          const fresh = new Map(ok.map((o) => [o.account, o.list]));
          const folders = state.accounts.flatMap((a) => fresh.get(a.email) ?? state.folders.filter((f) => f.account === a.email));
          if (ok.length) foldersAt = failed.length ? 0 : now();
          set({
            folders, foldersLoading: false,
            foldersError: !failed.length ? null : ok.length ? `Could not update the folders of ${failed.map(labelFor).join(' and ')}.` : describe(firstError, 'Could not read your folders.'),
          });
        } catch (e) {
          note('folders', e);
          set({ foldersLoading: false, foldersError: describe(e, 'Could not read your folders.') });
        }
      })().finally(() => { foldersRun = null; });
      foldersRun = run;
      return run;
    },

    /** The folder a message was seen in, when the folders are listed. */
    folderOf(m: Pick<Mail, 'account' | 'fid'>): FolderInfo | undefined { return folderOfMail(state.folders, m); },

    /**
     * Opens a folder: its newest messages are read from Outlook into `state.folder`. What was there from the last time the same folder was open
     * stays on screen while it is read again. A folder read a moment ago is not read again unless `force` (a pull to refresh, Retry).
     */
    async openFolder(t: FolderTarget, opts: { force?: boolean } = {}): Promise<void> {
      const key = folderKey(t);
      const same = state.folder?.key === key ? state.folder : null;
      if (same && !opts.force && (same.state === 'loading' || (same.state === 'ready' && now() - same.at < FOLDER_FRESH_MS))) return;
      const mine = ++folderSeq;
      set({ folder: { key, target: t, items: same?.items ?? [], more: same?.more ?? false, state: 'loading', paging: false, error: null, partial: [], at: same?.at ?? 0 } });
      await fillFolder(mine, key, t, false);
    },
    /** The next page of the open folder. */
    async moreInFolder(): Promise<void> {
      const v = state.folder;
      if (!v || !v.more || v.paging || v.state !== 'ready') return;
      const mine = ++folderSeq;
      set({ folder: { ...v, paging: true, error: null } });
      await fillFolder(mine, v.key, v.target, true);
    },
    /** Reads the open folder again from Outlook. */
    refreshFolder(): Promise<void> { return state.folder ? api.openFolder(state.folder.target, { force: true }) : Promise.resolve(); },
    /** Leaves the folder: its list is forgotten (the next opening reads it afresh). */
    closeFolder() { if (state.folder) set({ folder: null }); },

    /**
     * A message by its id, when Post has not seen it this time (the address of a message that was moved since, a link kept from earlier): it is
     * asked of Outlook. Null when Outlook does not have it any more.
     */
    async findMail(account: string, id: string): Promise<Mail | null> {
      const known = (await store.getMail(mailKey(account, id))) ?? copyOf(mailKey(account, id));
      if (known) return known;
      const g = graphFor(account);
      if (!g) throw new Error('Sign in again to open this message');
      const cur = await currentId(account, id); // a message that was moved by Post is called something else now
      const seen = cur === id ? undefined : (await store.getMail(mailKey(account, cur))) ?? copyOf(mailKey(account, cur));
      if (seen) return seen;
      let r: RawMessage;
      try { r = await g.getMessage(cur); } catch (e) { if (e instanceof GraphError && (e.status === 404 || e.status === 410)) return null; throw e; }
      const m = folderMail(account, r, kindOfFolder(account, r.parentFolderId), sortCtx());
      remember([m]);
      return m;
    },

    /**
     * A draft as the editor needs it, with the files already on it. It fails (and the editor says so) when the draft is not a draft any more or its
     * files cannot be listed: a draft opened without its files would look like one that has none.
     */
    async openDraft(account: string, id: string): Promise<{ content: DraftContent; files: AttachmentInfo[] }> {
      const g = graphFor(account);
      if (!g) throw new Error('Sign in again to open this draft');
      let content: DraftContent, files: AttachmentInfo[];
      try { [content, files] = await Promise.all([g.getDraft(id), g.attachments(id)]); } catch (e) {
        if (e instanceof GraphError && (e.status === 404 || e.status === 410)) throw new Error('This draft is not in Outlook any more. It may have been sent or deleted in another app.');
        throw e;
      }
      if (!content.isDraft) throw new Error('This message has already been sent.');
      return { content, files };
    },

    /**
     * Saves what the editor has into the draft at Outlook without sending it: what was changed (`edited`: all of it when it is not said) and the
     * files that were added. Throws when Outlook would not take it, so the editor can say so and keep what was typed; trying again is safe (a file that
     * is on the draft already is not added twice).
     */
    async saveDraftEdits(account: string, id: string, f: { subject: string; body: string; to: string[]; cc: string[]; edited?: DraftField[] }, files: OutFile[] = []): Promise<void> {
      const g = graphFor(account);
      if (!g) throw new Error('Sign in again to save this draft');
      try {
        await g.updateDraft(id, f);
        await g.addToDraft(id, files);
      } catch (e) {
        if (e instanceof GraphError && (e.status === 404 || e.status === 410)) throw new Error('This draft is no longer in Outlook.');
        throw e;
      }
      editCopy(mailKey(account, id), { subject: f.subject, preview: f.body.replace(/\s+/g, ' ').trim().slice(0, 200), ...recipientsOf(f.to.map((address) => ({ emailAddress: { address } }))), received: new Date(now()).toISOString() });
      staleView();
    },

    // ---- writing ----------------------------------------------------------------------------------------------------------------
    // Two kinds of half-written text are kept on the phone, apart from each other: the message being written here (new, a reply or a forward; one
    // at a time) and, for each draft that is open from Outlook (`of`), what was changed in it. Opening or editing one never touches the other.
    saveDraft(d: Draft | null, of?: DraftOf) {
      if (!of) { if (d) kv.set('post.draft', JSON.stringify(d)); else { kv.del('post.draft'); void store.setMeta(DRAFT_FILES, undefined).catch(() => {}); } return; }
      const all = readEdits();
      if (d) all[editsKey(of)] = { ...d, at: now() }; else delete all[editsKey(of)];
      writeEdits(all);
      if (!d) void store.setMeta(editFilesKey(of), undefined).catch(() => {});
    },
    loadDraft(of?: DraftOf): Draft | null {
      if (!of) { try { return JSON.parse(kv.get('post.draft') ?? 'null'); } catch { return null; } }
      const kept = readEdits()[editsKey(of)];
      if (!kept) return null;
      const d: Draft & { at?: number } = { ...kept };
      delete d.at;
      return d;
    },

    /** The files attached to the draft being written. They live next to the text, so closing the app loses neither. */
    async loadDraftFiles(of?: DraftOf): Promise<OutFile[]> {
      try {
        const v = await store.getMeta<OutFile[]>(of ? editFilesKey(of) : DRAFT_FILES);
        return Array.isArray(v) ? v.filter((f) => f && typeof f.name === 'string' && f.bytes instanceof Uint8Array) : [];
      } catch { return []; }
    },
    /** Returns false when the phone would not keep them (storage full): the files then stay on screen but would be lost if the app closes. */
    async saveDraftFiles(files: OutFile[], of?: DraftOf): Promise<boolean> {
      try { await store.setMeta(of ? editFilesKey(of) : DRAFT_FILES, files.length ? files : undefined); return true; } catch { return false; }
    },

    /**
     * Puts a message in the outbox. It leaves after the undo-send delay, even if the app is closed and reopened meanwhile. Its files are kept
     * on the phone until it has left. Returns false (and sends nothing) when the files could not be kept.
     */
    send(item: Omit<OutboxItem, 'id' | 'sendAt' | 'files' | 'attempts'>, files: OutFile[] = []): Promise<boolean> {
      return putIn(putInOutbox(item, files));
    },
    async cancelSend(id: string) {
      const found = await outboxExclusive(async () => {
        const list = await readOutbox();
        const it = list.find((x) => x.id === id);
        if (!it || it.sendAt <= now()) return { it, files: [] as OutFile[], taken: false };
        const { files } = await loadOutFiles(it);
        await store.setMeta('outbox', list.filter((x) => x.id !== id));
        return { it, files, taken: true };
      });
      const { it, files } = found;
      if (!found.taken || !it) { toast(it ? 'Too late: it is already on its way' : 'Too late: it was already sent'); return; }
      api.saveDraft(textOf(it), placeOf(it));
      if (files.length) await api.saveDraftFiles(files, placeOf(it));
      await dropOutFiles(it);
      if (it.kind === 'draft') relistDraft(it); // it is among the drafts again
      await reload();
      toast(`Not sent. Your message${files.length ? ' and its files are' : ' is'} back in the editor.`);
    },

    /**
     * Sends what is due (everything, with `early`: the app is leaving). Only one run at a time: a big upload takes a while, and a second run
     * must never send the same message again. Never fails: what went wrong stays with the message, which is tried again.
     */
    flushOutbox(early = false): Promise<void> {
      if (early) flushAgainEarly = true;
      if (flushing) { flushAgain = true; return flushing; }
      const p: Promise<void> = (async () => {
        for (;;) {
          flushAgain = false;
          const everything = flushAgainEarly; flushAgainEarly = false;
          try { await flushOutboxOnce(everything); } catch (e) { note('send', e); }
          // Let go in the same breath as the last look: a run asked for after it would otherwise be answered by one that has already finished.
          if (!flushAgain) { flushing = null; return; }
        }
      })();
      flushing = p;
      return p;
    },

    async unsubscribe(m: Mail, mailto: { to: string; subject: string; body: string }) {
      const g = graphFor(m.account);
      if (!g) throw new Error('Sign in again');
      await g.sendMail({ subject: mailto.subject, body: mailto.body, to: [mailto.to] });
      toast('Unsubscribe request sent');
    },

    // ---- view ----------------------------------------------------------------------------------------------------------------------------
    setView(view: View) { set({ view }); },
    setUnreadOnly(unreadOnly: boolean) { set({ unreadOnly }); },
    setAccountFilter(accountFilter: string | null) { set({ accountFilter }); },
    setSettings(patch: Partial<Settings>) { saveSettings({ ...state.settings, ...patch }); },
    toast,
    device,
    /** Writes a problem down for the Health page and the problem report (an address in the text is replaced). */
    note,
    /**
     * Something nobody caught (a screen that threw, a promise nobody waited for). It is written down; unless it is only the browser talking to
     * itself, or a lost connection (which has its own banner), it is also said on screen, at most once in a while and never over an Undo.
     */
    crashed(kind: string, what: unknown) {
      const w = worth(what);
      if (w === 'noise') return;
      note(kind, what);
      if (w === 'network' || state.toast?.undo || (toldAboutCrash && now() - toldAboutCrash < CRASH_TOAST_EVERY_MS)) return;
      toldAboutCrash = now();
      toast('Something went wrong in the background. Settings, Health has the details.', undefined, 6000);
    },
    /** What went wrong lately, oldest first. */
    problems: diag.list,
    clearProblems: diag.clear,
  };
  return api;
}

export type Controller = ReturnType<typeof createController>;

// ---- what the list shows ---------------------------------------------------------------------------------------------------------------

export function visibleMail(s: Pick<State, 'mail' | 'view' | 'unreadOnly' | 'accountFilter'>, nowMs: number): Mail[] {
  return s.mail.filter((m) => {
    if (m.folder !== 'inbox') return false;
    if (m.snoozedUntil && new Date(m.snoozedUntil).getTime() > nowMs) return false;
    if (s.accountFilter && m.account !== s.accountFilter) return false;
    if (s.unreadOnly && m.isRead) return false;
    return s.view === 'all' || m.kind === s.view;
  });
}

const isSnoozed = (m: Mail, nowMs: number) => !!m.snoozedUntil && new Date(m.snoozedUntil).getTime() > nowMs;

/** The inbox messages of the chosen mailbox as rows: one per conversation, or one per message when conversations are off. Newest first. */
function inboxThreads(s: Pick<State, 'mail' | 'accountFilter' | 'settings'>): Thread[] {
  const inbox = s.mail.filter((m) => m.folder === 'inbox' && (!s.accountFilter || m.account === s.accountFilter));
  return s.settings.threads ? groupThreads(inbox) : singles(inbox);
}

/**
 * What the list shows, a row at a time. A conversation is one row, placed by its newest message and in that message's tab, and it is hidden
 * while that message is snoozed (a new answer brings it back). Unread means anything unread in it.
 */
export function visibleThreads(s: Pick<State, 'mail' | 'view' | 'unreadOnly' | 'accountFilter' | 'settings'>, nowMs: number): Thread[] {
  return inboxThreads(s).filter((t) => {
    if (isSnoozed(t.latest, nowMs)) return false;
    if (s.unreadOnly && !t.unread) return false;
    return s.view === 'all' || t.kind === s.view;
  });
}

export interface Counts {
  /** Rows in the inbox that are not snoozed (for the chosen mailbox): conversations, or messages when conversations are off. */
  total: number;
  /** Rows with something unread in them. */
  unread: number;
  /** The same per tab, so each tab can show what is waiting in it. */
  byKind: Record<Kind, { total: number; unread: number }>;
  /** Messages whose header marks have not been read yet: their tab is still a first guess. */
  unsorted: number;
}

/** Numbers for the tabs. They count the rows of the list, and what is really there, never a hidden remainder. */
export function mailCounts(s: Pick<State, 'mail' | 'accountFilter' | 'settings'>, nowMs: number): Counts {
  const byKind = Object.fromEntries(KINDS.map((k) => [k, { total: 0, unread: 0 }])) as Counts['byKind'];
  let total = 0, unread = 0, unsorted = 0;
  for (const t of visibleThreads({ mail: s.mail, view: 'all', unreadOnly: false, accountFilter: s.accountFilter, settings: s.settings }, nowMs)) {
    const k = byKind[t.kind] ?? byKind.person;
    total++; k.total++;
    if (t.unread) { unread++; k.unread++; }
    for (const m of t.items) if (m.sig === undefined) unsorted++;
  }
  return { total, unread, byKind, unsorted };
}

/**
 * The promotions a Clean up would archive, a row at a time: the rows of the Promotions tab whose newest message was received more than `days`
 * days ago (0: all of them). A row with a message you flagged in it is never in it, and a conversation that is not in Promotions is left alone
 * whatever else is in it.
 */
export function cleanUpThreads(s: Pick<State, 'mail' | 'accountFilter' | 'settings'>, nowMs: number, days: number): Thread[] {
  const cutoff = nowMs - days * 86_400_000;
  return visibleThreads({ mail: s.mail, view: 'promo', unreadOnly: false, accountFilter: s.accountFilter, settings: s.settings }, nowMs)
    .filter((t) => !t.items.some((m) => m.flagged) && (days <= 0 || new Date(t.latest.received).getTime() < cutoff));
}

/** The messages of those rows: what archiving them acts on. */
export const cleanUpList = (s: Pick<State, 'mail' | 'accountFilter' | 'settings'>, nowMs: number, days: number): Mail[] => cleanUpThreads(s, nowMs, days).flatMap((t) => t.items);

/** What is snoozed, a row at a time, the one that comes back first on top. */
export const snoozedThreads = (s: Pick<State, 'mail' | 'settings'>, nowMs: number): Thread[] =>
  inboxThreads({ mail: s.mail, accountFilter: null, settings: s.settings }).filter((t) => isSnoozed(t.latest, nowMs)).sort((a, b) => String(a.latest.snoozedUntil).localeCompare(String(b.latest.snoozedUntil)));
/** What you flagged to answer later (any message of a conversation flagged is enough), a row at a time. Snoozed ones wait for their time. */
export const replyLaterThreads = (s: Pick<State, 'mail' | 'settings'>, nowMs: number): Thread[] =>
  inboxThreads({ mail: s.mail, accountFilter: null, settings: s.settings }).filter((t) => t.items.some((m) => m.flagged) && !isSnoozed(t.latest, nowMs));
