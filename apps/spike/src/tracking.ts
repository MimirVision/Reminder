import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { BREADCRUMB_TASK, GEOFENCE_TASK } from './tasks';
import { listPlaces, logEvent } from './db';

// iOS monitors at most 20 regions per app.
const MAX_REGIONS = 20;

export type PermissionState = { foreground: boolean; background: boolean; notifications: boolean };

export async function getPermissionState(): Promise<PermissionState> {
  const [fg, bg, n] = await Promise.all([
    Location.getForegroundPermissionsAsync(),
    Location.getBackgroundPermissionsAsync(),
    Notifications.getPermissionsAsync(),
  ]);
  return { foreground: fg.granted, background: bg.granted, notifications: n.granted };
}

// iOS asks in two steps: "While Using" first, then the upgrade to "Always".
export async function requestPermissions(): Promise<PermissionState> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.granted) await Location.requestBackgroundPermissionsAsync();
  await Notifications.requestPermissionsAsync();
  return getPermissionState();
}

export async function syncGeofences() {
  const places = (await listPlaces()).slice(0, MAX_REGIONS);
  if (places.length === 0) {
    if (await Location.hasStartedGeofencingAsync(GEOFENCE_TASK)) {
      await Location.stopGeofencingAsync(GEOFENCE_TASK);
    }
    return;
  }
  await Location.startGeofencingAsync(
    GEOFENCE_TASK,
    places.map((p) => ({
      identifier: String(p.id),
      latitude: p.lat,
      longitude: p.lon,
      radius: p.radius,
      notifyOnEnter: true,
      notifyOnExit: true,
    })),
  );
  await logEvent({ kind: 'regions_registered', detail: `${places.length} regions` });
}

export async function isBreadcrumbOn() {
  return Location.hasStartedLocationUpdatesAsync(BREADCRUMB_TASK);
}

// Ground-truth path for comparing against geofence events. Costs battery, so it is opt-in.
export async function setBreadcrumbs(on: boolean) {
  const running = await isBreadcrumbOn();
  if (on && !running) {
    await Location.startLocationUpdatesAsync(BREADCRUMB_TASK, {
      accuracy: Location.Accuracy.Balanced,
      distanceInterval: 100,
      pausesUpdatesAutomatically: true,
      showsBackgroundLocationIndicator: true,
    });
  } else if (!on && running) {
    await Location.stopLocationUpdatesAsync(BREADCRUMB_TASK);
  }
}
