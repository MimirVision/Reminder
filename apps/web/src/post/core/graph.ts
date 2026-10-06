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
  internetMessageHeaders?: { name: string; value: string }[];
  '@removed'?: { reason?: string };
}

/** A file to send. `bytes` is the file as it is. */
export interface OutFile { name: string; type: string; bytes: Uint8Array }

/** Everything about an attachment except its contents. `kind`: a file, an attached message (item) or a link to a cloud file. */
export interface AttachmentInfo { id: string; name: string; size: number; contentType: string; inline: boolean; kind: 'file' | 'item' | 'link' }

/** What goes out: a new message, an answer to one (`replyTo` is the message answered), or a forward of one. */
export type Outgoing =
  | { kind: 'new'; subject: string; body: string; to: string[]; cc?: string[]; bcc?: string[] }
  | { kind: 'reply' | 'replyAll'; replyTo: string; body: string }
  | { kind: 'forward'; replyTo: string; to: string[]; body: string };

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
export type WellKnownFolder = 'inbox' | 'archive' | 'deleteditems' | 'sentitems' | 'drafts' | 'junkemail';

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
  async function makeDraft(msg: Outgoing): Promise<string> {
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

    /** Moves a message and returns its new id (a moved message gets a new id in Graph). */
    async move(id: string, folder: WellKnownFolder): Promise<string> {
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

    /** Deletes a draft made for a message that will not be sent after all. Best effort: a leftover draft is harmless. */
    async discard(id: string): Promise<void> {
      try { await request('DELETE', `/me/messages/${enc(id)}`); } catch { /* nothing more to do */ }
    },

    /** Server-side search across the whole mailbox, not just what is on this phone. */
    async search(query: string, top = 25): Promise<RawMessage[]> {
      const q = query.replace(/"/g, '');
      const j = await request('GET', `/me/messages?$search="${encodeURIComponent(q)}"&$top=${top}&$select=${LIST_FIELDS}`);
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
