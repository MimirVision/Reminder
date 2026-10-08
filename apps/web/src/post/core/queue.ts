import { GraphError, type Graph } from './graph.ts';
import type { PendingOp, Store } from './store.ts';

// Every triage action goes through here. The screen changes at once (optimistic); the server call is held back for the undo window,
// so "Undo" simply cancels it and nothing ever has to be moved back. Actions survive closing the app and are retried until they land.

export type OpType = PendingOp['type'];
const FAMILY: Record<OpType, string> = { archive: 'place', delete: 'place', move: 'place', read: 'read', unread: 'read', flag: 'flag', unflag: 'flag' };

/** Whether an action takes a message out of the folder it is in (and so out of the list it is shown in). */
export const isMove = (type: OpType): boolean => type === 'archive' || type === 'delete' || type === 'move';

export const UNDO_WINDOW_MS = 6000;

export interface QueueOptions {
  now?: () => number;
  id?: () => string;
  /** A moved message has a new id in Outlook. Told here, so that anything waiting that points at the old id can follow it. */
  onMoved?: (account: string, oldId: string, newId: string) => void | Promise<void>;
  /** An action Outlook would not carry out and that was given up on (a message that is simply gone is not this: that is just the end of it). */
  onRefused?: (op: PendingOp, error: GraphError) => void | Promise<void>;
}

export function createQueue(store: Store, opts: QueueOptions = {}) {
  const now = opts.now ?? (() => Date.now());
  const newId = opts.id ?? (() => Math.random().toString(36).slice(2) + now().toString(36));

  async function enqueue(type: OpType, account: string, messageId: string, delayMs = UNDO_WINDOW_MS, to?: string, fromFolder?: boolean): Promise<PendingOp> {
    // A newer choice for the same message replaces the older one in the same family (read then unread, flag then unflag, archive then move).
    for (const o of await store.allOps()) if (o.account === account && o.messageId === messageId && FAMILY[o.type] === FAMILY[type]) await store.deleteOp(o.id);
    const op: PendingOp = { id: newId(), type, account, messageId, runAfter: now() + delayMs, attempts: 0, ...(to ? { to } : {}), ...(fromFolder ? { fromFolder: true } : {}) };
    await store.putOp(op);
    return op;
  }

  async function cancel(id: string): Promise<boolean> {
    const ops = await store.allOps();
    if (!ops.some((o) => o.id === id)) return false; // already sent: too late, the caller says so
    await store.deleteOp(id);
    return true;
  }

  async function moved(op: PendingOp, newId: string) {
    if (!newId || newId === op.messageId) return;
    try { await opts.onMoved?.(op.account, op.messageId, newId); } catch { /* the move has happened; only the way back for a waiting reply is lost */ }
  }

  async function run(op: PendingOp, g: Graph) {
    switch (op.type) {
      case 'archive': await moved(op, await g.move(op.messageId, 'archive')); break;
      case 'delete': await moved(op, await g.move(op.messageId, 'deleteditems')); break;
      case 'move': if (op.to) await moved(op, await g.move(op.messageId, op.to)); break; // a move that does not say where to is nothing to carry out
      case 'read': await g.setRead(op.messageId, true); break;
      case 'unread': await g.setRead(op.messageId, false); break;
      case 'flag': await g.setFlag(op.messageId, true); break;
      case 'unflag': await g.setFlag(op.messageId, false); break;
    }
  }

  async function pass(graphFor: (account: string) => Graph | null, ignoreWindow: boolean): Promise<{ sent: number; dropped: number }> {
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
        // A move to a folder that has been deleted since is a refusal that will not change, not a message that is gone: the message is still where it was.
        // Outlook does not always say which of the two is "not found" (it may answer "item not found" for a deleted folder), so a move that was
        // not found is told apart by looking for the message: if it is there, it is the folder.
        let noFolder = op.type === 'move' && status === 404 && /folder/i.test((e as GraphError).code);
        if (op.type === 'move' && (status === 404 || status === 410) && !noFolder) {
          try { await g.getMessage(op.messageId); noFolder = true; } catch (look) {
            if (!(look instanceof GraphError && (look.status === 404 || look.status === 410))) { await store.putOp({ ...op, attempts: op.attempts + 1 }); continue; } // cannot tell now: tried again
          }
        }
        if (!noFolder && (status === 404 || status === 410)) { await store.deleteOp(op.id); dropped++; } // the message is gone: nothing left to do
        else if (noFolder || (status >= 400 && status < 500 && status !== 401 && status !== 429 && op.attempts >= 2)) {
          await store.deleteOp(op.id); dropped++;
          try { await opts.onRefused?.(op, e as GraphError); } catch { /* the notice is a courtesy */ }
        }
        else await store.putOp({ ...op, attempts: op.attempts + 1 });
      }
    }
    return { sent, dropped };
  }

  // One run at a time: two runs started together (a tap, the timer, a sync) would each find the same waiting action and carry it out twice.
  // A run asked for while another is going waits for that one, then goes through the list once more for what was added meanwhile.
  let running: Promise<{ sent: number; dropped: number; waiting: number }> | null = null;
  let again = false;
  let everythingNext = false;

  /** Sends everything that is due (everything, with `ignoreWindow`). Returns how many went through and how many are still waiting (for the honest "n waiting" banner). */
  function flush(graphFor: (account: string) => Graph | null, ignoreWindow = false): Promise<{ sent: number; waiting: number; dropped: number }> {
    if (running) { again = true; if (ignoreWindow) everythingNext = true; return running; }
    everythingNext = ignoreWindow;
    const p = (async () => {
      let sent = 0, dropped = 0;
      try {
        for (;;) {
          const everything = everythingNext; everythingNext = false; again = false;
          const r = await pass(graphFor, everything);
          sent += r.sent; dropped += r.dropped;
          const waiting = (await store.allOps()).length;
          // Looked at, and let go of, in one breath: a run asked for while the list was being counted is answered by another go through it,
          // not by this one, which would have finished without ever seeing what was added.
          if (!again) { running = null; return { sent, dropped, waiting }; }
        }
      } catch (e) { running = null; throw e; }
    })();
    running = p;
    return p;
  }

  return { enqueue, cancel, flush, pending: () => store.allOps() };
}

export type Queue = ReturnType<typeof createQueue>;
