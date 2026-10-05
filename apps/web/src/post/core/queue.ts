import { GraphError, type Graph } from './graph.ts';
import type { PendingOp, Store } from './store.ts';

// Every triage action goes through here. The screen changes at once (optimistic); the server call is held back for the undo window,
// so "Undo" simply cancels it and nothing ever has to be moved back. Actions survive closing the app and are retried until they land.

export type OpType = PendingOp['type'];
const FAMILY: Record<OpType, string> = { archive: 'place', delete: 'place', read: 'read', unread: 'read', flag: 'flag', unflag: 'flag' };

export const UNDO_WINDOW_MS = 6000;

export function createQueue(store: Store, opts: { now?: () => number; id?: () => string } = {}) {
  const now = opts.now ?? (() => Date.now());
  const newId = opts.id ?? (() => Math.random().toString(36).slice(2) + now().toString(36));

  async function enqueue(type: OpType, account: string, messageId: string, delayMs = UNDO_WINDOW_MS): Promise<PendingOp> {
    // A newer choice for the same message replaces the older one in the same family (read then unread, flag then unflag).
    for (const o of await store.allOps()) if (o.account === account && o.messageId === messageId && FAMILY[o.type] === FAMILY[type]) await store.deleteOp(o.id);
    const op: PendingOp = { id: newId(), type, account, messageId, runAfter: now() + delayMs, attempts: 0 };
    await store.putOp(op);
    return op;
  }

  async function cancel(id: string): Promise<boolean> {
    const ops = await store.allOps();
    if (!ops.some((o) => o.id === id)) return false; // already sent: too late, the caller says so
    await store.deleteOp(id);
    return true;
  }

  async function run(op: PendingOp, g: Graph) {
    switch (op.type) {
      case 'archive': await g.move(op.messageId, 'archive'); break;
      case 'delete': await g.move(op.messageId, 'deleteditems'); break;
      case 'read': await g.setRead(op.messageId, true); break;
      case 'unread': await g.setRead(op.messageId, false); break;
      case 'flag': await g.setFlag(op.messageId, true); break;
      case 'unflag': await g.setFlag(op.messageId, false); break;
    }
  }

  /** Sends everything that is due. Returns how many went through and how many are still waiting (for the honest "n waiting" banner). */
  async function flush(graphFor: (account: string) => Graph | null, ignoreWindow = false): Promise<{ sent: number; waiting: number; dropped: number }> {
    let sent = 0, dropped = 0;
    const ops = (await store.allOps()).sort((a, b) => a.runAfter - b.runAfter);
    for (const op of ops) {
      if (!ignoreWindow && op.runAfter > now()) continue;
      const g = graphFor(op.account);
      if (!g) continue;
      try {
        await run(op, g);
        await store.deleteOp(op.id);
        sent++;
      } catch (e) {
        const status = e instanceof GraphError ? e.status : 0;
        if (status === 404 || status === 410) { await store.deleteOp(op.id); dropped++; } // the message is gone: nothing left to do
        else if (status >= 400 && status < 500 && status !== 401 && status !== 429 && op.attempts >= 2) { await store.deleteOp(op.id); dropped++; }
        else await store.putOp({ ...op, attempts: op.attempts + 1 });
      }
    }
    return { sent, dropped, waiting: (await store.allOps()).length };
  }

  return { enqueue, cancel, flush, pending: () => store.allOps() };
}

export type Queue = ReturnType<typeof createQueue>;
