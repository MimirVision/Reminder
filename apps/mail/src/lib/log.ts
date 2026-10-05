import 'expo-sqlite/localStorage/install';

// A tiny persistent log that also works inside the headless background task.
const KEY = 'post.log';
export type LogLine = { t: number; tag: string; msg: string };

export function readLog(): LogLine[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as LogLine[];
  } catch {
    return [];
  }
}

export function appendLog(tag: string, msg: string) {
  try {
    const next = [...readLog(), { t: Date.now(), tag, msg }].slice(-200);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // best effort
  }
}
