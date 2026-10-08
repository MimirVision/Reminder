import { classify, CLASSIFIER_VERSION, signalsFromHeaders, type ClassifyContext } from './classify.ts';
import { GraphError, type Graph, type RawMessage } from './graph.ts';
import type { Store } from './store.ts';
import { mailKey, type Mail } from './types.ts';

// Keeps the phone's copy of the inbox in step with Outlook using Graph "delta" queries: after the first sync only what changed is fetched.
// Never loses a local change: anything with an action still waiting to be sent is left alone until that action has gone through.
// Reading the hidden header marks that sharpen the sorting (enrichHeaders) is a separate, slower job that runs after the mail is on screen.

export interface SyncResult { added: number; changed: number; removed: number; resynced: boolean }

export const FIRST_SYNC_DAYS = 45;

/** What the sorting says about a saved message. It only looks at what is saved, so it can be redone at any time without asking Outlook. */
function verdict(m: Pick<Mail, 'fromAddress' | 'fromName' | 'subject' | 'preview' | 'sig'>, ctx: ClassifyContext) {
  return classify({ fromAddress: m.fromAddress, fromName: m.fromName, subject: m.subject, preview: m.preview, signals: m.sig }, ctx);
}

export function toMail(account: string, r: RawMessage, ctx: ClassifyContext, prev?: Mail): Mail {
  const inf: Mail['inf'] = r.inferenceClassification === 'focused' ? 'focused' : r.inferenceClassification === 'other' ? 'other' : undefined;
  const base = {
    key: mailKey(account, r.id), account, id: r.id,
    conversationId: r.conversationId ?? '', received: r.receivedDateTime ?? new Date(0).toISOString(),
    subject: r.subject ?? '', fromName: r.from?.emailAddress?.name ?? '', fromAddress: (r.from?.emailAddress?.address ?? '').toLowerCase(),
    preview: (r.bodyPreview ?? '').replace(/\s+/g, ' ').trim().slice(0, 200),
    isRead: !!r.isRead, flagged: r.flag?.flagStatus === 'flagged', hasAttachments: !!r.hasAttachments,
    folder: 'inbox' as const,
    // The header marks never change for a message, so an update from Outlook keeps the ones already read.
    ...(prev?.sig ? { sig: prev.sig } : {}),
    ...(inf ? { inf } : {}),
  };
  const c = verdict(base, ctx);
  return { ...base, kind: c.kind, why: c.why, snoozedUntil: prev?.snoozedUntil ?? null };
}

/** When the meaning of the saved header marks changes (CLASSIFIER_VERSION), forget them so every message is asked about again. */
export async function ensureClassifierVersion(store: Store, account: string): Promise<boolean> {
  const key = `${account}|classifier`;
  if ((await store.getMeta<number>(key)) === CLASSIFIER_VERSION) return false;
  const stale = (await store.allMail()).filter((m) => m.account === account && m.sig !== undefined);
  if (stale.length) await store.putMail(stale.map(({ sig: _forgotten, ...rest }) => rest as Mail));
  await store.setMeta(key, CLASSIFIER_VERSION);
  return stale.length > 0;
}

export async function syncAccount(p: { graph: Graph; store: Store; account: string; ctx?: ClassifyContext; now?: () => Date }): Promise<SyncResult> {
  const { graph, store, account } = p;
  const ctx = p.ctx ?? {};
  const now = p.now ?? (() => new Date());
  const deltaKey = `${account}|delta`;
  const result: SyncResult = { added: 0, changed: 0, removed: 0, resynced: false };

  await ensureClassifierVersion(store, account);
  const pending = new Set((await store.allOps()).filter((o) => o.account === account).map((o) => mailKey(o.account, o.messageId)));

  async function run(startLink: string | undefined): Promise<void> {
    const full = !startLink; // a first sync or a start-over: everything in the window comes back
    const sinceMs = now().getTime() - FIRST_SYNC_DAYS * 86_400_000;
    const since = new Date(sinceMs).toISOString();
    // One read of what is stored, instead of one per message: a first sync can be a thousand messages.
    const stored = new Map((await store.allMail()).filter((m) => m.account === account).map((m) => [m.key, m]));
    const seenKeys = new Set<string>();
    const batchIn = async (raws: RawMessage[]) => {
      const removed: string[] = [];
      const upserts: Mail[] = [];
      for (const r of raws) {
        const key = mailKey(account, r.id);
        seenKeys.add(key);
        if (pending.has(key)) continue;
        if (r['@removed']) { removed.push(key); stored.delete(key); continue; }
        // The header marks may have been read since the snapshot above (that job runs alongside), so ask again for the ones we already have.
        const prev = stored.has(key) ? (await store.getMail(key)) ?? stored.get(key) : undefined;
        const next = toMail(account, r, ctx, prev);
        if (prev) result.changed++; else result.added++;
        stored.set(key, next);
        upserts.push(next);
      }
      result.removed += removed.length;
      await store.putMail(upserts);
      await store.deleteMail(removed);
    };

    let link = startLink;
    let deltaLink: string | undefined;
    const held: RawMessage[] = [];
    for (let pages = 0; pages < 400; pages++) {
      const page = await graph.deltaPage('inbox', link, link ? undefined : since);
      // A first sync shows mail page by page (and a dropped connection just starts that sync again). A later sync is written only
      // once every page has arrived, so a drop halfway leaves the old, consistent copy in place.
      if (full) await batchIn(page.value); else held.push(...page.value);
      if (page.next) { link = page.next; continue; }
      deltaLink = page.delta;
      break;
    }
    if (!full) await batchIn(held);
    if (full && deltaLink) {
      // Anything still stored from the window that Outlook no longer lists was moved or deleted elsewhere while we were not looking.
      const gone = [...stored.values()].filter((m) => !seenKeys.has(m.key) && !pending.has(m.key) && new Date(m.received).getTime() >= sinceMs).map((m) => m.key);
      if (gone.length) { await store.deleteMail(gone); result.removed += gone.length; }
    }
    if (deltaLink) await store.setMeta(deltaKey, deltaLink);
  }

  const saved = await store.getMeta<string>(deltaKey);
  try {
    await run(saved);
  } catch (e) {
    // 410 Gone: Microsoft no longer remembers our place. Start over cleanly; nothing local is lost.
    if (e instanceof GraphError && (e.status === 410 || e.code === 'SyncStateNotFound' || e.code === 'resyncRequired') && saved) {
      await store.setMeta(deltaKey, undefined);
      result.resynced = true;
      await run(undefined);
    } else throw e;
  }
  return result;
}

// ---- reading the hidden header marks ---------------------------------------------------------------------------------------------------

const CHUNK_MAX = 20; // what one $batch can carry
const CHUNK_MIN = 4;  // Outlook answers about four things at once per mailbox; below this slowing down no longer helps
const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface EnrichResult {
  /** Messages whose headers were read in this run. */
  checked: number;
  /** Messages in the inbox still waiting to be read (also after a run that stopped early). */
  left: number;
  /** Microsoft asked us to slow down at least once. */
  slow: boolean;
}

/**
 * Reads the headers (List-Unsubscribe, Precedence, ...) of every message not yet read, newest first, in groups of up to 20, and re-sorts each
 * one with what they say. The marks are saved with the message, so this happens once per message, ever. Slows down when Microsoft says so,
 * and stops when nothing is getting through (offline, refused) or when asked to. Errors that are about the connection are thrown.
 */
export async function enrichHeaders(p: {
  graph: Graph; store: Store; account: string;
  /** Asked again before every group, so a choice made meanwhile (a moved sender, new VIP) is respected at once. */
  ctx: () => ClassifyContext;
  max?: number;
  sleep?: (ms: number) => Promise<void>;
  stop?: () => boolean;
  /** Called after every group with how many are left, so the screen can follow along. */
  onProgress?: (left: number) => void | Promise<void>;
}): Promise<EnrichResult> {
  const sleep = p.sleep ?? realSleep;
  const max = p.max ?? 2000;
  const failed = new Set<string>(); // answered with an error that is not "slow down": try again next time, not in this run
  let size = CHUNK_MAX, checked = 0, idle = 0, slow = false, left = 0;
  for (;;) {
    const todo = (await p.store.allMail())
      .filter((m) => m.account === p.account && m.folder === 'inbox' && m.sig === undefined)
      .sort((a, b) => b.received.localeCompare(a.received));
    left = todo.length;
    const next = todo.filter((m) => !failed.has(m.key));
    if (!next.length || checked >= max || p.stop?.()) break;

    const chunk = next.slice(0, Math.min(size, max - checked));
    const res = await p.graph.batch(chunk.map((m) => ({ method: 'GET', url: `/me/messages/${encodeURIComponent(m.id)}?$select=internetMessageHeaders` })));
    const answers: { key: string; sig: string[] }[] = [];
    let throttled = 0, waitS = 0;
    chunk.forEach((m, i) => {
      const r = res[i];
      if (r?.status === 200) answers.push({ key: m.key, sig: signalsFromHeaders(r.body?.internetMessageHeaders) });
      else if (r?.status === 404) answers.push({ key: m.key, sig: [] }); // gone or moved: do not ask again (the next sync drops it)
      else if (r && (r.status === 429 || r.status === 503 || r.status === 504)) { throttled++; waitS = Math.max(waitS, r.retryAfter ?? 0); }
      else failed.add(m.key);
    });

    // Re-read each message just before writing: a read, a snooze or a flag set meanwhile must not be overwritten with an old copy.
    const ctx = p.ctx();
    const fresh: Mail[] = [];
    for (const a of answers) {
      const cur = await p.store.getMail(a.key);
      if (!cur) continue;
      const withSig = { ...cur, sig: a.sig };
      const c = verdict(withSig, ctx);
      fresh.push({ ...withSig, kind: c.kind, why: c.why });
    }
    await p.store.putMail(fresh);
    checked += answers.length;
    left -= answers.length;
    idle = answers.length ? 0 : idle + 1;

    if (throttled) { slow = true; size = Math.max(CHUNK_MIN, size >> 1); await sleep(Math.min(Math.max(waitS, 2), 20) * 1000); }
    else if (size < CHUNK_MAX) size = Math.min(CHUNK_MAX, size * 2);
    await p.onProgress?.(left);
    if (idle >= 3) break;
  }
  return { checked, left, slow };
}

/** Re-sorts every saved message with what Post knows now (a moved sender, a new VIP, a person you have written to, a better rule). Returns how many changed tab or reason. */
export async function reclassifyAll(store: Store, ctx: ClassifyContext): Promise<number> {
  const changes: { key: string; kind: Mail['kind']; why: string[] }[] = [];
  for (const m of await store.allMail()) {
    const c = verdict(m, ctx);
    if (c.kind !== m.kind || c.why.length !== m.why.length || c.why.some((w, i) => w !== m.why[i])) changes.push({ key: m.key, kind: c.kind, why: c.why });
  }
  // Re-read before writing, for the same reason as above.
  const out: Mail[] = [];
  for (const ch of changes) {
    const cur = await store.getMail(ch.key);
    if (cur) out.push({ ...cur, kind: ch.kind, why: ch.why });
  }
  if (out.length) await store.putMail(out);
  return out.length;
}

// ---- the people you have written to -------------------------------------------------------------------------------------------------

export const KNOWN_MAX_AGE_MS = 6 * 3_600_000;
const KNOWN_CAP = 8000;
type KnownSaved = { at: number; addrs: string[] };

/** Everyone any signed-in mailbox has written to. Mail from them is personal unless it plainly is not. */
export async function loadKnown(store: Store, accounts: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (const a of accounts) for (const addr of (await store.getMeta<KnownSaved>(`${a}|known`))?.addrs ?? []) out.add(addr);
  return out;
}

/** Reads Sent Items (the first time a few hundred messages, after that the newest hundred at most every six hours). Returns true when the list grew. */
export async function refreshKnown(p: { graph: Graph; store: Store; account: string; now?: () => number; maxAgeMs?: number }): Promise<boolean> {
  const key = `${p.account}|known`;
  const now = (p.now ?? Date.now)();
  const saved = await p.store.getMeta<KnownSaved>(key);
  if (saved && now - saved.at < (p.maxAgeMs ?? KNOWN_MAX_AGE_MS)) return false;
  const fresh = await p.graph.sentRecipients(saved?.at ? 1 : 3); // at 0: only addresses added by rememberKnown so far, Sent Items has never been read
  const merged = [...new Set([...(saved?.addrs ?? []), ...fresh])].slice(-KNOWN_CAP);
  await p.store.setMeta(key, { at: now, addrs: merged } satisfies KnownSaved);
  return merged.length !== (saved?.addrs.length ?? 0);
}

/** Adds people you have just written to, without waiting for the next look at Sent Items. Returns true when someone new was added. */
export async function rememberKnown(store: Store, account: string, addresses: string[]): Promise<boolean> {
  const key = `${account}|known`;
  const saved = (await store.getMeta<KnownSaved>(key)) ?? { at: 0, addrs: [] };
  const add = addresses.map((a) => a.trim().toLowerCase()).filter((a) => a.includes('@') && !saved.addrs.includes(a));
  if (!add.length) return false;
  await store.setMeta(key, { at: saved.at, addrs: [...saved.addrs, ...new Set(add)].slice(-KNOWN_CAP) } satisfies KnownSaved);
  return true;
}
