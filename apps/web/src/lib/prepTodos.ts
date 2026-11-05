import { addMemory, addTask, listMemories, listPlaces, resolveWhere } from './api';
import { categoryName } from './labels';
import { findExistingPlace } from './placeSearch';
import { itemName, shoppingLine, type Buy, type ItemState, type PrepItem } from './prep';
import type { T } from '../i18n/core';

const SHOP_CATEGORY: Record<Buy, string> = { grocery: 'grocery', pharmacy: 'pharmacy', hardware: 'hardware' };

/** To-dos for what is missing, one each ("Drikkevann: 30 liter"), tagged beredskap and set for the right kind of shop so you are reminded near one.
 *  A to-do that is already open for an item is not made again. Returns how many were made and how many were already there. */
export async function addMissingTodos(householdId: string, missing: ItemState[], lang: string, t: T): Promise<{ made: number; already: number }> {
  const open = (await listMemories(householdId, ['inbox', 'active'])).filter((m) => (m.tags ?? []).includes('beredskap'));
  let places = await listPlaces(householdId);
  let made = 0, already = 0;
  for (const s of missing) {
    const name = itemName(s.item, lang);
    if (open.some((m) => m.body.startsWith(`${name}:`))) { already++; continue; }
    const placeId = await shopFor(householdId, s.item, places, t, (p) => { places = p; });
    await addMemory({ household_id: householdId, body: shoppingLine(s, lang), place_id: placeId, tags: ['beredskap'] });
    made++;
  }
  return { made, already };
}

/** A replacement after something was used: one more of it, for the right shop. */
export async function addReplacementTodo(householdId: string, item: PrepItem | null, name: string, unit: string, lang: string, t: T): Promise<void> {
  const places = await listPlaces(householdId);
  const placeId = item ? await shopFor(householdId, item, places, t, () => {}) : null;
  await addMemory({ household_id: householdId, body: item ? `${itemName(item, lang)}: 1 ${unit}` : name, place_id: placeId, tags: ['beredskap'] });
}

async function shopFor(householdId: string, item: PrepItem, places: Awaited<ReturnType<typeof listPlaces>>, t: T, remember: (p: typeof places) => void): Promise<string | null> {
  if (!item.buy) return null;
  const category = SHOP_CATEGORY[item.buy];
  const r = await resolveWhere(householdId, { kind: 'category', category, name: categoryName(category, t) }, places, findExistingPlace);
  if (r.created) remember([...places, r.created]);
  return r.placeId;
}

/** A house job that comes back every six months: go through the stock. */
export async function addReviewJob(householdId: string, title: string, notes: string): Promise<void> {
  await addTask({ householdId, title, notes, schedule: 'interval', intervalMonths: 6 });
}
