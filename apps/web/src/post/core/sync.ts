import { classify } from './classify.ts';
import { GraphError, type Graph, type RawMessage } from './graph.ts';
import type { Store } from './store.ts';
import { mailKey, type Kind, type Mail } from './types.ts';

// Keeps the phone's copy of the inbox in step with Outlook using Graph "delta" queries: after the first sync only what changed is fetched.
// Never loses a local change: anything with an action still waiting to be sent is left alone until that action has gone through.

export interface SyncResult { added: number; changed: number; removed: number; resynced: boolean; enriched: number }

export const FIRST_SYNC_DAYS = 45;

export function toMail(account: string, r: RawMessage, overrides: Record<string, Kind>, prev?: Mail): Mail {
  const fromAddress = (r.from?.emailAddress?.address ?? '').toLowerCase();
  const fromName = r.from?.emailAddress?.name ?? '';
  const subject = r.subject ?? '';
  const base = {
    key: mailKey(account, r.id), account, id: r.id,
    conversationId: r.conversationId ?? '', received: r.receivedDateTime ?? new Date(0).toISOString(),
    subject, fromName, fromAddress, preview: (r.bodyPreview ?? '').replace(/\s+/g, ' ').trim().slice(0, 200),
    isRead: !!r.isRead, flagged: r.flag?.flagStatus === 'flagged', hasAttachments: !!r.hasAttachments,
    folder: 'inbox' as const,
  };
  // Once the headers have been read the sharper verdict is kept, unless the sender was overridden since.
  if (prev?.headersChecked && !overrides[fromAddress]) return { ...base, kind: prev.kind, why: prev.why, headersChecked: true, snoozedUntil: prev.snoozedUntil ?? null };
  const c = classify({ fromAddress, fromName, subject, preview: r.bodyPreview, inferenceClassification: r.inferenceClassification }, overrides);
  return { ...base, kind: c.kind, why: c.why, headersChecked: false, snoozedUntil: prev?.snoozedUntil ?? null };
}

export async function syncAccount(p: { graph: Graph; store: Store; account: string; overrides?: Record<string, Kind>; now?: () => Date; maxEnrich?: number }): Promise<SyncResult> {
  const { graph, store, account } = p;
  const overrides = p.overrides ?? {};
  const now = p.now ?? (() => new Date());
  const deltaKey = `${account}|delta`;
  const result: SyncResult = { added: 0, changed: 0, removed: 0, resynced: false, enriched: 0 };

  const pending = new Set((await store.allOps()).filter((o) => o.account === account).map((o) => mailKey(o.account, o.messageId)));

  async function run(startLink: string | undefined): Promise<void> {
    const full = !startLink; // a first sync or a start-over: everything in the window comes back
    const sinceMs = now().getTime() - FIRST_SYNC_DAYS * 86_400_000;
    const since = new Date(sinceMs).toISOString();
    // One read of what is stored, instead of one per message: a first sync can be a thousand messages.
    const known = new Map((await store.allMail()).filter((m) => m.account === account).map((m) => [m.key, m]));
    const seenKeys = new Set<string>();
    const batchIn = async (raws: RawMessage[]) => {
      const removed: string[] = [];
      const upserts: Mail[] = [];
      for (const r of raws) {
        const key = mailKey(account, r.id);
        seenKeys.add(key);
        if (pending.has(key)) continue;
        if (r['@removed']) { removed.push(key); known.delete(key); continue; }
        const prev = known.get(key);
        const next = toMail(account, r, overrides, prev);
        if (prev) result.changed++; else result.added++;
        known.set(key, next);
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
      const gone = [...known.values()].filter((m) => !seenKeys.has(m.key) && !pending.has(m.key) && new Date(m.received).getTime() >= sinceMs).map((m) => m.key);
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
  result.enriched = await enrichHeaders({ graph, store, account, overrides, max: p.maxEnrich ?? 30 });
  return result;
}

/** Reads the headers of the newest messages not yet checked (one $batch), because List-Unsubscribe / Precedence sharpen the sorting a lot. */
export async function enrichHeaders(p: { graph: Graph; store: Store; account: string; overrides: Record<string, Kind>; max: number }): Promise<number> {
  const todo = (await p.store.allMail()).filter((m) => m.account === p.account && m.folder === 'inbox' && !m.headersChecked).sort((a, b) => b.received.localeCompare(a.received)).slice(0, p.max);
  if (!todo.length) return 0;
  const res = await p.graph.batch(todo.map((m) => ({ method: 'GET', url: `/me/messages/${encodeURIComponent(m.id)}?$select=internetMessageHeaders` })));
  const updated: Mail[] = [];
  todo.forEach((m, i) => {
    const r = res[i];
    if (!r || r.status !== 200) {
      if (r && r.status === 404) updated.push({ ...m, headersChecked: true }); // gone or moved: do not ask again
      return;
    }
    const headers = (r.body?.internetMessageHeaders ?? []) as { name: string; value: string }[];
    const c = classify({ fromAddress: m.fromAddress, fromName: m.fromName, subject: m.subject, preview: m.preview, headers }, p.overrides);
    updated.push({ ...m, kind: c.kind, why: c.why, headersChecked: true });
  });
  // Re-read before writing: an action taken meanwhile (read, snooze) must not be overwritten with the old copy.
  const fresh: Mail[] = [];
  for (const u of updated) {
    const cur = await p.store.getMail(u.key);
    if (cur) fresh.push({ ...cur, kind: u.kind, why: u.why, headersChecked: true });
  }
  await p.store.putMail(fresh);
  return fresh.length;
}

/** Re-sorts every stored message after the user moved a sender ("this is a newsletter"). */
export async function reclassifyAll(store: Store, overrides: Record<string, Kind>): Promise<void> {
  const all = await store.allMail();
  const changed: Mail[] = [];
  for (const m of all) {
    const forced = overrides[m.fromAddress];
    if (forced && (m.kind !== forced)) changed.push({ ...m, kind: forced, why: ['You moved this sender here'] });
    else if (!forced && m.why[0] === 'You moved this sender here') {
      const c = classify({ fromAddress: m.fromAddress, fromName: m.fromName, subject: m.subject, preview: m.preview }, overrides);
      changed.push({ ...m, kind: c.kind, why: c.why, headersChecked: false });
    }
  }
  if (changed.length) await store.putMail(changed);
}
