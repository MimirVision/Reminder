// The small steps inside a to-do ("tent, stove, sleeping bags"). Pure helpers, unit tested.
import type { ChecklistItem } from './types';

const MAX_ITEMS = 100;
const newId = () => Math.random().toString(36).slice(2, 10);

export function addItem(list: ChecklistItem[], text: string): ChecklistItem[] {
  const t = text.trim().slice(0, 200);
  return t && list.length < MAX_ITEMS ? [...list, { id: newId(), text: t, done: false }] : list;
}
/** Several lines or "a, b, c" at once. */
export function addMany(list: ChecklistItem[], text: string): ChecklistItem[] {
  return text.split(/\n|,/).reduce((acc, part) => addItem(acc, part), list);
}
export const toggleItem = (list: ChecklistItem[], id: string): ChecklistItem[] => list.map((i) => (i.id === id ? { ...i, done: !i.done } : i));
export const removeItem = (list: ChecklistItem[], id: string): ChecklistItem[] => list.filter((i) => i.id !== id);
export const renameItem = (list: ChecklistItem[], id: string, text: string): ChecklistItem[] => {
  const t = text.trim().slice(0, 200);
  return t ? list.map((i) => (i.id === id ? { ...i, text: t } : i)) : removeItem(list, id);
};
export const progress = (list: ChecklistItem[] | undefined): { done: number; total: number } => ({ done: (list ?? []).filter((i) => i.done).length, total: (list ?? []).length });

/** Whatever came back from the database, made safe. */
export function cleanChecklist(v: unknown): ChecklistItem[] {
  if (!Array.isArray(v)) return [];
  return v.filter((i): i is ChecklistItem => !!i && typeof i.id === 'string' && typeof i.text === 'string' && typeof i.done === 'boolean').slice(0, MAX_ITEMS);
}
