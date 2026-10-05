import { memoryStore, type PendingOp, type Store } from './core/store.ts';
import type { Mail, MailBody } from './core/types.ts';

// The phone's copy of the mail, in IndexedDB. If the browser refuses (private window, storage blocked) the app still works from memory
// for that session instead of failing, and says nothing alarming: reading mail must never depend on storage.

const DB = 'post-mail';
const STORES = ['mail', 'bodies', 'meta', 'ops'] as const;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('mail', { keyPath: 'key' });
      db.createObjectStore('bodies', { keyPath: 'key' });
      db.createObjectStore('meta');
      db.createObjectStore('ops', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('blocked'));
  });
}

const wrap = <T,>(r: IDBRequest<T>) => new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const done = (tx: IDBTransaction) => new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });

export async function openStore(): Promise<Store> {
  let db: IDBDatabase;
  try { db = await open(); } catch { return memoryStore(); }
  const all = async <T,>(name: (typeof STORES)[number]) => await wrap(db.transaction(name).objectStore(name).getAll() as IDBRequest<T[]>);
  const put = async (name: (typeof STORES)[number], items: unknown[], key?: IDBValidKey) => {
    const tx = db.transaction(name, 'readwrite');
    for (const it of items) tx.objectStore(name).put(it, key);
    await done(tx);
  };
  return {
    allMail: () => all<Mail>('mail'),
    getMail: async (k) => (await wrap(db.transaction('mail').objectStore('mail').get(k))) as Mail | undefined,
    putMail: (items) => put('mail', items),
    async deleteMail(keys) {
      const tx = db.transaction(['mail', 'bodies'], 'readwrite');
      for (const k of keys) { tx.objectStore('mail').delete(k); tx.objectStore('bodies').delete(k); }
      await done(tx);
    },
    getBody: async (k) => (await wrap(db.transaction('bodies').objectStore('bodies').get(k))) as MailBody | undefined,
    putBody: (b) => put('bodies', [b]),
    getMeta: async <T,>(k: string) => (await wrap(db.transaction('meta').objectStore('meta').get(k))) as T | undefined,
    async setMeta(k, v) {
      const tx = db.transaction('meta', 'readwrite');
      if (v === undefined) tx.objectStore('meta').delete(k); else tx.objectStore('meta').put(v, k);
      await done(tx);
    },
    allOps: () => all<PendingOp>('ops'),
    putOp: (o) => put('ops', [o]),
    async deleteOp(id) { const tx = db.transaction('ops', 'readwrite'); tx.objectStore('ops').delete(id); await done(tx); },
    async clearAccount(account) {
      const tx = db.transaction(['mail', 'bodies', 'meta', 'ops'], 'readwrite');
      const mail = tx.objectStore('mail');
      const cur = mail.openCursor();
      cur.onsuccess = () => {
        const c = cur.result;
        if (!c) return;
        if ((c.value as Mail).account === account) { tx.objectStore('bodies').delete(c.value.key); c.delete(); }
        c.continue();
      };
      const meta = tx.objectStore('meta');
      const mk = meta.getAllKeys();
      mk.onsuccess = () => { for (const k of mk.result) if (typeof k === 'string' && k.startsWith(`${account}|`)) meta.delete(k); };
      const ops = tx.objectStore('ops').openCursor();
      ops.onsuccess = () => { const c = ops.result; if (!c) return; if ((c.value as PendingOp).account === account) c.delete(); c.continue(); };
      await done(tx);
    },
  };
}
