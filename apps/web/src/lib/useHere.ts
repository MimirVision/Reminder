import { useCallback, useEffect, useState } from 'react';
import type { LatLon } from './geo';

// The last position we learned, shared so the place search can lean towards where you are.
let lastKnown: LatLon | null = null;
export const getLastKnown = () => lastKnown;

export type LocationState = 'unknown' | 'granted' | 'prompt' | 'denied' | 'unsupported';

/** Your position for the map. It never asks by itself: it only locates when permission was already granted,
 *  and `locate()` (from a button) is what triggers the browser's prompt. */
export function useHere(active: boolean) {
  const [here, setHere] = useState<LatLon | null>(lastKnown);
  const [state, setState] = useState<LocationState>('unknown');

  const locate = useCallback(() => {
    if (!('geolocation' in navigator)) { setState('unsupported'); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => { lastKnown = { lat: p.coords.latitude, lon: p.coords.longitude }; setHere(lastKnown); setState('granted'); },
      (e) => setState(e.code === 1 ? 'denied' : 'prompt'),
      { timeout: 10_000, maximumAge: 120_000 },
    );
  }, []);

  useEffect(() => {
    if (!active) return;
    if (!('geolocation' in navigator)) { setState('unsupported'); return; }
    let live = true;
    const q = navigator.permissions?.query({ name: 'geolocation' as PermissionName });
    if (!q) { setState('prompt'); return; }
    q.then((p) => { if (!live) return; setState(p.state as LocationState); if (p.state === 'granted') locate(); }).catch(() => live && setState('prompt'));
    return () => { live = false; };
  }, [active, locate]);

  return { here, state, locate };
}
