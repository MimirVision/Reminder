// A small Microsoft Graph client for mail: every call goes through one request() that adds the sign-in, retries when Microsoft says
// "slow down", and signs in again once if the token was refused. The fetch and the token source are injected so it is tested without a network.

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

const INLINE_TOTAL = 2_500_000; // all files together that may travel inside the message itself (base64 makes them a third bigger, and Microsoft refuses about 4 MB per call)
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

  type Send = { headers?: Record<string, string>; body?: BodyInit; /** false for addresses that carry their own permission (upload addresses): the sign-in must not be sent there */ auth?: boolean; /** how often a dropped connection is tried again (default: the usual number) */ retries?: number };

  /** One call with the retry rules: renews the sign-in once when it is refused, waits when Microsoft says "slow down", and tries again when the connection drops. Gives back the final answer untouched. */
  async function exchange(method: string, pathOrUrl: string, o: Send = {}): Promise<Response> {
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${base}${pathOrUrl}`;
    const limit = o.retries ?? maxRetries;
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      const headers: Record<string, string> = {};
      if (o.auth !== false) headers.Authorization = `Bearer ${await deps.token(refreshed)}`;
      Object.assign(headers, o.headers);
      let res: Response;
      try {
        res = await deps.fetch(url, { method, headers, body: o.body });
      } catch (e) {
        if (attempt < limit) { await sleep(500 * 2 ** attempt); continue; }
        throw new GraphError(0, 'network', e instanceof Error ? e.message : 'Network error');
      }
      if (res.status === 401 && o.auth !== false && !refreshed) { refreshed = true; attempt--; continue; }
      if ((res.status === 429 || res.status === 503 || res.status === 504) && attempt < limit) {
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

  async function request(method: string, pathOrUrl: string, body?: unknown, extra: Record<string, string> = {}): Promise<any> {
    const res = await exchange(method, pathOrUrl, { headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...extra }, body: body !== undefined ? JSON.stringify(body) : undefined });
    if (res.status === 204 || res.status === 202) return null;
    if (!res.ok) throw await failure(res);
    const text = await res.text();
    try { return text ? JSON.parse(text) : null; } catch { return null; }
  }

  /** The answer as it is, for files. */
  async function requestBytes(path: string): Promise<{ bytes: Uint8Array; type: string }> {
    const res = await exchange('GET', path);
    if (!res.ok) throw await failure(res);
    return { bytes: new Uint8Array(await res.arrayBuffer()), type: res.headers.get('Content-Type') ?? '' };
  }

  // ---- sending files ---------------------------------------------------------------------------------------------------------
  // Small files travel inside the message. Bigger ones need a draft: make it, attach the files one by one (a file over 3 MB goes up in
  // slices to a private upload address), then send it. A draft that fails halfway is deleted so nothing is left lying in Drafts.

  const enc = encodeURIComponent;
  const fileAttachment = (f: OutFile) => ({ '@odata.type': '#microsoft.graph.fileAttachment', name: f.name, contentType: f.type || 'application/octet-stream', contentBytes: toBase64(f.bytes) });

  // The upload address belongs to Microsoft's mail servers and carries its own permission. A browser may not be allowed to talk to it (that
  // is Microsoft's choice and cannot be tested from here), so when the direct way fails the site's own server passes the slice on.
  let viaRelay = !!deps.uploadRelay && !!deps.uploadViaRelay;

  async function putSlice(url: string, bytes: Uint8Array, start: number, total: number) {
    const headers = { 'Content-Type': 'application/octet-stream', 'Content-Range': `bytes ${start}-${start + bytes.byteLength - 1}/${total}` };
    const body = bytes as BodyInit;
    const relay = deps.uploadRelay;
    const throughRelay = async () => {
      const r = await exchange('PUT', relay!, { auth: false, headers: { ...headers, 'X-Upload-Url': url }, body });
      // Anything that is not the relay itself (a missing route answers with the web page) is no answer from Microsoft.
      if (!r.headers.get('X-Post-Relay')) throw new GraphError(0, 'upload', 'Outlook would not take the file from this browser');
      return r;
    };
    let res: Response;
    if (relay && viaRelay) res = await throughRelay();
    else {
      try { res = await exchange('PUT', url, { auth: false, headers, body, retries: relay ? 0 : undefined }); } catch (e) {
        if (!relay || !(e instanceof GraphError && e.status === 0)) throw e;
        res = await throughRelay();
        if (res.ok) { viaRelay = true; deps.onUploadRoute?.('relay'); }
      }
    }
    if (!res.ok) throw await failure(res);
  }

  async function attach(messageId: string, f: OutFile) {
    const size = f.bytes.byteLength;
    if (size <= ONE_CALL) { await request('POST', `/me/messages/${enc(messageId)}/attachments`, fileAttachment(f)); return; }
    const session = await request('POST', `/me/messages/${enc(messageId)}/attachments/createUploadSession`, { AttachmentItem: { attachmentType: 'file', name: f.name, size, contentType: f.type || 'application/octet-stream' } });
    const url = String(session?.uploadUrl ?? '');
    if (!url) throw new GraphError(0, 'upload', `Outlook did not give a place to upload ${f.name}`);
    for (let at = 0; at < size; at += SLICE) await putSlice(url, f.bytes.subarray(at, Math.min(size, at + SLICE)), at, size);
  }

  async function sendDraft(create: () => Promise<any>, files: OutFile[]) {
    const id = String((await create())?.id ?? '');
    if (!id) throw new GraphError(0, 'draft', 'Outlook did not create the draft');
    try {
      for (const f of files) await attach(id, f);
      await request('POST', `/me/messages/${enc(id)}/send`);
    } catch (e) {
      try { await request('DELETE', `/me/messages/${enc(id)}`); } catch { /* a leftover draft is harmless */ }
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

    /** Sends a new message. With `files`: inside the message when they are small, through a draft when they are not. */
    async sendMail(message: { subject: string; body: string; to: string[]; cc?: string[]; bcc?: string[]; files?: OutFile[] }) {
      const rcpt = (a: string[] = []) => a.map((address) => ({ emailAddress: { address } }));
      const payload = { subject: message.subject, body: { contentType: 'Text', content: message.body }, toRecipients: rcpt(message.to), ccRecipients: rcpt(message.cc), bccRecipients: rcpt(message.bcc) };
      const files = message.files ?? [];
      if (!files.length) { await request('POST', '/me/sendMail', { message: payload, saveToSentItems: true }); return; }
      if (files.reduce((n, f) => n + f.bytes.byteLength, 0) <= INLINE_TOTAL) { await request('POST', '/me/sendMail', { message: { ...payload, attachments: files.map(fileAttachment) }, saveToSentItems: true }); return; }
      await sendDraft(() => request('POST', '/me/messages', payload), files);
    },

    async reply(id: string, comment: string, all = false, files?: OutFile[]) {
      if (!files?.length) { await request('POST', `/me/messages/${enc(id)}/${all ? 'replyAll' : 'reply'}`, { comment }); return; }
      await sendDraft(() => request('POST', `/me/messages/${enc(id)}/${all ? 'createReplyAll' : 'createReply'}`, { comment }), files);
    },

    /** Forwards with the original's attachments (Outlook adds them itself) plus any new `files`. */
    async forward(id: string, to: string[], comment: string, files?: OutFile[]) {
      const toRecipients = to.map((address) => ({ emailAddress: { address } }));
      if (!files?.length) { await request('POST', `/me/messages/${enc(id)}/forward`, { comment, toRecipients }); return; }
      await sendDraft(() => request('POST', `/me/messages/${enc(id)}/createForward`, { comment, toRecipients }), files);
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
