import { insertMemory, uploadPhoto, type NewMemory } from './api';
import { readJson, writeJson } from './store';
import type { Memory } from './types';

// Capture must never fail: writes go to a local queue first and are pushed when the network allows.
type Item = NewMemory & { photoUris: string[] };
const KEY = 'hm.outbox';

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
      try {
        const { photoUris, ...memory } = item;
        await insertMemory(memory);
        for (const uri of photoUris) await uploadPhoto(memory.household_id, memory.id, uri);
        writeJson(KEY, pending().filter((p) => p.id !== item.id));
        sent++;
      } catch {
        break; // offline or signed out: try again later, keep order
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
    due_on: item.due_on ?? null, due_time: item.due_on ? item.due_time ?? null : null, repeat_rule: item.repeat_rule ?? null, assignee_id: item.assignee_id ?? null, pinned: !!item.pinned, notes: item.notes ?? null, checklist: item.checklist ?? [], priority: item.priority ?? 0, remind_before: item.remind_before ?? null, tags: item.tags ?? [], pending: true,
  };
}
