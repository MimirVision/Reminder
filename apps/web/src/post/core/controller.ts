import { isFreemail, orgDomain, type ClassifyContext } from './classify.ts';
import { createByteCache, emlName, mimeOf, saveName } from './files.ts';
import { createGraph, GraphError, type Graph, type OutFile, type RawMessage } from './graph.ts';
import { UNDO_WINDOW_MS, createQueue, type OpType } from './queue.ts';
import { createServer, createTokens, ServerError, type AccountStatus, type DeviceApi, type Server, type SignedIn } from './server.ts';
import { DEFAULT_SETTINGS, loadSettings, type Settings } from './settings.ts';
import { enrichHeaders, loadKnown, reclassifyAll, refreshKnown, rememberKnown, syncAccount, toMail } from './sync.ts';
import { search as searchLocal } from './search.ts';
import type { PendingOp, Store } from './store.ts';
import { asKind, KIND_TAB, KINDS, type AttachmentRef, type Kind, type Mail, type MailBody } from './types.ts';

// The brain of the app, with no browser or React in it so it is tested in Node. The screens only read `state` and call these methods.
// Rule everywhere: the screen changes first, the network follows, and nothing the user did is ever lost or silently undone.

/** Which tab of the inbox is open: one of the four kinds (Primary is 'person'), or everything. */
export type View = 'all' | Kind;
export interface Toast { id: number; text: string; undo?: () => void }
/** A file waiting to be sent: what the outbox list knows about it. The file itself is kept apart, under the account's own name, so removing the account removes it. */
export interface OutFileRef { name: string; type: string; size: number }
export interface OutboxItem { id: string; account: string; sendAt: number; kind: 'new' | 'reply' | 'replyAll' | 'forward'; to: string[]; cc: string[]; subject: string; body: string; replyTo?: string; files?: OutFileRef[]; /** failed tries so far (only counted for messages with files) */ attempts?: number }
export interface Draft { account: string; to: string; cc: string; subject: string; body: string; replyTo?: string; mode: OutboxItem['kind'] }

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
const outFileKey = (account: string, itemId: string, i: number) => `${account}|outfile|${itemId}|${i}`;
const SENDING_TOAST_MS = 180_000;

const NEEDS_SIGN_IN = /AADSTS(70000|700082|700084|50173|50076|50079|65001|70008|500011)|invalid_grant|interaction_required|unknown account|signed out/i;
type Session = { email: string; id: string; label: string; session: string };
const PENDING_MS = 15 * 60_000;

export function createController(deps: Deps) {
  const now = deps.now ?? (() => Date.now());
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const { store, kv } = deps;
  const queue = createQueue(store, { now });

  let state: State = {
    ready: false, serverReady: !!deps.serverUrl, signingIn: false, accounts: [], mail: [], settings: DEFAULT_SETTINGS, overrides: {}, view: 'person', unreadOnly: false, accountFilter: null, sorting: false,
    sync: { running: false, at: null, error: null }, online: true, waiting: 0, outbox: [], toast: null, alertsOn: false,
  };
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  const set = (patch: Partial<State>) => { state = { ...state, ...patch }; emit(); };

  const server: Server | null = deps.serverUrl ? createServer(deps.serverUrl, (...a) => deps.fetch(...a)) : null;
  let sessions: Session[] = [];
  const sessionOf = (email: string) => sessions.find((x) => x.email === email)?.session;
  const tokens = server ? createTokens(server, sessionOf, now) : null;
  const saveSessions = () => kv.set('post.sessions', JSON.stringify(sessions));
  const graphs = new Map<string, Graph>();
  let toastSeq = 0;
  const trash = new Map<string, Mail>(); // copies kept for Undo
  let known: ReadonlySet<string> = new Set(); // addresses any signed-in mailbox has written to
  let sortingRun: Promise<void> | null = null;
  let syncRun: Promise<void> | null = null;
  const downloads = createByteCache<Opened>(48 * 1024 * 1024); // files already fetched for reading, so opening one again is instant
  const fetching = new Map<string, Promise<Opened>>();

  /** Everything the sorting knows besides the message itself: what you moved by hand, who you have written to, your VIPs. */
  const sortCtx = (): ClassifyContext => ({ overrides: state.overrides, known, vips: new Set(state.accounts.flatMap((a) => a.vips ?? []).map((v) => v.toLowerCase())) });

  const graphFor = (email: string): Graph | null => {
    if (!tokens || !state.accounts.find((a) => a.email === email && !a.needsSignIn)) return null;
    let g = graphs.get(email);
    if (!g) {
      g = createGraph({
        fetch: (...a) => deps.fetch(...a), token: tokens.source(email), sleep: deps.sleep,
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
    const [mail, ops, outbox] = await Promise.all([store.allMail(), queue.pending(), store.getMeta<OutboxItem[]>('outbox')]);
    mail.sort((a, b) => b.received.localeCompare(a.received));
    // "Waiting" means held up, not just inside the undo window: only actions that are already due and still not confirmed count.
    const waiting = ops.filter((o) => o.runAfter <= now()).length + (outbox ?? []).filter((o) => o.sendAt <= now()).length;
    set({ mail, waiting, outbox: outbox ?? [] });
  }

  function saveSettings(s: Settings) { kv.set('post.settings', JSON.stringify(s)); set({ settings: s }); }

  /** Saves what you moved by hand and re-sorts everything at once. */
  async function applyOverrides(overrides: Record<string, Kind>) {
    await store.setMeta('overrides', overrides);
    set({ overrides });
    await reclassifyAll(store, sortCtx());
    await reload();
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

  /** Asks the server about each signed-in mailbox. A mailbox the server no longer recognises is marked "sign in again", never dropped. */
  async function refreshAccounts(): Promise<void> {
    if (!server) return;
    const prev = new Map(state.accounts.map((a) => [a.email, a]));
    const out: AppAccount[] = [];
    let offline = false;
    for (const x of sessions) {
      const old = prev.get(x.email);
      try {
        const r = await server.status(x.session);
        const a = r.accounts.find((y) => y.email === x.email) ?? r.accounts[0];
        out.push({ ...(a as AccountStatus), needsSignIn: old?.needsSignIn && !a ? true : false });
      } catch (e) {
        if (e instanceof ServerError && e.status === 0) offline = true;
        const signedOut = e instanceof ServerError && e.status === 401;
        out.push({ ...(old ?? { id: x.id, email: x.email, label: x.label, mode: 'people', quiet: null, vips: [], subscription_expires_at: null, last_alert_at: null }), needsSignIn: signedOut || (old?.needsSignIn ?? false) });
      }
    }
    await store.setMeta('accounts', out);
    set({ accounts: out, ...(offline ? { online: false } : { online: true }) });
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

  // ---- files waiting to be sent ---------------------------------------------------------------------------------------------------------
  let flushing: Promise<void> | null = null;
  let flushAgain = false;

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

  /** The message goes back to the editor, with its files, and the person is told why. */
  async function handBack(it: OutboxItem, files: OutFile[], why: string) {
    api.saveDraft({ account: it.account, to: it.to.join(', '), cc: it.cc.join(', '), subject: it.subject, body: it.body, replyTo: it.replyTo, mode: it.kind });
    if (files.length) await api.saveDraftFiles(files);
    await dropOutFiles(it);
    toast(`Could not send: ${why}. Your message${files.length ? ' and its files are' : ' is'} saved as a draft.`, undefined, files.length ? 8000 : undefined);
  }

  async function flushOutboxOnce() {
    const list = ((await store.getMeta<OutboxItem[]>('outbox')) ?? []);
    const finished = new Set<string>();             // sent, or handed back to the editor
    const retried = new Map<string, OutboxItem>();  // failed, will be tried again
    let sent = 0;
    let learned = false;
    let sendingToast = 0;
    for (const it of list) {
      if (it.sendAt > now()) continue;
      const g = graphFor(it.account);
      if (!g) continue;
      let files: OutFile[] = [];
      try {
        const loaded = await loadOutFiles(it);
        files = loaded.files;
        if (loaded.lost.length) { await handBack(it, files, `${loaded.lost.join(', ')} ${loaded.lost.length > 1 ? 'are' : 'is'} no longer stored on this phone`); finished.add(it.id); continue; }
        if (files.length) { toast(files.length === 1 ? 'Sending your file… keep Post open until it says Sent' : `Sending ${files.length} files… keep Post open until it says Sent`, undefined, SENDING_TOAST_MS); sendingToast = toastSeq; }
        if (it.kind === 'new') await g.sendMail({ subject: it.subject, body: it.body, to: it.to, cc: it.cc, files });
        else if (it.kind === 'forward' && it.replyTo) await g.forward(it.replyTo, it.to, it.body, files);
        else if (it.replyTo) await g.reply(it.replyTo, it.body, it.kind === 'replyAll', files);
        sent++;
        finished.add(it.id);
        await dropOutFiles(it);
        if (await rememberKnown(store, it.account, [...it.to, ...it.cc])) learned = true;
      } catch (e) {
        // Rejected for good (bad address, too big etc.): hand it back as a draft instead of retrying forever or losing it.
        const refused = e instanceof GraphError && e.status >= 400 && e.status < 500 && e.status !== 401 && e.status !== 429;
        // A message with files is not tried for ever either: a big upload that keeps failing while the connection is fine is handed back.
        const tries = (it.attempts ?? 0) + (e instanceof GraphError && e.status === 0 && !state.online ? 0 : 1);
        if (refused || (it.files?.length && tries >= MAX_TRIES)) { await handBack(it, files, e instanceof Error ? e.message : 'Outlook said no'); finished.add(it.id); }
        else if (it.files?.length) retried.set(it.id, { ...it, attempts: tries });
      }
    }
    // Read the list again: a message put in (or taken back with Undo) while this ran must stay as it is now.
    const fresh = ((await store.getMeta<OutboxItem[]>('outbox')) ?? []);
    const remaining = fresh.filter((x) => !finished.has(x.id)).map((x) => retried.get(x.id) ?? x);
    if (finished.size || retried.size) await store.setMeta('outbox', remaining);
    if (learned) { known = await loadKnown(store, state.accounts.map((a) => a.email)); await reclassifyAll(store, sortCtx()); }
    if (sent && !remaining.length) toast(sent === 1 ? 'Sent' : `Sent ${sent}`);
    else if (retried.size) toast('Not sent yet. Post will try again.', undefined, 6000);
    else if (sendingToast && state.toast?.id === sendingToast) set({ toast: null });
  }

  const api = {
    getState: () => state,
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },

    async init() {
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
      known = await loadKnown(store, cachedAccounts.map((a) => a.email));
      await reclassifyAll(store, sortCtx()); // every start: a better rule applies to mail already on the phone, and older saved kinds are renamed
      await reload();
      set({ ready: true });
      await api.opened();
    },

    /** Called when the app opens or comes back to the front: this is "I have looked". */
    async opened() {
      await api.collectSignIn();
      if (!sessions.length) return;
      try { await deps.seen?.(device()); } catch { /* the number is a nicety; never block reading on it */ }
      try { set({ alertsOn: (await deps.pushState?.()) ?? false }); } catch { /* ignore */ }
      await api.sync();
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
      sessions = [];
      graphs.clear();
      set({ accounts: [], mail: [], settings: DEFAULT_SETTINGS, signingIn: false });
    },

    // ---- sync -----------------------------------------------------------------------------------------------------------
    async sync() {
      if (state.sync.running || !server) return;
      set({ sync: { ...state.sync, running: true } });
      let done!: () => void;
      syncRun = new Promise<void>((r) => { done = r; });
      let error: string | null = null;
      try {
        await refreshAccounts();
        for (const a of state.accounts) {
          const g = graphFor(a.email);
          if (!g) continue;
          try {
            await syncAccount({ graph: g, store, account: a.email, ctx: sortCtx(), now: () => new Date(now()) });
            await reload();
            await learnKnown(a.email, g);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            if (e instanceof ServerError && NEEDS_SIGN_IN.test(msg)) {
              set({ accounts: state.accounts.map((x) => (x.email === a.email ? { ...x, needsSignIn: true } : x)) });
            } else if (e instanceof ServerError && e.status === 0 || e instanceof GraphError && e.status === 0) {
              set({ online: false }); error = 'No connection. Showing what is on this phone.';
            } else error = `${a.label}: ${msg}`;
          }
        }
        const g = (email: string) => graphFor(email);
        await queue.flush(g);
        await api.flushOutbox();
        await reload();
        if (!error) set({ online: true });
      } finally {
        set({ sync: { running: false, at: now(), error } });
        syncRun = null; done();
      }
      void api.sortInBackground();
    },

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
      set({ accounts: state.accounts.filter((a) => a.email !== email) });
      await Promise.allSettled([syncRun, sortingRun]);
      await store.clearAccount(email);
      const waiting = ((await store.getMeta<OutboxItem[]>('outbox')) ?? []);
      if (waiting.some((x) => x.account === email)) await store.setMeta('outbox', waiting.filter((x) => x.account !== email)); // their files went with clearAccount
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

    // ---- triage -------------------------------------------------------------------------------------------------------------
    async archive(items: Mail[]) { return await api.moveAway(items, 'archive', 'Archived'); },
    async trash(items: Mail[]) { return await api.moveAway(items, 'delete', 'Deleted'); },

    async moveAway(items: Mail[], type: Extract<OpType, 'archive' | 'delete'>, word: string) {
      if (!items.length) return;
      const ops: PendingOp[] = [];
      for (const m of items) { trash.set(m.key, m); ops.push(await queue.enqueue(type, m.account, m.id)); }
      await store.deleteMail(items.map((m) => m.key));
      await reload();
      const label = items.length === 1 ? word : `${word} ${items.length}`;
      toast(label, () => { void api.undo(ops.map((o) => o.id), items); });
      setTimer(() => { void queue.flush(graphFor).then(reload); }, UNDO_WINDOW_MS + 200);
    },

    async undo(opIds: string[], items: Mail[]) {
      let late = 0;
      for (let i = 0; i < opIds.length; i++) {
        if (await queue.cancel(opIds[i])) await store.putMail([items[i]]);
        else late++;
      }
      await reload();
      toast(late ? 'Too late: it already went through' : 'Undone');
    },

    async setRead(m: Mail, isRead: boolean) {
      if (m.isRead === isRead) return;
      await store.putMail([{ ...m, isRead }]);
      await queue.enqueue(isRead ? 'read' : 'unread', m.account, m.id, 0);
      await reload();
      void queue.flush(graphFor).then(reload);
    },

    async setFlag(m: Mail, flagged: boolean) {
      await store.putMail([{ ...m, flagged }]);
      await queue.enqueue(flagged ? 'flag' : 'unflag', m.account, m.id, 0);
      await reload();
      void queue.flush(graphFor).then(reload);
    },

    async snooze(m: Mail, until: Date, label: string) {
      await store.putMail([{ ...m, snoozedUntil: until.toISOString() }]);
      await reload();
      toast(`Snoozed until ${label}`, () => { void api.unsnooze(m); });
    },
    async unsnooze(m: Mail) {
      const cur = await store.getMail(m.key);
      if (cur) await store.putMail([{ ...cur, snoozedUntil: null }]);
      await reload();
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

    /** Marks these as read in one go, with one toast. */
    async markRead(items: Mail[]) {
      const todo = items.filter((m) => !m.isRead);
      if (!todo.length) return;
      await store.putMail(todo.map((m) => ({ ...m, isRead: true })));
      for (const m of todo) await queue.enqueue('read', m.account, m.id, 0);
      await reload();
      toast(todo.length === 1 ? 'Marked as read' : `Marked ${todo.length} as read`);
      void queue.flush(graphFor).then(reload);
    },

    /** Archives the Promotions older than `days` days (never a flagged one), with one Undo. Returns how many. */
    async cleanUp(days: number, nowMs: number = now()) {
      const items = cleanUpList(state, nowMs, days);
      if (items.length) await api.archive(items);
      return items.length;
    },

    // ---- reading -------------------------------------------------------------------------------------------------------------
    /**
     * The message text, who it went to and what is attached. The list of attachments is always asked for, side by side with the text, because
     * Outlook's "has attachments" leaves out files that Apple Mail marks as part of the text. When the list cannot be read the text still
     * shows, and the list is asked for again the next time the message is opened, so a file is never silently missing.
     */
    async openBody(m: Mail): Promise<MailBody> {
      let body = await store.getBody(m.key);
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
      await store.putBody(body);
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
    /** Asks Outlook itself, for mail older than what is stored on the phone. */
    async searchRemote(q: string): Promise<Mail[]> {
      const out: Mail[] = [];
      const seen = new Set(state.mail.map((m) => m.key));
      for (const a of state.accounts) {
        const g = graphFor(a.email);
        if (!g) continue;
        try {
          const rows: RawMessage[] = await g.search(q.replace(/\b(from|is|has|in|account):\S*/gi, '').trim() || q);
          for (const r of rows) { const m = toMail(a.email, r, sortCtx()); if (!seen.has(m.key)) out.push({ ...m, folder: 'archive' }); }
        } catch { /* one account failing must not hide the others' results */ }
      }
      return out.sort((x, y) => y.received.localeCompare(x.received));
    },

    // ---- writing ----------------------------------------------------------------------------------------------------------------
    saveDraft(d: Draft | null) { if (d) kv.set('post.draft', JSON.stringify(d)); else { kv.del('post.draft'); void store.setMeta(DRAFT_FILES, undefined).catch(() => {}); } },
    loadDraft(): Draft | null { try { return JSON.parse(kv.get('post.draft') ?? 'null'); } catch { return null; } },

    /** The files attached to the draft being written. They live next to the text, so closing the app loses neither. */
    async loadDraftFiles(): Promise<OutFile[]> {
      try {
        const v = await store.getMeta<OutFile[]>(DRAFT_FILES);
        return Array.isArray(v) ? v.filter((f) => f && typeof f.name === 'string' && f.bytes instanceof Uint8Array) : [];
      } catch { return []; }
    },
    /** Returns false when the phone would not keep them (storage full): the files then stay on screen but would be lost if the app closes. */
    async saveDraftFiles(files: OutFile[]): Promise<boolean> {
      try { await store.setMeta(DRAFT_FILES, files.length ? files : undefined); return true; } catch { return false; }
    },

    /**
     * Puts a message in the outbox. It leaves after the undo-send delay, even if the app is closed and reopened meanwhile. Its files are kept
     * on the phone until it has left. Returns false (and sends nothing) when the files could not be kept.
     */
    async send(item: Omit<OutboxItem, 'id' | 'sendAt' | 'files' | 'attempts'>, files: OutFile[] = []): Promise<boolean> {
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
      const list = [...(((await store.getMeta<OutboxItem[]>('outbox')) ?? [])), it];
      await store.setMeta('outbox', list);
      api.saveDraft(null);
      await reload();
      toast(delay ? 'Sending…' : 'Sent', delay ? () => { void api.cancelSend(it.id); } : undefined, delay || undefined);
      setTimer(() => { void api.flushOutbox().then(reload); }, delay + 100);
      return true;
    },
    async cancelSend(id: string) {
      const list = ((await store.getMeta<OutboxItem[]>('outbox')) ?? []);
      const it = list.find((x) => x.id === id);
      if (!it || it.sendAt <= now()) { toast(it ? 'Too late: it is already on its way' : 'Too late: it was already sent'); return; }
      const { files } = await loadOutFiles(it);
      await store.setMeta('outbox', list.filter((x) => x.id !== id));
      api.saveDraft({ account: it.account, to: it.to.join(', '), cc: it.cc.join(', '), subject: it.subject, body: it.body, replyTo: it.replyTo, mode: it.kind });
      if (files.length) await api.saveDraftFiles(files);
      await dropOutFiles(it);
      await reload();
      toast(`Not sent. Your message${files.length ? ' and its files are' : ' is'} back in the editor.`);
    },

    /** Sends what is due. Only one run at a time: a big upload takes a while, and a second run must never send the same message again. */
    flushOutbox(): Promise<void> {
      if (flushing) { flushAgain = true; return flushing; }
      const p: Promise<void> = (async () => { do { flushAgain = false; await flushOutboxOnce(); } while (flushAgain); })().finally(() => { flushing = null; });
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

export interface Counts {
  /** Everything in the inbox that is not snoozed (for the chosen mailbox). */
  total: number;
  unread: number;
  /** The same per tab, so each tab can show what is waiting in it. */
  byKind: Record<Kind, { total: number; unread: number }>;
  /** Messages whose header marks have not been read yet: their tab is still a first guess. */
  unsorted: number;
}

/** Numbers for the tabs. They count what is really there, never a hidden remainder. */
export function mailCounts(s: Pick<State, 'mail' | 'accountFilter'>, nowMs: number): Counts {
  const byKind = Object.fromEntries(KINDS.map((k) => [k, { total: 0, unread: 0 }])) as Counts['byKind'];
  let total = 0, unread = 0, unsorted = 0;
  for (const m of visibleMail({ mail: s.mail, view: 'all', unreadOnly: false, accountFilter: s.accountFilter }, nowMs)) {
    const k = byKind[m.kind] ?? byKind.person;
    total++; k.total++;
    if (!m.isRead) { unread++; k.unread++; }
    if (m.sig === undefined) unsorted++;
  }
  return { total, unread, byKind, unsorted };
}

/** The promotions a Clean up would archive: those received more than `days` days ago (0: all of them). A message you flagged is never in it. */
export function cleanUpList(s: Pick<State, 'mail' | 'accountFilter'>, nowMs: number, days: number): Mail[] {
  const cutoff = nowMs - days * 86_400_000;
  return visibleMail({ mail: s.mail, view: 'promo', unreadOnly: false, accountFilter: s.accountFilter }, nowMs).filter((m) => !m.flagged && (days <= 0 || new Date(m.received).getTime() < cutoff));
}

export const snoozedMail = (mail: Mail[], nowMs: number) => mail.filter((m) => m.snoozedUntil && new Date(m.snoozedUntil).getTime() > nowMs).sort((a, b) => String(a.snoozedUntil).localeCompare(String(b.snoozedUntil)));
export const replyLaterMail = (mail: Mail[], nowMs: number) => mail.filter((m) => m.flagged && m.folder === 'inbox' && !(m.snoozedUntil && new Date(m.snoozedUntil).getTime() > nowMs));
