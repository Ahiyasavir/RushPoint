import { useEffect, useState } from 'react';

export interface DeviceCoords {
  lat: number;
  lng: number;
}

/**
 * Live device location for the "You Are Here" map dot (WEB).
 *
 * Uses the browser's native Geolocation API directly. We intentionally do NOT
 * import `expo-location` here: its web build installs a geolocation polyfill
 * whose subscription cleanup calls `LocationEventEmitter.removeSubscription`,
 * which React Native removed — so it throws on unmount and crashes the app when
 * navigating away from the map. Keeping this file `expo-location`-free means the
 * polyfill is never installed in the web bundle. Native uses `useDeviceLocation.ts`.
 *
 * Returns null until a fix is available (or if permission is denied / the API is
 * unavailable), so callers simply don't render the dot — it never crashes.
 */
export function useDeviceLocation(active = true): DeviceCoords | null {
  const [coords, setCoords] = useState<DeviceCoords | null>(null);

  useEffect(() => {
    if (!active) return;
    const geo = (globalThis as unknown as { navigator?: { geolocation?: Geolocation } })
      .navigator?.geolocation;
    if (!geo?.watchPosition) return;

    const watchId = geo.watchPosition(
      (pos) => setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => { /* denied / unavailable — leave null, no dot */ },
      { enableHighAccuracy: false, maximumAge: 10_000, timeout: 15_000 },
    );

    return () => {
      try {
        geo.clearWatch(watchId);
      } catch {
        /* defensive — browser clearWatch should never throw, but stay safe */
      }
    };
  }, [active]);

  return coords;
}
