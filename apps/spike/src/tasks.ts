import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { getPlace, logEvent } from './db';

export const GEOFENCE_TASK = 'home-memory-geofence';
export const BREADCRUMB_TASK = 'home-memory-breadcrumb';

// Must be defined at module scope: iOS relaunches the app headless and runs these.
TaskManager.defineTask<{
  eventType: Location.LocationGeofencingEventType;
  region: Location.LocationRegion;
}>(GEOFENCE_TASK, async ({ data, error }) => {
  if (error) {
    await logEvent({ kind: 'task_error', detail: `geofence: ${error.message}` });
    return;
  }
  const entered = data.eventType === Location.LocationGeofencingEventType.Enter;
  const place = await getPlace(Number(data.region.identifier));

  let pos: Location.LocationObject | null = null;
  try {
    pos = await Location.getLastKnownPositionAsync();
  } catch {
    // best effort only
  }

  await logEvent({
    kind: entered ? 'geofence_enter' : 'geofence_exit',
    place,
    detail: data.region.identifier ?? undefined,
    lat: pos?.coords.latitude,
    lon: pos?.coords.longitude,
    accuracy: pos?.coords.accuracy,
  });

  await Notifications.scheduleNotificationAsync({
    content: {
      title: `${entered ? 'Arrived near' : 'Left'} ${place?.name ?? 'unknown place'}`,
      body: new Date().toLocaleTimeString(),
    },
    trigger: null,
  });
});

TaskManager.defineTask<{ locations: Location.LocationObject[] }>(BREADCRUMB_TASK, async ({ data, error }) => {
  if (error) {
    await logEvent({ kind: 'task_error', detail: `breadcrumb: ${error.message}` });
    return;
  }
  for (const loc of data.locations) {
    await logEvent({
      kind: 'breadcrumb',
      ts: loc.timestamp,
      lat: loc.coords.latitude,
      lon: loc.coords.longitude,
      accuracy: loc.coords.accuracy,
    });
  }
});
