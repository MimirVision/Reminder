import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { GEOFENCE_TASK, logGeo, REFRESH_ID, refreshRegions } from './reminders';
import { catchUpExits, handleRegionEvent } from './geoEvents';

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
      if (!entered) { logGeo({ kind: 'exit', label: '', outcome: 'refreshed' }); await catchUpExits(); await refreshRegions().catch(() => {}); }
      return;
    }

    await handleRegionEvent(entered ? 'enter' : 'exit', identifier);
  },
);
