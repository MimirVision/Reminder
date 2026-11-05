import { addTask, listMemories, listPlaces, resolveWhere } from './api';
import { uuid } from './id';
import { capture } from './outbox';
import type { T } from '../shared/i18n/core';
import { categoryName } from '../shared/lib/labels';
import { findExistingPlace } from '../shared/lib/placeSearch';
import { itemName, shoppingLine, type ItemState, type PrepItem } from '../shared/lib/prep';

async function shopFor(householdId: string, item: PrepItem, places: Awaited<ReturnType<typeof listPlaces>>, t: T): Promise<string | null> {
  if (!item.buy) return null;
  return resolveWhere(householdId, { kind: 'category', category: item.buy, name: categoryName(item.buy, t) }, places, findExistingPlace);
}

const todo = (householdId: string, body: string, placeId: string | null) => capture({ id: uuid(), household_id: householdId, body, place_id: placeId, capture_lat: null, capture_lon: null, tags: ['beredskap'], photoUris: [] });

/** To-dos for what is missing ("Drikkevann: 30 liter"), tagged beredskap and set for the right kind of shop so you are reminded near one.
 *  One that is already open for an item is not made again. */
export async function addMissingTodos(householdId: string, missing: ItemState[], lang: string, t: T): Promise<{ made: number; already: number }> {
  const open = (await listMemories(householdId, ['inbox', 'active'])).filter((m) => (m.tags ?? []).includes('beredskap'));
  const places = await listPlaces(householdId);
  let made = 0, already = 0;
  for (const s of missing) {
    if (open.some((m) => m.body.startsWith(`${itemName(s.item, lang)}:`))) { already++; continue; }
    await todo(householdId, shoppingLine(s, lang), await shopFor(householdId, s.item, places, t));
    made++;
  }
  return { made, already };
}

export async function addReplacementTodo(householdId: string, item: PrepItem | null, name: string, unit: string, lang: string, t: T): Promise<void> {
  const places = await listPlaces(householdId);
  await todo(householdId, item ? `${itemName(item, lang)}: 1 ${unit}` : name, item ? await shopFor(householdId, item, places, t) : null);
}

export const addReviewJob = (householdId: string, title: string, notes: string) => addTask({ householdId, title, notes, schedule: 'interval', intervalMonths: 6 });
