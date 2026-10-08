// A small Microsoft Graph client for mail: every call goes through one request() that adds the sign-in, retries when Microsoft says
// "slow down", and signs in again once if the token was refused. No call can wait for ever: one that does not answer in time is cut off and
// counts as a dropped connection. Sending is made safe against lost answers (see deliver). The fetch and the token source are injected so
// it is tested without a network.

export type Fetcher = typeof fetch;

export class GraphError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'GraphError';
    this.status = status;
    this.code = code;
  }
}

export interface GraphDeps {
  fetch: Fetcher;
  base?: string;
  /** Returns an access token. `fresh` asks for a new one (the old one was refused). */
  token: (fresh?: boolean) => Promise<string>;
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
  /** How long one call may take before it is cut off (default 30 s). Files going up or down get four times as long. */
  timeoutMs?: number;
  /**
   * Where files over 3 MB are handed to when the browser cannot reach Microsoft's upload address itself (the site's own server passes each
   * slice on; the full address, e.g. "https://post.example/api/post-upload"). Tried only after a direct attempt fails.
   */
  uploadRelay?: string;
  /** Start with the relay (it worked last time). */
  uploadViaRelay?: boolean;
  /** Called once when the relay turned out to be the way that works, so the next start can begin with it. */
  onUploadRoute?: (route: 'relay') => void;
}

export interface RawMessage {
  id: string;
  conversationId?: string;
  receivedDateTime?: string;
  subject?: string;
  from?: { emailAddress?: { name?: string; address?: string } };
  bodyPreview?: string;
  isRead?: boolean;
  flag?: { flagStatus?: string };
  hasAttachments?: boolean;
  inferenceClassification?: string;
  parentFolderId?: string;
  isDraft?: boolean;
  /** Only asked for when a folder is listed (Sent Items and Drafts show who a message went to). */
  toRecipients?: { emailAddress?: { name?: string; address?: string } }[];
  lastModifiedDateTime?: string;
  internetMessageHeaders?: { name: string; value: string }[];
  '@removed'?: { reason?: string };
}

/** One folder as Outlook lists it. */
export interface RawFolder { id: string; displayName?: string; parentFolderId?: string; childFolderCount?: number; unreadItemCount?: number; totalItemCount?: number }

/** What a mailbox's folders are: every folder found (three levels down at most), which ids are the standard ones, and which are Outlook's own plumbing (Outbox, Sync Issues ...) that is not for reading. */
export interface FolderTree { folders: RawFolder[]; standard: Partial<Record<WellKnownFolder, string>>; hidden: string[] }

/** A draft as an editor needs it: the text (Outlook turns any formatting into plain text), who it is for, the people who are on it as Bcc, and when it was last changed at Outlook ('' when Outlook did not say). */
export interface DraftContent { subject: string; body: string; to: string[]; cc: string[]; bcc: string[]; isDraft: boolean; modified: string }

/** The parts of a draft the editor can change. Only what was changed is written back: a text that Outlook turned into plain text must not replace the formatted one when it was left alone. */
export type DraftField = 'subject' | 'body' | 'to' | 'cc';
export const DRAFT_FIELDS: readonly DraftField[] = ['subject', 'body', 'to', 'cc'];

/** A file to send. `bytes` is the file as it is. */
export interface OutFile { name: string; type: string; bytes: Uint8Array }

/** Everything about an attachment except its contents. `kind`: a file, an attached message (item) or a link to a cloud file. */
export interface AttachmentInfo { id: string; name: string; size: number; contentType: string; inline: boolean; kind: 'file' | 'item' | 'link' }

/** What goes out: a new message, an answer to one (`replyTo` is the message answered), or a forward of one. */
export type Outgoing =
  | { kind: 'new'; subject: string; body: string; to: string[]; cc?: string[]; bcc?: string[] }
  | { kind: 'reply' | 'replyAll'; replyTo: string; body: string }
  | { kind: 'forward'; replyTo: string; to: string[]; body: string }
  /** A draft that is already at Outlook (made in another app, or left behind): what was changed (`edited`; everything when it is not said) is replaced by this, then it is sent. */
  | { kind: 'draft'; draftId: string; subject: string; body: string; to: string[]; cc?: string[]; edited?: DraftField[] };

/** How far a message got at Outlook: its draft is made (and being filled), or "send" has been asked for. Kept by the caller between tries. */
export interface DraftProgress { id: string; phase: 'made' | 'sending' }

const ONE_CALL = 3_000_000;     // the biggest single file added with one call; anything above goes up in slices
const SLICE = 3_276_800;        // under Microsoft's 4 MB limit per slice, and a multiple of both 320 KiB (what OneDrive asks) and 200 KiB (what Outlook recommends)

/** Base64 of any size without building one giant string of characters first. */
export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

export const LIST_FIELDS = 'id,conversationId,receivedDateTime,subject,from,bodyPreview,isRead,flag,hasAttachments,inferenceClassification,parentFolderId';
/** What a folder list asks for: the same, and who a message went to (Sent Items, Drafts), whether it is a draft, and when it was last changed (what Drafts are put in order by). */
export const FOLDER_LIST_FIELDS = `${LIST_FIELDS},isDraft,toRecipients,lastModifiedDateTime`;
const FOLDER_FIELDS = 'id,displayName,parentFolderId,childFolderCount,unreadItemCount,totalItemCount';
export type WellKnownFolder = 'inbox' | 'archive' | 'deleteditems' | 'sentitems' | 'drafts' | 'junkemail';
/** The folders Post names itself, in the order they are listed. */
export const STANDARD_FOLDERS: readonly WellKnownFolder[] = ['inbox', 'drafts', 'sentitems', 'archive', 'junkemail', 'deleteditems'];
/** Outlook's own plumbing: they are asked for by name only to be left out of the list (their ids are the same for every language). */
const PLUMBING_FOLDERS = ['outbox', 'syncissues', 'conversationhistory', 'clutter', 'scheduled', 'recoverableitemsdeletions'] as const;
/** How many folders of one mailbox Post reads, and how deep it looks. A mailbox with more is cut off, not failed. */
const FOLDERS_MAX = 250;
const FOLDER_DEPTH = 3;

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createGraph(deps: GraphDeps) {
  const base = deps.base ?? 'https://graph.microsoft.com/v1.0';
  const sleep = deps.sleep ?? realSleep;
  const maxRetries = deps.maxRetries ?? 3;
  const timeoutMs = deps.timeoutMs ?? 30_000;

  type Send = {
    headers?: Record<string, string>; body?: BodyInit;
    /** false for addresses that carry their own permission (upload addresses): the sign-in must not be sent there */
    auth?: boolean;
    /** how often a dropped connection is tried again (default: the usual number) */
    retries?: number;
    /** The call may already have been carried out when its answer is lost (sending a message, adding a file), so it is never simply repeated: the caller finds out first. */
    once?: boolean;
    /** Files and long jobs: four times the usual time before the call is given up on. */
    slow?: boolean;
  };

  /**
   * One try: the whole answer within the time allowed, or a GraphError with status 0 ("network" or "timeout"). A call that never answers is cut
   * off here, so one stuck connection can never hold up what waits behind it. The answer is read in full inside the limit (an answer that stops
   * halfway is as stuck as none) and handed on as a finished Response.
   */
  async function within(url: string, init: RequestInit, ms: number): Promise<Response> {
    const stop = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { stop.abort(); reject(new GraphError(0, 'timeout', 'Outlook did not answer in time')); }, ms);
    });
    const work = (async () => {
      const res = await deps.fetch(url, { ...init, signal: stop.signal });
      const empty = res.status === 204 || res.status === 205 || res.status === 304;
      return new Response(empty ? null : await res.arrayBuffer(), { status: res.status, statusText: res.statusText, headers: res.headers });
    })();
    work.catch(() => {}); // when the time ran out first, what the cut-off call ends with afterwards is of no interest
    try {
      return await Promise.race([work, late]);
    } catch (e) {
      throw e instanceof GraphError ? e : new GraphError(0, 'network', e instanceof Error ? e.message : 'Network error');
    } finally {
      clearTimeout(timer);
    }
  }

  /** One call with the retry rules: renews the sign-in once when it is refused, waits when Microsoft says "slow down", and tries again when the connection drops or does not answer. Gives back the final answer untouched. */
  async function exchange(method: string, pathOrUrl: string, o: Send = {}): Promise<Response> {
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${base}${pathOrUrl}`;
    const limit = o.retries ?? maxRetries;
    const ms = o.slow ? timeoutMs * 4 : timeoutMs;
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      const headers: Record<string, string> = {};
      if (o.auth !== false) headers.Authorization = `Bearer ${await deps.token(refreshed)}`;
      Object.assign(headers, o.headers);
      let res: Response;
      try {
        res = await within(url, { method, headers, body: o.body }, ms);
      } catch (e) {
        if (!o.once && attempt < limit) { await sleep(500 * 2 ** attempt); continue; }
        throw e;
      }
      if (res.status === 401 && o.auth !== false && !refreshed) { refreshed = true; attempt--; continue; }
      // "Slow down" and "not available" were not carried out, so trying again is safe. A gateway timeout (504) says nothing about whether it was.
      if ((res.status === 429 || res.status === 503 || (res.status === 504 && !o.once)) && attempt < limit) {
        const wait = Number(res.headers.get('Retry-After'));
        await sleep(Number.isFinite(wait) && wait > 0 ? Math.min(wait, 30) * 1000 : 500 * 2 ** attempt);
        continue;
      }
      return res;
    }
  }

  const failure = async (res: Response) => {
    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    return new GraphError(res.status, String(json?.error?.code ?? 'error'), String(json?.error?.message ?? text).slice(0, 200));
  };

  async function request(method: string, pathOrUrl: string, body?: unknown, extra: Record<string, string> = {}, how: Pick<Send, 'once' | 'slow'> = {}): Promise<any> {
    const res = await exchange(method, pathOrUrl, { headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...extra }, body: body !== undefined ? JSON.stringify(body) : undefined, ...how });
    if (res.status === 204 || res.status === 202) return null;
    if (!res.ok) throw await failure(res);
    const text = await res.text();
    try { return text ? JSON.parse(text) : null; } catch { return null; }
  }

  /** The answer as it is, for files. */
  async function requestBytes(path: string): Promise<{ bytes: Uint8Array; type: string }> {
    const res = await exchange('GET', path, { slow: true });
    if (!res.ok) throw await failure(res);
    return { bytes: new Uint8Array(await res.arrayBuffer()), type: res.headers.get('Content-Type') ?? '' };
  }

  // ---- sending ---------------------------------------------------------------------------------------------------------------
  // Every message goes out through a draft: make it, add the files one by one (a file over 3 MB goes up in slices to a private upload
  // address), then send it. A message sent in one call cannot be told apart afterwards from one that was not sent when the answer is lost
  // (a dropped connection, the phone going to sleep); a draft has an id that can be asked about, so a message goes out exactly once.

  const enc = encodeURIComponent;
  const fileAttachment = (f: OutFile) => ({ '@odata.type': '#microsoft.graph.fileAttachment', name: f.name, contentType: f.type || 'application/octet-stream', contentBytes: toBase64(f.bytes) });
  const rcpt = (a: string[] = []) => a.map((address) => ({ emailAddress: { address } }));

  // The upload address belongs to Microsoft's mail servers and carries its own permission. A browser may not be allowed to talk to it (that
  // is Microsoft's choice and cannot be tested from here), so when the direct way fails the site's own server passes the slice on.
  let viaRelay = !!deps.uploadRelay && !!deps.uploadViaRelay;

  async function putSlice(url: string, bytes: Uint8Array, start: number, total: number) {
    const headers = { 'Content-Type': 'application/octet-stream', 'Content-Range': `bytes ${start}-${start + bytes.byteLength - 1}/${total}` };
    const body = bytes as BodyInit;
    const relay = deps.uploadRelay;
    const throughRelay = async () => {
      const r = await exchange('PUT', relay!, { auth: false, slow: true, headers: { ...headers, 'X-Upload-Url': url }, body });
      // Anything that is not the relay itself (a missing route answers with the web page) is no answer from Microsoft.
      if (!r.headers.get('X-Post-Relay')) throw new GraphError(0, 'upload', 'Outlook would not take the file from this browser');
      return r;
    };
    let res: Response;
    if (relay && viaRelay) res = await throughRelay();
    else {
      try { res = await exchange('PUT', url, { auth: false, slow: true, headers, body, retries: relay ? 0 : undefined }); } catch (e) {
        if (!relay || !(e instanceof GraphError && e.status === 0)) throw e;
        res = await throughRelay();
        if (res.ok) { viaRelay = true; deps.onUploadRoute?.('relay'); }
      }
    }
    if (!res.ok) throw await failure(res);
  }

  async function attach(messageId: string, f: OutFile) {
    const size = f.bytes.byteLength;
    if (size <= ONE_CALL) { await request('POST', `/me/messages/${enc(messageId)}/attachments`, fileAttachment(f), {}, { once: true, slow: true }); return; }
    const session = await request('POST', `/me/messages/${enc(messageId)}/attachments/createUploadSession`, { AttachmentItem: { attachmentType: 'file', name: f.name, size, contentType: f.type || 'application/octet-stream' } });
    const url = String(session?.uploadUrl ?? '');
    if (!url) throw new GraphError(0, 'upload', `Outlook did not give a place to upload ${f.name}`);
    for (let at = 0; at < size; at += SLICE) await putSlice(url, f.bytes.subarray(at, Math.min(size, at + SLICE)), at, size);
  }

  /** What is attached to a draft (name and size are enough to tell). */
  async function listed(id: string): Promise<{ name: string; size: number }[]> {
    const j = await request('GET', `/me/messages/${enc(id)}/attachments?$select=name,size`);
    return ((j?.value ?? []) as any[]).map((a) => ({ name: String(a?.name ?? ''), size: Number(a?.size ?? 0) }));
  }
  // Outlook may report a size a little different from the file's own (it counts what it stored), so "the same" is the same name and nearly the same size.
  const sameFile = (a: { name: string; size: number }, f: OutFile) => a.name === f.name && Math.abs(a.size - f.bytes.byteLength) <= Math.max(1024, f.bytes.byteLength * 0.02);
  const without = (have: { name: string; size: number }[], f: OutFile): boolean => { const i = have.findIndex((a) => sameFile(a, f)); if (i < 0) return false; have.splice(i, 1); return true; };

  /** Adds one file to a draft. When the connection drops while it goes up, the draft is looked at before trying again, so the file can never be on it twice. */
  async function attachSafely(id: string, f: OutFile) {
    for (let n = 0; ; n++) {
      try { await attach(id, f); return; } catch (e) {
        const lost = e instanceof GraphError && e.status === 0 && (e.code === 'network' || e.code === 'timeout');
        if (!lost || n >= maxRetries) throw e;
        if (without(await listed(id), f)) return; // it arrived, only the answer was lost
        await sleep(500 * 2 ** n);
      }
    }
  }

  /** Makes the draft of a message and gives back its id. */
  async function makeDraft(msg: Exclude<Outgoing, { kind: 'draft' }>): Promise<string> {
    let j: any;
    if (msg.kind === 'new') j = await request('POST', '/me/messages', { subject: msg.subject, body: { contentType: 'Text', content: msg.body }, toRecipients: rcpt(msg.to), ccRecipients: rcpt(msg.cc), bccRecipients: rcpt(msg.bcc) });
    else if (msg.kind === 'forward') j = await request('POST', `/me/messages/${enc(msg.replyTo)}/createForward`, { comment: msg.body, toRecipients: rcpt(msg.to) });
    else j = await request('POST', `/me/messages/${enc(msg.replyTo)}/${msg.kind === 'replyAll' ? 'createReplyAll' : 'createReply'}`, { comment: msg.body });
    const id = String(j?.id ?? '');
    if (!id) throw new GraphError(0, 'draft', 'Outlook did not create the draft');
    return id;
  }

  /** Where a draft stands: still a draft, sent (it exists but is not a draft any more), or missing (sent and moved to Sent Items under another id, or deleted). */
  async function draftState(id: string): Promise<'draft' | 'sent' | 'missing'> {
    try {
      const j = await request('GET', `/me/messages/${enc(id)}?$select=isDraft`);
      return j?.isDraft === false ? 'sent' : 'draft';
    } catch (e) {
      if (e instanceof GraphError && (e.status === 404 || e.status === 410)) return 'missing';
      throw e;
    }
  }

  /**
   * Replaces what a draft says (its subject, its text, who it is for) with what the editor has: only the parts named in `edited` (all of them when
   * it is not given), so that a part nobody touched is never rewritten (a formatted text, the names of the people it is for). Safe to repeat.
   */
  async function updateDraft(id: string, f: { subject: string; body: string; to: string[]; cc?: string[]; edited?: readonly DraftField[] }): Promise<void> {
    const parts = new Set<DraftField>(f.edited ?? DRAFT_FIELDS);
    const patch: Record<string, unknown> = {};
    if (parts.has('subject')) patch.subject = f.subject;
    if (parts.has('body')) patch.body = { contentType: 'Text', content: f.body };
    if (parts.has('to')) patch.toRecipients = rcpt(f.to);
    if (parts.has('cc')) patch.ccRecipients = rcpt(f.cc);
    if (Object.keys(patch).length) await request('PATCH', `/me/messages/${enc(id)}`, patch);
  }

  /** Puts files on a draft that is already at Outlook: one that is on it already (the same name and size) is not added again, so this is safe to repeat. */
  async function addToDraft(id: string, files: OutFile[]): Promise<void> {
    const have = files.length ? await listed(id) : [];
    for (const f of files) if (!without(have, f)) await attachSafely(id, f);
  }

  /**
   * Sends a draft that is already at Outlook, exactly once: its text is replaced by what the editor has, the files that were added go on, and
   * it is sent. How far it got is told through `saved`, like a message Post made itself, so a lost answer never sends it twice. The draft is the
   * person's own: nothing here ever throws it away.
   */
  async function deliverDraft(msg: Extract<Outgoing, { kind: 'draft' }>, files: OutFile[], resume?: DraftProgress, saved?: (progress: DraftProgress) => Promise<void>): Promise<void> {
    const id = msg.draftId;
    const where = await draftState(id);
    if (where === 'sent') return;                                    // it has left (Outlook kept it in Sent Items)
    if (where === 'missing') {
      if (resume?.id === id && resume.phase === 'sending') return;   // it has left, and Sent Items has it under another name
      throw new GraphError(404, 'ErrorItemNotFound', 'This draft is no longer in Outlook');
    }
    if (!(resume?.id === id && resume.phase === 'sending')) {
      await saved?.({ id, phase: 'made' });
      await updateDraft(id, msg);
      await addToDraft(id, files);
      await saved?.({ id, phase: 'sending' });
    }
    await request('POST', `/me/messages/${enc(id)}/send`, undefined, {}, { once: true, slow: true });
  }

  /** Up to 20 calls in one request. Returns the status of each, in order. A call Microsoft asked us to slow down on also says for how long (`retryAfter`, seconds). */
  async function batch(calls: { method: string; url: string; body?: unknown }[]): Promise<{ status: number; body: any; retryAfter?: number }[]> {
    const out: { status: number; body: any; retryAfter?: number }[] = [];
    for (let i = 0; i < calls.length; i += 20) {
      const chunk = calls.slice(i, i + 20);
      const j = await request('POST', '/$batch', { requests: chunk.map((c, n) => ({ id: String(n), method: c.method, url: c.url, ...(c.body ? { body: c.body, headers: { 'Content-Type': 'application/json' } } : {}) })) });
      const byId = new Map<string, { status: number; body: any; retryAfter?: number }>((j?.responses ?? []).map((r: any) => {
        const h = r?.headers ?? {};
        const wait = Number(h['Retry-After'] ?? h['retry-after']);
        return [String(r.id), { status: Number(r.status), body: r.body, ...(Number.isFinite(wait) && wait > 0 ? { retryAfter: wait } : {}) }];
      }));
      for (let n = 0; n < chunk.length; n++) out.push(byId.get(String(n)) ?? { status: 0, body: null });
    }
    return out;
  }

  /** What Outlook answers at once: it refuses calls to one mailbox beyond four at a time (429), so the folder calls go in batches of four. */
  const BATCH_WIDTH = 4;
  const slowDown = (status: number) => status === 429 || status === 503 || status === 504 || status === 0;

  /**
   * Calls to one mailbox, four to a batch. Each call that was told to slow down (or got no answer) is given up to three more goes, after the
   * wait Outlook asked for. A call that really failed (no such folder) is left as it is: callers tell it from one that was never answered by
   * `slowDown` of its status.
   */
  async function batchRetrying(calls: { method: string; url: string; body?: unknown }[]): Promise<{ status: number; body: any; retryAfter?: number }[]> {
    const res: { status: number; body: any; retryAfter?: number }[] = new Array(calls.length);
    let todo = calls.map((_, i) => i);
    for (let round = 0; ; round++) {
      for (let at = 0; at < todo.length; at += BATCH_WIDTH) {
        const part = todo.slice(at, at + BATCH_WIDTH);
        const got = await batch(part.map((i) => calls[i]));
        part.forEach((i, n) => { res[i] = got[n]; });
      }
      todo = todo.filter((i) => slowDown(res[i].status));
      if (!todo.length || round >= 3) return res;
      const wait = Math.max(0, ...todo.map((i) => res[i].retryAfter ?? 0));
      await sleep(wait > 0 ? Math.min(wait, 10) * 1000 : 1000 * 2 ** round);
    }
  }

  return {
    request,
    batch,

    /** One page of changes in a folder. Pass the previous deltaLink to get only what changed since. */
    async deltaPage(folder: WellKnownFolder, link?: string, sinceIso?: string): Promise<{ value: RawMessage[]; next?: string; delta?: string }> {
      const first = `/me/mailFolders/${folder}/messages/delta?$select=${LIST_FIELDS}${sinceIso ? `&$filter=receivedDateTime ge ${sinceIso}` : ''}`;
      const j = await request('GET', link ?? first, undefined, { Prefer: 'odata.maxpagesize=50' });
      return { value: (j?.value ?? []) as RawMessage[], next: j?.['@odata.nextLink'], delta: j?.['@odata.deltaLink'] };
    },

    async getBody(id: string): Promise<any> {
      return await request('GET', `/me/messages/${encodeURIComponent(id)}?$select=body,toRecipients,ccRecipients,hasAttachments`, undefined, { Prefer: 'outlook.body-content-type="html"' });
    },

    async getHeaders(id: string): Promise<{ name: string; value: string }[]> {
      const j = await request('GET', `/me/messages/${encodeURIComponent(id)}?$select=internetMessageHeaders`);
      return (j?.internetMessageHeaders ?? []) as { name: string; value: string }[];
    },

    async setRead(id: string, isRead: boolean) { await request('PATCH', `/me/messages/${encodeURIComponent(id)}`, { isRead }); },
    async setFlag(id: string, flagged: boolean) { await request('PATCH', `/me/messages/${encodeURIComponent(id)}`, { flag: { flagStatus: flagged ? 'flagged' : 'notFlagged' } }); },

    /** Moves a message and returns its new id (a moved message gets a new id in Graph). `folder` is a standard folder's name or the id of any folder. */
    async move(id: string, folder: WellKnownFolder | string): Promise<string> {
      const j = await request('POST', `/me/messages/${encodeURIComponent(id)}/move`, { destinationId: folder });
      return String(j?.id ?? id);
    },

    /**
     * Every message of one conversation, from every folder (Sent Items and the Archive too), in no particular order. Microsoft refuses to sort
     * a conversation lookup, so the caller sorts. Drafts are marked (`isDraft`), and each message says its folder (`parentFolderId`).
     */
    async conversation(conversationId: string, max = 100): Promise<RawMessage[]> {
      const filter = encodeURIComponent(`conversationId eq '${conversationId.replace(/'/g, "''")}'`);
      let link: string | undefined = `/me/messages?$filter=${filter}&$select=${LIST_FIELDS},isDraft&$top=50`;
      const out: RawMessage[] = [];
      for (let pages = 0; link && out.length < max && pages < 4; pages++) {
        const j: any = await request('GET', link);
        out.push(...((j?.value ?? []) as RawMessage[]));
        link = j?.['@odata.nextLink'];
      }
      return out.slice(0, max);
    },

    /** The ids of some of the standard folders (messages say where they are by id). A folder Microsoft cannot find is left out. */
    async folderIds(names: WellKnownFolder[]): Promise<Partial<Record<WellKnownFolder, string>>> {
      const res = await batch(names.map((n) => ({ method: 'GET', url: `/me/mailFolders/${n}?$select=id` })));
      const out: Partial<Record<WellKnownFolder, string>> = {};
      names.forEach((n, i) => { const id = res[i]?.status === 200 ? String(res[i].body?.id ?? '') : ''; if (id) out[n] = id; });
      return out;
    },

    /**
     * Sends a short message in one call, with no files. It is not repeated when the answer is lost (the caller says so), but nothing can tell
     * afterwards whether it went: messages that must go exactly once, with or without files, go through `deliver`.
     */
    async sendMail(message: { subject: string; body: string; to: string[]; cc?: string[]; bcc?: string[] }) {
      const payload = { subject: message.subject, body: { contentType: 'Text', content: message.body }, toRecipients: rcpt(message.to), ccRecipients: rcpt(message.cc), bccRecipients: rcpt(message.bcc) };
      await request('POST', '/me/sendMail', { message: payload, saveToSentItems: true }, {}, { once: true });
    },

    /**
     * Sends a message so that it goes out exactly once, however often this is called for it: through a draft, which has an id that can be asked
     * about. `resume` is what an earlier try reported through `saved` (the draft's id and how far it got): after a dropped connection, or the
     * phone going to sleep in the middle, the draft is looked at first, and a message that has already left is not sent again.
     * `saved` is awaited, and when it fails nothing more is done: a "send" is never started that could not be written down first.
     */
    async deliver(msg: Outgoing, files: OutFile[] = [], resume?: DraftProgress, saved?: (progress: DraftProgress) => Promise<void>): Promise<void> {
      if (msg.kind === 'draft') return await deliverDraft(msg, files, resume, saved);
      let id: string | undefined;
      if (resume) {
        const where = await draftState(resume.id);
        if (where === 'sent' || (where === 'missing' && resume.phase === 'sending')) return; // it has left (Outlook moved the draft to Sent Items)
        if (where === 'draft') id = resume.id;                                                // still there: go on from where it stopped
      }
      let have: { name: string; size: number }[] = [];
      if (!id) { id = await makeDraft(msg); await saved?.({ id, phase: 'made' }); }
      else if (resume!.phase === 'made' && files.length) have = await listed(id);
      if (!(resume && resume.id === id && resume.phase === 'sending')) {
        for (const f of files) if (!without(have, f)) await attachSafely(id, f);
        await saved?.({ id, phase: 'sending' });
      }
      await request('POST', `/me/messages/${enc(id)}/send`, undefined, {}, { once: true, slow: true });
    },

    /** Whether the draft of a message is still a draft, has gone out, or is missing (gone out and moved to Sent Items, or deleted). */
    draftState,

    updateDraft,
    addToDraft,

    /** A draft as the editor needs it. Outlook turns whatever formatting it has into plain text. */
    async getDraft(id: string): Promise<DraftContent> {
      const j = await request('GET', `/me/messages/${enc(id)}?$select=subject,body,toRecipients,ccRecipients,bccRecipients,isDraft,lastModifiedDateTime`, undefined, { Prefer: 'outlook.body-content-type="text"' });
      const list = (rs: any[] = []) => rs.map((r) => String(r?.emailAddress?.address ?? '').trim()).filter(Boolean);
      return { subject: String(j?.subject ?? ''), body: String(j?.body?.content ?? '').replace(/\r\n?/g, '\n'), to: list(j?.toRecipients), cc: list(j?.ccRecipients), bcc: list(j?.bccRecipients), isDraft: j?.isDraft !== false, modified: String(j?.lastModifiedDateTime ?? '') };
    },

    /** One message by its id, as a folder list shows it (a notification for mail that has been moved since, a link kept from earlier). */
    async getMessage(id: string): Promise<RawMessage> {
      return await request('GET', `/me/messages/${enc(id)}?$select=${FOLDER_LIST_FIELDS}`) as RawMessage;
    },

    /**
     * One page of a folder, newest first (Drafts by when they were last changed). `folder` is a standard folder's name or the id of any folder.
     * Pass the `next` of the page before to go on.
     */
    async folderPage(folder: WellKnownFolder | string, opts: { link?: string; byChange?: boolean; top?: number } = {}): Promise<{ value: RawMessage[]; next?: string }> {
      const first = `/me/mailFolders/${enc(folder)}/messages?$top=${opts.top ?? 40}&$orderby=${opts.byChange ? 'lastModifiedDateTime' : 'receivedDateTime'} desc&$select=${FOLDER_LIST_FIELDS}`;
      const j = await request('GET', opts.link ?? first);
      return { value: (j?.value ?? []) as RawMessage[], next: j?.['@odata.nextLink'] };
    },

    /**
     * Every folder of the mailbox (down to three levels), with how many messages are in each and how many are unread. The standard ones are
     * found by name, so they are known whatever language the mailbox is in. Fails as a whole when part of the tree cannot be read: a list with
     * a folder missing would be worse than none.
     */
    async folderTree(): Promise<FolderTree> {
      const names = [...STANDARD_FOLDERS, ...PLUMBING_FOLDERS];
      const named = await batchRetrying(names.map((n) => ({ method: 'GET', url: `/me/mailFolders/${n}?$select=${FOLDER_FIELDS}` })));
      const standard: Partial<Record<WellKnownFolder, string>> = {};
      const hidden: string[] = [];
      const byId = new Map<string, RawFolder>();
      names.forEach((n, i) => {
        const r = named[i];
        const f = r?.status === 200 ? (r.body as RawFolder) : null;
        // No such folder (or one that may not be read) is a mailbox without it. A call that was never answered, though, is not "no such folder":
        // a list made from the answers that did come would show Outlook's plumbing as folders of your own.
        if (!f?.id) { if (slowDown(r?.status ?? 0)) throw new GraphError(r?.status ?? 0, 'folders', 'Outlook would not list all of your folders'); return; }
        if ((STANDARD_FOLDERS as readonly string[]).includes(n)) { standard[n as WellKnownFolder] = f.id; byId.set(f.id, f); } else hidden.push(f.id);
      });
      const skip = new Set(hidden);
      let link: string | undefined = `/me/mailFolders?$top=100&$select=${FOLDER_FIELDS}`;
      for (let pages = 0; link && pages < 3; pages++) {
        const j: any = await request('GET', link);
        for (const f of (j?.value ?? []) as RawFolder[]) if (f?.id && !skip.has(f.id)) byId.set(f.id, f);
        link = j?.['@odata.nextLink'];
      }
      let frontier = [...byId.values()].filter((f) => (f.childFolderCount ?? 0) > 0);
      for (let level = 0; level < FOLDER_DEPTH && frontier.length && byId.size < FOLDERS_MAX; level++) {
        const res = await batchRetrying(frontier.map((f) => ({ method: 'GET', url: `/me/mailFolders/${enc(f.id)}/childFolders?$top=100&$select=${FOLDER_FIELDS}` })));
        const next: RawFolder[] = [];
        for (let i = 0; i < res.length; i++) {
          const r = res[i];
          if (r.status === 404) continue; // the folder went away while we were looking
          if (r.status !== 200) throw new GraphError(r.status, 'folders', 'Outlook would not list all of your folders');
          let children = (r.body?.value ?? []) as RawFolder[];
          let more: string | undefined = r.body?.['@odata.nextLink'];
          for (let pages = 0; more && pages < 3; pages++) { const j: any = await request('GET', more); children = children.concat((j?.value ?? []) as RawFolder[]); more = j?.['@odata.nextLink']; } // a folder with over a hundred folders in it
          for (const c of children) if (c?.id && !byId.has(c.id) && !skip.has(c.id)) { const f = { ...c, parentFolderId: c.parentFolderId ?? frontier[i].id }; byId.set(c.id, f); next.push(f); }
        }
        frontier = next.filter((f) => (f.childFolderCount ?? 0) > 0);
      }
      return { folders: [...byId.values()].slice(0, FOLDERS_MAX), standard, hidden };
    },

    /**
     * The ids of the messages in one folder (up to `max`), a page of 200 at a time, for what is done to all of them (emptying it). `more`: the folder
     * has more than that. Fails as a whole when a page cannot be read: a part of a folder is not "the folder".
     */
    async idsIn(folder: WellKnownFolder | string, max = 5000): Promise<{ ids: string[]; more: boolean }> {
      const ids: string[] = [];
      let link: string | undefined = `/me/mailFolders/${enc(folder)}/messages?$top=200&$select=id`;
      while (link && ids.length < max) {
        const j: any = await request('GET', link);
        for (const m of (j?.value ?? []) as { id?: string }[]) if (m?.id) ids.push(String(m.id));
        link = j?.['@odata.nextLink'];
      }
      return { ids: ids.slice(0, max), more: !!link || ids.length > max };
    },

    /**
     * Deletes messages for good: they do not go to Deleted Items and Outlook cannot bring them back. A message that is not there any more counts
     * as deleted. Four calls at a time (what Outlook allows), each told to slow down is tried again; `failed` are the ids that are still there.
     * Where Outlook will not do a permanent delete (the answer says it does not know the call), the message is deleted the ordinary way: from
     * Deleted Items that is the last place it goes through.
     */
    async erase(ids: string[]): Promise<{ gone: string[]; failed: string[] }> {
      const res = await batchRetrying(ids.map((id) => ({ method: 'POST', url: `/me/messages/${enc(id)}/permanentDelete`, body: {} })));
      const unknown = ids.map((_, i) => i).filter((i) => [400, 405, 501].includes(res[i].status));
      if (unknown.length) {
        const plain = await batchRetrying(unknown.map((i) => ({ method: 'DELETE', url: `/me/messages/${enc(ids[i])}` })));
        unknown.forEach((i, n) => { res[i] = plain[n]; });
      }
      const gone: string[] = [], failed: string[] = [];
      ids.forEach((id, i) => { const st = res[i].status; if ((st >= 200 && st < 300) || st === 404 || st === 410) gone.push(id); else failed.push(id); });
      return { gone, failed };
    },

    /** Deletes a draft made for a message that will not be sent after all. Best effort: a leftover draft is harmless. */
    async discard(id: string): Promise<void> {
      try { await request('DELETE', `/me/messages/${enc(id)}`); } catch { /* nothing more to do */ }
    },

    /** Server-side search across the whole mailbox, not just what is on this phone. Each result says which folder it is in, and who it went to. */
    async search(query: string, top = 25): Promise<RawMessage[]> {
      const q = query.replace(/"/g, '');
      const j = await request('GET', `/me/messages?$search="${encodeURIComponent(q)}"&$top=${top}&$select=${FOLDER_LIST_FIELDS}`);
      return (j?.value ?? []) as RawMessage[];
    },

    /** The addresses you have written to, from Sent Items (newest messages first, `pages` of 100). Post treats mail from them as personal. */
    async sentRecipients(pages = 3): Promise<string[]> {
      const out = new Set<string>();
      let link: string | undefined = '/me/mailFolders/sentitems/messages?$select=toRecipients,ccRecipients&$orderby=sentDateTime desc&$top=100';
      for (let i = 0; link && i < pages; i++) {
        const j = await request('GET', link);
        for (const m of (j?.value ?? []) as any[]) {
          for (const r of [...(m?.toRecipients ?? []), ...(m?.ccRecipients ?? [])]) {
            const a = String(r?.emailAddress?.address ?? '').trim().toLowerCase();
            if (a.includes('@')) out.add(a);
          }
        }
        link = j?.['@odata.nextLink'];
      }
      return [...out];
    },

    async unreadCount(folder: WellKnownFolder = 'inbox'): Promise<number> {
      const j = await request('GET', `/me/mailFolders/${folder}?$select=unreadItemCount`);
      return Number(j?.unreadItemCount ?? 0);
    },

    /** An attachment through the JSON route: also says its content id (for pictures inside the mail) or, for a cloud file, where it lives. */
    async attachmentBlob(messageId: string, attachmentId: string): Promise<{ name: string; contentType: string; bytes: Uint8Array; cid?: string; link?: string }> {
      const j = await request('GET', `/me/messages/${enc(messageId)}/attachments/${enc(attachmentId)}`);
      const bin = atob(String(j?.contentBytes ?? ''));
      return {
        name: String(j?.name ?? 'attachment'), contentType: String(j?.contentType ?? 'application/octet-stream'), bytes: Uint8Array.from(bin, (c) => c.charCodeAt(0)),
        ...(j?.contentId ? { cid: String(j.contentId).replace(/^<|>$/g, '').toLowerCase() } : {}),
        ...(j?.sourceUrl ? { link: String(j.sourceUrl) } : {}),
      };
    },

    /** The raw bytes of an attachment: a file as it is, an attached message as an .eml. No base64 detour, so big files stay light. */
    async attachmentValue(messageId: string, attachmentId: string): Promise<{ bytes: Uint8Array; type: string }> {
      return await requestBytes(`/me/messages/${enc(messageId)}/attachments/${enc(attachmentId)}/$value`);
    },

    /** What is attached, without the contents. Only properties every kind of attachment has are asked for, so no kind can make the list fail. */
    async attachments(messageId: string): Promise<AttachmentInfo[]> {
      const j = await request('GET', `/me/messages/${enc(messageId)}/attachments?$select=id,name,size,contentType,isInline`);
      return ((j?.value ?? []) as any[]).map((a) => ({
        id: String(a.id), name: String(a.name ?? 'attachment'), size: Number(a.size ?? 0), contentType: String(a.contentType ?? ''), inline: !!a.isInline,
        kind: /itemAttachment/i.test(String(a['@odata.type'] ?? '')) ? 'item' : /referenceAttachment/i.test(String(a['@odata.type'] ?? '')) ? 'link' : 'file',
      }));
    },
  };
}

export type Graph = ReturnType<typeof createGraph>;
