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
  internetMessageHeaders?: { name: string; value: string }[];
  '@removed'?: { reason?: string };
}

export const LIST_FIELDS = 'id,conversationId,receivedDateTime,subject,from,bodyPreview,isRead,flag,hasAttachments,inferenceClassification,parentFolderId';
export type WellKnownFolder = 'inbox' | 'archive' | 'deleteditems' | 'sentitems' | 'drafts' | 'junkemail';

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createGraph(deps: GraphDeps) {
  const base = deps.base ?? 'https://graph.microsoft.com/v1.0';
  const sleep = deps.sleep ?? realSleep;
  const maxRetries = deps.maxRetries ?? 3;

  async function request(method: string, pathOrUrl: string, body?: unknown, extra: Record<string, string> = {}): Promise<any> {
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${base}${pathOrUrl}`;
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      const token = await deps.token(refreshed);
      let res: Response;
      try {
        res = await deps.fetch(url, {
          method,
          headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...extra },
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });
      } catch (e) {
        if (attempt < maxRetries) { await sleep(500 * 2 ** attempt); continue; }
        throw new GraphError(0, 'network', e instanceof Error ? e.message : 'Network error');
      }
      if (res.status === 401 && !refreshed) { refreshed = true; attempt--; continue; }
      if ((res.status === 429 || res.status === 503 || res.status === 504) && attempt < maxRetries) {
        const wait = Number(res.headers.get('Retry-After'));
        await sleep(Number.isFinite(wait) && wait > 0 ? Math.min(wait, 30) * 1000 : 500 * 2 ** attempt);
        continue;
      }
      if (res.status === 204 || res.status === 202) return null;
      const text = await res.text();
      let json: any = null;
      try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
      if (!res.ok) throw new GraphError(res.status, String(json?.error?.code ?? 'error'), String(json?.error?.message ?? text).slice(0, 200));
      return json;
    }
  }

  return {
    request,

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

    /** Up to 20 calls in one request. Returns the status of each, in order. A call Microsoft asked us to slow down on also says for how long (`retryAfter`, seconds). */
    async batch(calls: { method: string; url: string; body?: unknown }[]): Promise<{ status: number; body: any; retryAfter?: number }[]> {
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
    },

    async sendMail(message: { subject: string; body: string; to: string[]; cc?: string[]; bcc?: string[] }) {
      const rcpt = (a: string[] = []) => a.map((address) => ({ emailAddress: { address } }));
      await request('POST', '/me/sendMail', {
        message: { subject: message.subject, body: { contentType: 'Text', content: message.body }, toRecipients: rcpt(message.to), ccRecipients: rcpt(message.cc), bccRecipients: rcpt(message.bcc) },
        saveToSentItems: true,
      });
    },

    async reply(id: string, comment: string, all = false) {
      await request('POST', `/me/messages/${encodeURIComponent(id)}/${all ? 'replyAll' : 'reply'}`, { comment });
    },

    async forward(id: string, to: string[], comment: string) {
      await request('POST', `/me/messages/${encodeURIComponent(id)}/forward`, { comment, toRecipients: to.map((address) => ({ emailAddress: { address } })) });
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

    async attachmentBlob(messageId: string, attachmentId: string): Promise<{ name: string; contentType: string; bytes: Uint8Array }> {
      const j = await request('GET', `/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`);
      const bin = atob(String(j?.contentBytes ?? ''));
      return { name: String(j?.name ?? 'attachment'), contentType: String(j?.contentType ?? 'application/octet-stream'), bytes: Uint8Array.from(bin, (c) => c.charCodeAt(0)) };
    },

    async attachments(messageId: string): Promise<{ id: string; name: string; size: number; contentType: string; inline: boolean; cid?: string }[]> {
      const j = await request('GET', `/me/messages/${encodeURIComponent(messageId)}/attachments?$select=id,name,size,contentType,isInline,contentId`);
      return ((j?.value ?? []) as any[]).map((a) => ({ id: String(a.id), name: String(a.name ?? 'attachment'), size: Number(a.size ?? 0), contentType: String(a.contentType ?? ''), inline: !!a.isInline, ...(a.contentId ? { cid: String(a.contentId).toLowerCase() } : {}) }));
    },
  };
}

export type Graph = ReturnType<typeof createGraph>;
