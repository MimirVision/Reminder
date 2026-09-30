import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { GEOFENCE_TASK, NOTIFICATION_CATEGORY, readRegionLabels, readSnapshot, REFRESH_ID, refreshRegions, storeKeys } from './reminders';
import { readJson, writeJson } from './store';
import { onRegionEvent, type SurfaceState } from '../core/surfacing.ts';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// iOS relaunches the app headless to run this when a watched region is entered or left.
TaskManager.defineTask<{ eventType: Location.LocationGeofencingEventType; region: Location.LocationRegion }>(
  GEOFENCE_TASK,
  async ({ data, error }) => {
    if (error || !data) return;
    const identifier = String(data.region.identifier ?? '');
    const entered = data.eventType === Location.LocationGeofencingEventType.Enter;

    if (identifier === REFRESH_ID) {
      if (!entered) await refreshRegions().catch(() => {});
      return;
    }

    const placeId = identifier.split('|')[0];
    const { places, memories } = readSnapshot();
    const label = readRegionLabels()[identifier] ?? places.find((p) => p.id === placeId)?.name ?? 'a place';

    const result = onRegionEvent({
      type: entered ? 'enter' : 'exit',
      placeId,
      label,
      places,
      memories,
      state: readJson<SurfaceState>(storeKeys.surface, {}),
      now: Date.now(),
    });
    writeJson(storeKeys.surface, result.state);

    if (result.notice) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: result.notice.title,
          body: result.notice.body,
          categoryIdentifier: NOTIFICATION_CATEGORY,
          data: { memoryIds: result.notice.memoryIds, placeId: result.notice.placeId, label: result.notice.label },
        },
        trigger: null,
      });
    }
  },
);
