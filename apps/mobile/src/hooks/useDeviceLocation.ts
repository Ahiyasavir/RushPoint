import { useEffect, useState } from 'react';
import * as Location from 'expo-location';

export interface DeviceCoords {
  lat: number;
  lng: number;
}

/**
 * Live device location for the "You Are Here" map dot. Uses expo-location, which
 * works on both web (browser Geolocation API) and native. Returns null until a fix
 * is available (or if permission is denied / unavailable), so callers simply don't
 * render the dot in that case — it never crashes.
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
      sub?.remove();
    };
  }, [active]);

  return coords;
}
