// Offline capture: to-dos written without a connection wait in a small queue on the device and are sent when the
// connection is back. Pure (storage and the sender are passed in), so it is unit tested with plain Node.

export type QueuedTodo = {
  id: string; // created on the device, so a retry never makes a duplicate
  household_id: string;
  body: string;
  place_id: string | null;
  due_on: string | null;
  due_time: string | null;
  repeat_rule: string | null;
  author_id: string;
  created_at: string;
};

export type KV = { getItem(k: string): string | null; setItem(k: string, v: string): void };
const KEY = 'hm.outbox';

export function loadQueue(kv: KV): QueuedTodo[] {
  try {
    const v = JSON.parse(kv.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => x && typeof x.id === 'string' && typeof x.household_id === 'string') : [];
  } catch { return []; }
}
const save = (kv: KV, q: QueuedTodo[]) => { try { kv.setItem(KEY, JSON.stringify(q)); } catch { /* storage full or blocked */ } };

export function enqueue(kv: KV, item: QueuedTodo) {
  const q = loadQueue(kv);
  if (!q.some((x) => x.id === item.id)) save(kv, [...q, item]);
}

export const pendingFor = (kv: KV, householdId: string) => loadQueue(kv).filter((x) => x.household_id === householdId);

/** True when a failed request was the connection, not the server saying no. */
export function isNetworkError(e: unknown, online = true): boolean {
  if (!online) return true;
  const msg = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e);
  return /failed to fetch|networkerror|network request failed|load failed|fetch failed|timeout|offline/i.test(msg);
}

/** Sends the queue in order. Stops at the first connection problem (the rest stays queued); drops items the server refuses. */
export async function flushQueue(kv: KV, send: (q: QueuedTodo) => Promise<void>, online = true): Promise<{ sent: string[]; dropped: string[]; left: number }> {
  const sent: string[] = [];
  const dropped: string[] = [];
  let q = loadQueue(kv);
  while (q.length > 0) {
    const [head, ...rest] = q;
    try {
      await send(head);
      sent.push(head.id);
    } catch (e) {
      if (isNetworkError(e, online)) break;
      dropped.push(head.id);
    }
    q = rest;
    save(kv, q);
  }
  return { sent, dropped, left: q.length };
}
