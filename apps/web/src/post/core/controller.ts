import { createGraph, GraphError, type Graph, type RawMessage } from './graph.ts';
import { UNDO_WINDOW_MS, createQueue, type OpType } from './queue.ts';
import { createServer, createTokens, ServerError, type AccountStatus, type DeviceApi, type Server, type SignedIn } from './server.ts';
import { DEFAULT_SETTINGS, loadSettings, type Settings } from './settings.ts';
import { reclassifyAll, syncAccount, toMail } from './sync.ts';
import { search as searchLocal } from './search.ts';
import type { PendingOp, Store } from './store.ts';
import type { Kind, Mail, MailBody } from './types.ts';

// The brain of the app, with no browser or React in it so it is tested in Node. The screens only read `state` and call these methods.
// Rule everywhere: the screen changes first, the network follows, and nothing the user did is ever lost or silently undone.

export type Filter = 'all' | 'unread' | 'people' | 'newsletter' | 'receipt';
export interface Toast { id: number; text: string; undo?: () => void }
export interface OutboxItem { id: string; account: string; sendAt: number; kind: 'new' | 'reply' | 'replyAll' | 'forward'; to: string[]; cc: string[]; subject: string; body: string; replyTo?: string }
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
  overrides: Record<string, Kind>;
  filter: Filter;
  accountFilter: string | null;
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
  /** Clears the icon number on this phone and tells the server it was seen. */
  seen?: (device: DeviceApi | null) => Promise<void>;
  pushState?: () => Promise<boolean>;
  setTimer?: (fn: () => void, ms: number) => unknown;
  sleep?: (ms: number) => Promise<void>;
}

const NEEDS_SIGN_IN = /AADSTS(70000|700082|700084|50173|50076|50079|65001|70008|500011)|invalid_grant|interaction_required|unknown account|signed out/i;
type Session = { email: string; id: string; label: string; session: string };
const PENDING_MS = 15 * 60_000;

export function createController(deps: Deps) {
  const now = deps.now ?? (() => Date.now());
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const { store, kv } = deps;
  const queue = createQueue(store, { now });

  let state: State = {
    ready: false, serverReady: !!deps.serverUrl, signingIn: false, accounts: [], mail: [], settings: DEFAULT_SETTINGS, overrides: {}, filter: 'all', accountFilter: null,
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

  const graphFor = (email: string): Graph | null => {
    if (!tokens || !state.accounts.find((a) => a.email === email && !a.needsSignIn)) return null;
    let g = graphs.get(email);
    if (!g) { g = createGraph({ fetch: (...a) => deps.fetch(...a), token: tokens.source(email), sleep: deps.sleep }); graphs.set(email, g); }
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

  const api = {
    getState: () => state,
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },

    async init() {
      const overrides = (await store.getMeta<Record<string, Kind>>('overrides')) ?? {};
      try { const x = JSON.parse(kv.get('post.sessions') ?? '[]'); sessions = Array.isArray(x) ? x.filter((y: Session) => y && typeof y.email === 'string' && typeof y.session === 'string') : []; } catch { sessions = []; }
      const known = ((await store.getMeta<AppAccount[]>('accounts')) ?? []).filter((a) => sessions.some((x) => x.email === a.email));
      let settings = DEFAULT_SETTINGS;
      try { settings = loadSettings(JSON.parse(kv.get('post.settings') ?? 'null')); } catch { /* defaults */ }
      set({ settings, accounts: known, overrides, signingIn: !!readPending() });
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
      let error: string | null = null;
      try {
        await refreshAccounts();
        for (const a of state.accounts) {
          const g = graphFor(a.email);
          if (!g) continue;
          try {
            await syncAccount({ graph: g, store, account: a.email, overrides: state.overrides, now: () => new Date(now()) });
            await reload();
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
      }
    },

    // ---- accounts ---------------------------------------------------------------------------------------------------------
    async removeAccount(email: string) {
      const x = sessions.find((y) => y.email === email);
      if (!server || !x) return;
      try { await server.unregister(x.session); } catch (e) { if (!(e instanceof ServerError && e.status === 401)) throw e; }
      sessions = sessions.filter((y) => y.email !== email);
      saveSessions();
      await store.clearAccount(email);
      graphs.delete(email); tokens?.forget(email);
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

    /** "This sender is a newsletter / a person". Re-sorts everything from that sender at once, and is the fix for every wrong guess. */
    async moveSender(address: string, kind: Kind | null) {
      const overrides = { ...state.overrides };
      if (kind) overrides[address.toLowerCase()] = kind; else delete overrides[address.toLowerCase()];
      await store.setMeta('overrides', overrides);
      set({ overrides });
      await reclassifyAll(store, overrides);
      await reload();
      toast(kind ? 'Moved. All mail from this sender is sorted the same way.' : 'Back to automatic sorting');
    },

    // ---- reading -------------------------------------------------------------------------------------------------------------
    async openBody(m: Mail): Promise<MailBody & { headers?: { name: string; value: string }[] }> {
      const cached = await store.getBody(m.key);
      if (cached) return cached;
      const g = graphFor(m.account);
      if (!g) throw new Error('Sign in again to read this message');
      const j = await g.getBody(m.id);
      const addr = (r: any) => ({ name: String(r?.emailAddress?.name ?? ''), address: String(r?.emailAddress?.address ?? '') });
      let attachments: MailBody['attachments'] = [];
      if (j?.hasAttachments) { try { attachments = await g.attachments(m.id); } catch { /* the text is more important than the file list */ } }
      const body: MailBody = {
        key: m.key, contentType: String(j?.body?.contentType).toLowerCase() === 'html' ? 'html' : 'text', content: String(j?.body?.content ?? ''),
        to: (j?.toRecipients ?? []).map(addr), cc: (j?.ccRecipients ?? []).map(addr), attachments,
      };
      await store.putBody(body);
      return body;
    },

    async headersOf(m: Mail) { const g = graphFor(m.account); return g ? await g.getHeaders(m.id) : []; },
    async attachment(m: Mail, attachmentId: string) { const g = graphFor(m.account); if (!g) throw new Error('Sign in again'); return await g.attachmentBlob(m.id, attachmentId); },

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
          for (const r of rows) { const m = toMail(a.email, r, state.overrides); if (!seen.has(m.key)) out.push({ ...m, folder: 'archive' }); }
        } catch { /* one account failing must not hide the others' results */ }
      }
      return out.sort((x, y) => y.received.localeCompare(x.received));
    },

    // ---- writing ----------------------------------------------------------------------------------------------------------------
    saveDraft(d: Draft | null) { if (d) kv.set('post.draft', JSON.stringify(d)); else kv.del('post.draft'); },
    loadDraft(): Draft | null { try { return JSON.parse(kv.get('post.draft') ?? 'null'); } catch { return null; } },

    /** Puts a message in the outbox. It leaves after the undo-send delay, even if the app is closed and reopened meanwhile. */
    async send(item: Omit<OutboxItem, 'id' | 'sendAt'>) {
      const delay = state.settings.undoSend * 1000;
      const it: OutboxItem = { ...item, id: `o${now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, sendAt: now() + delay };
      const list = [...(((await store.getMeta<OutboxItem[]>('outbox')) ?? [])), it];
      await store.setMeta('outbox', list);
      api.saveDraft(null);
      await reload();
      toast(delay ? 'Sending…' : 'Sent', delay ? () => { void api.cancelSend(it.id); } : undefined, delay || undefined);
      setTimer(() => { void api.flushOutbox().then(reload); }, delay + 100);
    },
    async cancelSend(id: string) {
      const list = ((await store.getMeta<OutboxItem[]>('outbox')) ?? []);
      const it = list.find((x) => x.id === id);
      if (!it) { toast('Too late: it was already sent'); return; }
      await store.setMeta('outbox', list.filter((x) => x.id !== id));
      api.saveDraft({ account: it.account, to: it.to.join(', '), cc: it.cc.join(', '), subject: it.subject, body: it.body, replyTo: it.replyTo, mode: it.kind });
      await reload();
      toast('Not sent. Your message is back in the editor.');
    },
    async flushOutbox() {
      const list = ((await store.getMeta<OutboxItem[]>('outbox')) ?? []);
      const keep: OutboxItem[] = [];
      let sent = 0;
      for (const it of list) {
        if (it.sendAt > now()) { keep.push(it); continue; }
        const g = graphFor(it.account);
        if (!g) { keep.push(it); continue; }
        try {
          if (it.kind === 'new') await g.sendMail({ subject: it.subject, body: it.body, to: it.to, cc: it.cc });
          else if (it.kind === 'forward' && it.replyTo) await g.forward(it.replyTo, it.to, it.body);
          else if (it.replyTo) await g.reply(it.replyTo, it.body, it.kind === 'replyAll');
          sent++;
        } catch (e) {
          // Rejected for good (bad address etc.): hand it back as a draft instead of retrying forever or losing it.
          if (e instanceof GraphError && e.status >= 400 && e.status < 500 && e.status !== 401 && e.status !== 429) {
            api.saveDraft({ account: it.account, to: it.to.join(', '), cc: it.cc.join(', '), subject: it.subject, body: it.body, replyTo: it.replyTo, mode: it.kind });
            toast(`Could not send: ${e.message}. Your message is saved as a draft.`);
          } else keep.push(it);
        }
      }
      await store.setMeta('outbox', keep);
      if (sent && !keep.length) toast(sent === 1 ? 'Sent' : `Sent ${sent}`);
    },

    async unsubscribe(m: Mail, mailto: { to: string; subject: string; body: string }) {
      const g = graphFor(m.account);
      if (!g) throw new Error('Sign in again');
      await g.sendMail({ subject: mailto.subject, body: mailto.body, to: [mailto.to] });
      toast('Unsubscribe request sent');
    },

    // ---- view ----------------------------------------------------------------------------------------------------------------------------
    setFilter(filter: Filter) { set({ filter }); },
    setAccountFilter(accountFilter: string | null) { set({ accountFilter }); },
    setSettings(patch: Partial<Settings>) { saveSettings({ ...state.settings, ...patch }); },
    toast,
    device,
  };
  return api;
}

export type Controller = ReturnType<typeof createController>;

// ---- what the list shows ---------------------------------------------------------------------------------------------------------------

export function visibleMail(s: Pick<State, 'mail' | 'filter' | 'accountFilter'>, nowMs: number): Mail[] {
  return s.mail.filter((m) => {
    if (m.folder !== 'inbox') return false;
    if (m.snoozedUntil && new Date(m.snoozedUntil).getTime() > nowMs) return false;
    if (s.accountFilter && m.account !== s.accountFilter) return false;
    if (s.filter === 'unread') return !m.isRead;
    if (s.filter === 'people') return m.kind === 'person';
    if (s.filter === 'newsletter') return m.kind === 'newsletter';
    if (s.filter === 'receipt') return m.kind === 'receipt';
    return true;
  });
}

/** Counts shown on the pills. They count what is really there, never a hidden remainder. */
export function filterCounts(s: Pick<State, 'mail' | 'accountFilter'>, nowMs: number) {
  const base = visibleMail({ mail: s.mail, filter: 'all', accountFilter: s.accountFilter }, nowMs);
  return { all: base.length, unread: base.filter((m) => !m.isRead).length, people: base.filter((m) => m.kind === 'person' && !m.isRead).length, newsletter: base.filter((m) => m.kind === 'newsletter' && !m.isRead).length, receipt: base.filter((m) => m.kind === 'receipt' && !m.isRead).length };
}

export const snoozedMail = (mail: Mail[], nowMs: number) => mail.filter((m) => m.snoozedUntil && new Date(m.snoozedUntil).getTime() > nowMs).sort((a, b) => String(a.snoozedUntil).localeCompare(String(b.snoozedUntil)));
export const replyLaterMail = (mail: Mail[], nowMs: number) => mail.filter((m) => m.flagged && m.folder === 'inbox' && !(m.snoozedUntil && new Date(m.snoozedUntil).getTime() > nowMs));
