import { insertMemory, uploadPhoto, type NewMemory } from './api';
import { isNetworkMessage, refusalHint } from '../core/sendPolicy.ts';
import { readJson, writeJson } from './store';
import type { Memory } from './types';

// Capture must never fail: writes go to a local queue first and are pushed when the network allows.
type Item = NewMemory & { photoUris: string[] };
const KEY = 'hm.outbox';
const FAILED = 'hm.outbox.failed';

/** To-dos the server refused even in their simplest form: kept aside (not blocking the rest) so they can be tried again. */
export type Failed = { item: Item; msg: string };
export const failedItems = (): Failed[] => readJson<Failed[]>(FAILED, []);
export function retryFailed() {
  const f = failedItems();
  if (f.length === 0) return;
  writeJson(FAILED, []);
  writeJson(KEY, [...pending(), ...f.map((x) => x.item)]);
}

export function pending(): Item[] {
  return readJson<Item[]>(KEY, []);
}

export function enqueue(item: Item) {
  writeJson(KEY, [...pending(), item]);
}

let flushing = false;

export async function flush(): Promise<number> {
  if (flushing) return 0;
  flushing = true;
  let sent = 0;
  try {
    for (const item of pending()) {
      const { photoUris, ...memory } = item;
      const done = () => writeJson(KEY, pending().filter((p) => p.id !== item.id));
      try {
        await insertMemory(memory);
        for (const uri of photoUris) await uploadPhoto(memory.household_id, memory.id, uri);
        done();
        sent++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (isNetworkMessage(msg)) break; // offline: try again later, keep order
        // The server refused it. Most often the database upgrade has not been run, so the newer extras (tags, duration...) have no
        // column: save the basics instead of letting this one block everything behind it.
        try {
          await insertMemory(memory, true);
          done();
          sent++;
        } catch (e2) {
          const msg2 = e2 instanceof Error ? e2.message : String(e2);
          if (isNetworkMessage(msg2)) break;
          done();
          writeJson(FAILED, [...failedItems(), { item, msg: refusalHint(msg2) === 'upgrade' ? `${msg2} (run supabase/upgrade.sql)` : msg2 }]);
        }
      }
    }
  } finally {
    flushing = false;
  }
  return sent;
}

export async function capture(item: Item) {
  enqueue(item);
  await flush();
}

/** A to-do written offline, as it shows in the lists while it waits. */
export function queuedToMemory(item: Item, authorId: string): Memory {
  return {
    id: item.id, household_id: item.household_id, author_id: authorId, body: item.body, status: item.place_id || item.due_on ? 'active' : 'inbox',
    place_id: item.place_id, snoozed_until: null, suggestion: null, suggested_at: new Date().toISOString(), created_at: new Date().toISOString(), done_at: null,
    due_on: item.due_on ?? null, due_time: item.due_on ? item.due_time ?? null : null, repeat_rule: item.repeat_rule ?? null, assignee_id: item.assignee_id ?? null, pinned: !!item.pinned, notes: item.notes ?? null, checklist: item.checklist ?? [], priority: item.priority ?? 0, remind_before: item.remind_before ?? null, tags: item.tags ?? [], duration_min: item.duration_min ?? null, remind_travel: !!item.remind_travel, place_trigger: item.place_trigger === 'leave' ? 'leave' : 'arrive', pending: true,
  };
}
