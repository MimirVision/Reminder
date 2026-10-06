import { plain } from './diag.ts';
import { memoryStore, type Store, type StoreStatus } from './store.ts';

// The phone's storage is not always there when Post wakes up: iOS closes the connection to it when the app has been away for a while, and
// sometimes refuses to open it at all. This keeps Post going: a lost connection is opened again and the job is repeated once; storage that
// will not come back at all is replaced by memory for the rest of the visit, and the screen says so (reading mail never depends on storage).

/** Whether an error says "the connection to the database is gone", as opposed to a real problem with the job (a full disk, a bad value). */
export function connectionLost(e: unknown): boolean {
  const name = String((e as { name?: unknown })?.name ?? '');
  const message = String((e as { message?: unknown })?.message ?? '');
  return name === 'InvalidStateError' || name === 'TransactionInactiveError' || /connection.{0,24}(clos|lost)|indexed ?database server|database.{0,24}clos/i.test(message);
}

export async function resilientStore(open: () => Promise<Store>, opts: { onProblem?: (kind: string, e: unknown) => void } = {}): Promise<Store> {
  let inner!: Store;
  let kind: StoreStatus['kind'] = 'device';
  const inMemory = () => kind === 'memory'; // asked again each time: degrade() may have changed it while a job was waiting
  let reopened = 0;
  let lastError: string | null = null;
  const degrade = (e: unknown) => { lastError = plain(e); kind = 'memory'; inner = memoryStore(); opts.onProblem?.('storage', `Using memory only: ${plain(e)}`); };
  try { inner = await open(); } catch (e) { degrade(e); }

  let reopening: Promise<Store> | null = null;
  const reopen = () => (reopening ??= open().then((s) => { reopened++; return s; }).finally(() => { reopening = null; }));

  /** One job against the store; when the connection turns out to be lost it is opened again and the job repeated once. */
  async function job<T>(fn: (s: Store) => Promise<T>): Promise<T> {
    const used = inner;
    try { return await fn(used); } catch (e) {
      if (inMemory() || !connectionLost(e)) throw e;
      try {
        if (inner === used) { opts.onProblem?.('storage', `Reopened after: ${plain(e)}`); inner = await reopen(); }
        return await fn(inner);
      } catch (e2) {
        if (!inMemory()) degrade(e2);
        return await fn(inner);
      }
    }
  }

  return {
    status: () => ({ kind, reopened, lastError }),
    allMail: () => job((s) => s.allMail()),
    getMail: (k) => job((s) => s.getMail(k)),
    putMail: (items) => job((s) => s.putMail(items)),
    deleteMail: (keys) => job((s) => s.deleteMail(keys)),
    getBody: (k) => job((s) => s.getBody(k)),
    putBody: (b) => job((s) => s.putBody(b)),
    getMeta: <T,>(k: string) => job((s) => s.getMeta<T>(k)),
    setMeta: (k, v) => job((s) => s.setMeta(k, v)),
    allOps: () => job((s) => s.allOps()),
    putOp: (o) => job((s) => s.putOp(o)),
    deleteOp: (id) => job((s) => s.deleteOp(id)),
    clearAccount: (a) => job((s) => s.clearAccount(a)),
  };
}
