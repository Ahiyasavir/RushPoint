import { useEffect, useState } from 'react';
import * as Location from 'expo-location';

export interface DeviceCoords {
  lat: number;
  lng: number;
}

/**
 * Live device location for the "You Are Here" map dot (NATIVE).
 *
 * Web uses the sibling `useDeviceLocation.web.ts` (browser Geolocation API).
 * That split is deliberate: importing `expo-location` on web installs a
 * geolocation polyfill whose subscription cleanup calls the removed
 * `LocationEventEmitter.removeSubscription`, crashing the app on unmount — so we
 * must keep `expo-location` out of the web bundle entirely. Metro resolves the
 * `.web.ts` variant for web and this file for iOS/Android.
 *
 * Returns null until a fix is available (or if permission is denied), so callers
 * simply don't render the dot — it never crashes.
 */
export function useDeviceLocation(active = true): DeviceCoords | null {
  const [coords, setCoords] = useState<DeviceCoords | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let sub: Location.LocationSubscription | undefined;

    void (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (cancelled || status !== 'granted') return;
        sub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, timeInterval: 5000, distanceInterval: 10 },
          (pos) => {
            if (!cancelled) setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          },
        );
      } catch {
        /* location unavailable / denied — leave null, no dot */
      }
    })();

    return () => {
      cancelled = true;
      try {
        sub?.remove();
      } catch {
        /* defensive: some RN/expo versions throw in subscription cleanup */
      }
    };
  }, [active]);

  return coords;
}
