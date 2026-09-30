import { insertMemory, uploadPhoto, type NewMemory } from './api';
import { readJson, writeJson } from './store';

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
