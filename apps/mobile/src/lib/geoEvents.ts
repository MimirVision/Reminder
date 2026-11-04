import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { logGeo, NOTIFICATION_CATEGORY, readRegionLabels, readSnapshot, storeKeys } from './reminders';
import { readJson, writeJson } from './store';
import { tNow } from './i18n';
import { distanceM } from '../core/geo.ts';
import type { PoiCache } from '../core/pois.ts';
import { selectRegions } from '../core/regions.ts';
import { onRegionEvent, type SurfaceState } from '../core/surfacing.ts';

const words = { near: (l: string) => tNow('notif.near', { label: l }), leaving: (l: string) => tNow('notif.leaving', { label: l }), more: (n: number) => tNow('notif.more', { n }), photo: tNow('notif.photo') };

/** Handles one arrive/leave event of a watched spot: decides, rings, remembers, and writes a line in the place-events log. */
export async function handleRegionEvent(type: 'enter' | 'exit', identifier: string, opts: { late?: boolean } = {}): Promise<void> {
  const placeId = identifier.split('|')[0];
  const { places, memories } = readSnapshot();
  const label = readRegionLabels()[identifier] ?? places.find((p) => p.id === placeId)?.name ?? '…';
  try {
    const result = onRegionEvent({ type, placeId, regionId: identifier, label, places, memories, state: readJson<SurfaceState>(storeKeys.surface, {}), now: Date.now(), words });
    writeJson(storeKeys.surface, result.state);
    if (result.notice) {
      await Notifications.scheduleNotificationAsync({
        content: { title: result.notice.title, body: result.notice.body, categoryIdentifier: NOTIFICATION_CATEGORY, data: { memoryIds: result.notice.memoryIds, placeId: result.notice.placeId, label: result.notice.label } },
        trigger: null,
      });
    }
    logGeo({ kind: type, label, outcome: opts.late && result.outcome === 'rang' ? 'caught-up' : result.outcome });
  } catch (e) {
    logGeo({ kind: 'error', label, outcome: e instanceof Error ? e.message.slice(0, 120) : 'error' });
  }
}

/** iOS can drop the "left" event of a small area. When the phone is seen well outside a spot it was last seen inside, the departure is
 *  processed now (late, but while you are still on your way). Runs when the wide refresh area is left and whenever the app opens. */
export async function catchUpExits(): Promise<void> {
  try {
    const state = readJson<SurfaceState>(storeKeys.surface, {});
    const inside = Object.values(state).flatMap((s) => s.insideIds ?? []);
    if (inside.length === 0) return;
    const pos = (await Location.getLastKnownPositionAsync({ maxAge: 15 * 60_000 })) ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low }));
    const here = { lat: pos.coords.latitude, lon: pos.coords.longitude };
    const { places, memories } = readSnapshot();
    const pois = readJson<PoiCache | null>(storeKeys.pois, null)?.byCategory ?? {};
    const regions = selectRegions({ places, memories, pois, here: null, max: 500 });
    for (const id of inside) {
      const r = regions.find((x) => x.identifier === id);
      if (r && distanceM(here, { lat: r.latitude, lon: r.longitude }) > r.radius + 100) await handleRegionEvent('exit', id, { late: true });
    }
  } catch {
    // no position right now: the next event or app opening tries again
  }
}
