import type { Mail, MailBody } from './types.ts';

// Where mail lives on the phone. The UI and sync only talk to this interface; the browser build backs it with IndexedDB (src/post/idb.ts)
// and the tests use the in-memory one below.

export interface PendingOp {
  id: string;
  type: 'archive' | 'delete' | 'move' | 'read' | 'unread' | 'flag' | 'unflag';
  account: string;
  messageId: string;
  /** For a move: where it goes, as Outlook is told (a standard folder's name, or the id of any other folder). */
  to?: string;
  runAfter: number; // epoch ms: the undo window. Cancelling before this time means nothing ever reaches the server.
  attempts: number;
}

/** Where a store really keeps things: on the device, or (when the device would not let it) only in memory until Post is closed. */
export interface StoreStatus { kind: 'device' | 'memory'; /** how often the connection to the device's storage was lost and opened again */ reopened: number; lastError: string | null }

export interface Store {
  /** Only a store that can fall back to memory says where it stands. */
  status?(): StoreStatus;
  allMail(): Promise<Mail[]>;
  getMail(key: string): Promise<Mail | undefined>;
  putMail(items: Mail[]): Promise<void>;
  deleteMail(keys: string[]): Promise<void>;
  getBody(key: string): Promise<MailBody | undefined>;
  putBody(b: MailBody): Promise<void>;
  getMeta<T = unknown>(key: string): Promise<T | undefined>;
  setMeta(key: string, value: unknown): Promise<void>;
  allOps(): Promise<PendingOp[]>;
  putOp(op: PendingOp): Promise<void>;
  deleteOp(id: string): Promise<void>;
  clearAccount(account: string): Promise<void>;
}

export function memoryStore(): Store {
  const mail = new Map<string, Mail>();
  const bodies = new Map<string, MailBody>();
  const meta = new Map<string, unknown>();
  const ops = new Map<string, PendingOp>();
  return {
    async allMail() { return [...mail.values()].map((m) => ({ ...m })); },
    async getMail(k) { const m = mail.get(k); return m ? { ...m } : undefined; },
    async putMail(items) { for (const m of items) mail.set(m.key, { ...m }); },
    async deleteMail(keys) { for (const k of keys) { mail.delete(k); bodies.delete(k); } },
    async getBody(k) { return bodies.get(k); },
    async putBody(b) { bodies.set(b.key, b); },
    async getMeta<T>(k: string) { return meta.get(k) as T | undefined; },
    async setMeta(k, v) { meta.set(k, v); },
    async allOps() { return [...ops.values()].map((o) => ({ ...o })); },
    async putOp(o) { ops.set(o.id, { ...o }); },
    async deleteOp(id) { ops.delete(id); },
    async clearAccount(account) {
      for (const [k, m] of mail) if (m.account === account) { mail.delete(k); bodies.delete(k); }
      for (const [k, o] of ops) if (o.account === account) ops.delete(k);
      for (const k of [...meta.keys()]) if (k.startsWith(`${account}|`)) meta.delete(k);
    },
  };
}
